import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Health check" };

// Error code Supabase returns when a table doesn't exist.
// Getting it back means: we reached the database AND the key was accepted.
const TABLE_NOT_FOUND = "PGRST205";

type Result = { ok: true } | { ok: false; error: string };

async function checkSupabase(): Promise<Result> {
  try {
    const supabase = await createClient();
    // No tables exist yet, so ask for one that never will.
    const { error } = await supabase.from("_health_check").select("*").limit(1);

    if (!error || error.code === TABLE_NOT_FOUND) return { ok: true };
    return { ok: false, error: `${error.code ?? "error"}: ${error.message}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function HealthStatus() {
  const result = await checkSupabase();

  if (result.ok) {
    return <p className="text-2xl font-semibold text-brand-primary">Connected ✅</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xl font-semibold text-red-600">Not connected ❌</p>
      <pre className="whitespace-pre-wrap break-words rounded-lg bg-red-50 p-3 text-left text-sm text-red-800">
        {result.error}
      </pre>
    </div>
  );
}

export default function HealthPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-sm font-medium uppercase tracking-wide text-foreground/60">
        Supabase connection
      </h1>
      {/* Checks live at request time, so it needs a Suspense boundary. */}
      <Suspense fallback={<p className="text-lg text-foreground/60">Checking…</p>}>
        <HealthStatus />
      </Suspense>
    </main>
  );
}

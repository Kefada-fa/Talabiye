import Image from "next/image";
import { brand } from "@/config/brand";

// Temporary placeholder home page. Real features come later.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Image src={brand.logo.src} alt={brand.logo.alt} width={64} height={64} priority />
      <h1 className="text-3xl font-bold text-brand-primary">{brand.name}</h1>
      <p className="max-w-sm text-base text-foreground/70">{brand.tagline}</p>
      <span className="rounded-full bg-brand-accent/15 px-3 py-1 text-sm font-medium text-brand-accent">
        Coming soon
      </span>
    </main>
  );
}

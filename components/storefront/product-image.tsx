import { t } from "@/lib/i18n";

/** A product photo, or a neutral placeholder when there is none. */
export function ProductImage({
  src,
  alt,
  className = "",
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  if (!src) {
    return (
      <div
        role="img"
        aria-label={t.product.noPhoto}
        className={`flex items-center justify-center bg-zinc-100 text-zinc-300 ${className}`}
      >
        <svg viewBox="0 0 24 24" className="h-1/3 w-1/3" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <path d="M6 8h12l-1 12H7L6 8Z" strokeLinejoin="round" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- shop photos can come from any website for now; switch to next/image once photos are stored in Supabase Storage
    <img src={src} alt={alt} loading="lazy" className={`bg-zinc-100 object-cover ${className}`} />
  );
}

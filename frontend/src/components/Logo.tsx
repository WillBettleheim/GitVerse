import Link from "next/link";

/** A small skyline: the product in one glyph. */
export function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 font-medium tracking-tight">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="1" y="9" width="4" height="10" rx="0.5" fill="#3b82f6" />
        <rect x="6.5" y="2" width="4" height="17" rx="0.5" fill="#22d3ee" />
        <rect x="12" y="6" width="3" height="13" rx="0.5" fill="#a78bfa" />
        <rect x="16" y="12" width="3" height="7" rx="0.5" fill="#6366f1" />
      </svg>
      GitVerse
    </Link>
  );
}

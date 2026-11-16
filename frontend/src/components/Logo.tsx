import Link from "next/link";

/** A small skyline: the product in one glyph. */
export function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 font-medium tracking-tight">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="1" y="9" width="4" height="10" rx="0.5" fill="#8e1115" />
        <rect x="6.5" y="2" width="4" height="17" rx="0.5" fill="#f5d76e" />
        <rect x="12" y="6" width="3" height="13" rx="0.5" fill="#cc2520" />
        <rect x="16" y="12" width="3" height="7" rx="0.5" fill="#e07a3a" />
      </svg>
      GitVerse
    </Link>
  );
}

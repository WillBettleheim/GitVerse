"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Shown when a page fails to render. The details stay in the browser console. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main role="alert" className="grid min-h-svh place-items-center bg-void px-6 text-center">
      <div className="max-w-md">
        <p className="font-mono text-xs tracking-wide text-amber">Something went wrong</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">This view couldn’t load.</h1>
        <p className="mt-3 text-muted">
          Try again. If it keeps happening, reload the page or go back to the home page.
        </p>
        <div className="mt-6 flex justify-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-md bg-text px-4 py-2 font-medium text-void hover:bg-cyan"
          >
            Try again
          </button>
          <Link href="/" className="px-4 py-2 text-muted hover:text-text">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}

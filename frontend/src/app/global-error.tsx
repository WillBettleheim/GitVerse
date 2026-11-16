"use client";

import { useEffect } from "react";

/**
 * The last resort, when the root layout itself fails. It replaces the whole document, so it
 * carries its own minimal styling instead of the app's stylesheet.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#04060d",
          color: "#e7ecf7",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <title>Something went wrong | GitVerse</title>
        <main role="alert" style={{ maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>GitVerse couldn’t load.</h1>
          <p style={{ color: "#9aa6c2" }}>Please try again in a moment.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 12,
              padding: "8px 16px",
              borderRadius: 6,
              border: 0,
              background: "#e7ecf7",
              color: "#04060d",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

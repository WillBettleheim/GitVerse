"use client";

import dynamic from "next/dynamic";

/** WebGL can't render on the server, and this keeps Three.js out of the initial bundle. */
export const LazyCityCanvas = dynamic(() => import("./CityCanvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center font-mono text-xs text-slate-500">
      Loading city…
    </div>
  ),
});

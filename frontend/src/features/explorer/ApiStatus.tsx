"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/config";

type Status = "checking" | "online" | "offline";

const TIMEOUT_MS = 3000;

const DISPLAY: Record<Status, { label: string; dot: string }> = {
  checking: { label: "Checking API", dot: "bg-faint" },
  online: { label: "API online", dot: "bg-cyan" },
  offline: { label: "API offline", dot: "bg-amber" },
};

/** Connectivity only. Demo mode doesn't need the API, so offline isn't an error. */
export function ApiStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then((response) => setStatus(response.ok ? "online" : "offline"))
      .catch(() => {
        // Unmount also aborts, and setting state then is harmless.
        setStatus("offline");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const { label, dot } = DISPLAY[status];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-2 font-mono text-xs text-muted"
      title="Connection to the GitVerse backend. Demo mode works without it."
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

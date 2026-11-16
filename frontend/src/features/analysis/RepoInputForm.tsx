"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { parseRepoInput } from "@/lib/analysis/repo-input";

export function analysisPath(owner: string, name: string) {
  return `/explore/gh/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export function RepoInputForm({
  initialValue = "",
  compact = false,
}: {
  initialValue?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const inputId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = parseRepoInput(value);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    router.push(analysisPath(result.repo.owner, result.repo.name));
  };

  return (
    <form onSubmit={submit} noValidate className={compact ? "w-full max-w-md" : "w-full max-w-xl"}>
      <label htmlFor={inputId} className={compact ? "sr-only" : "text-sm text-muted"}>
        Public GitHub repository
      </label>
      <div className={`flex gap-2 ${compact ? "" : "mt-2"}`}>
        <input
          id={inputId}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          placeholder="owner/name or https://github.com/owner/name"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`h-12 min-w-0 flex-1 rounded-full border bg-deep/40 px-5 font-mono text-sm backdrop-blur placeholder:text-faint transition-colors focus:bg-deep/60 focus:outline-none ${
            error ? "border-amber/70" : "border-crimson/70 focus:border-cyan/70"
          }`}
        />
        <button
          type="submit"
          className="cta h-12 shrink-0 rounded-full px-6 text-sm font-semibold"
        >
          Analyze
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-amber">
          {error}
        </p>
      )}
      {!compact && (
        <p className="mt-2 text-xs text-faint">
          JavaScript and TypeScript, up to 4,000 source files. Code is read, never run.
        </p>
      )}
    </form>
  );
}

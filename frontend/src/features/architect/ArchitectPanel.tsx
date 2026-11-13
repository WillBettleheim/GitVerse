"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useExplorerData, fileName } from "@/features/explorer/explorer-data";
import { useExplorerStore } from "@/features/explorer/store";
import { useTimeTravelStore } from "@/features/timetravel/store";
import { AnalysisRequestError } from "@/lib/analysis/client";
import { sourceLineUrl, sourceUrl } from "@/lib/analysis/source-link";
import {
  askArchitect,
  MAX_QUESTION_LENGTH,
  type ArchitectAnswer,
  type Evidence,
} from "@/lib/architect/api";
import type { CodeGraph } from "@/lib/graph/schema";
import { spotlightFor, useArchitectStore, type Turn } from "./store";

export const SUGGESTED_QUESTIONS = [
  "Explain this repository to a new contributor.",
  "Which files are central to the architecture?",
  "Where could circular dependencies cause problems?",
  "Which files are involved in routing?",
  "Where is authentication implemented?",
];

const button =
  "rounded border border-line px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-faint hover:text-text disabled:cursor-not-allowed disabled:opacity-40";

/** Ask questions about the analyzed commit, answered from GitVerse's evidence. */
export function ArchitectPanel() {
  const { graph } = useExplorerData();
  const turns = useArchitectStore((s) => s.turns);
  const begin = useArchitectStore((s) => s.begin);
  const finish = useArchitectStore((s) => s.finish);
  const setSpotlight = useArchitectStore((s) => s.setSpotlight);
  const selectedId = useExplorerStore((s) => s.selectedId);
  const snapshots = useTimeTravelStore((s) => s.snapshots);
  const [draft, setDraft] = useState("");
  const controller = useRef<AbortController | null>(null);
  const list = useRef<HTMLOListElement>(null);

  const repository = graph.analysis?.repository;
  const busy = turns.some((t) => t.status === "loading");
  // Scrolls when a question is asked and again when its answer arrives.
  const lastTurn = turns.at(-1);
  const lastTurnKey = lastTurn ? `${lastTurn.id}:${lastTurn.status}` : "";

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const item = list.current?.lastElementChild;
    if (item instanceof HTMLElement) scrollPanelTo(item);
  }, [lastTurnKey]);

  if (!repository) return null;

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setDraft("");
    const focus = selectedId;
    const id = begin({ question: text, commit: repository.commitSha, focus });
    controller.current = new AbortController();
    try {
      const answer = await askArchitect(
        {
          repository: repository.fullName,
          commit: repository.commitSha,
          question: text,
          focus,
          snapshots: Object.entries(snapshots)
            .filter(([, s]) => s.status === "ready")
            .map(([sha]) => sha),
        },
        controller.current.signal,
      );
      finish(id, { status: "done", answer });
      setSpotlight(spotlightFor(id, answer));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      finish(id, {
        status: "error",
        error:
          error instanceof AnalysisRequestError
            ? error.message
            : "Something went wrong asking AI Architect.",
        retryAfterSeconds:
          error instanceof AnalysisRequestError ? error.retryAfterSeconds : undefined,
      });
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
  };

  return (
    <section aria-label="AI Architect" className="flex flex-col gap-3 p-4">
      <header>
        <h2 className="text-sm font-semibold">AI Architect</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Answers come from GitVerse’s analysis of commit{" "}
          <span className="font-mono text-text">{repository.commitSha.slice(0, 7)}</span>: files,
          declarations, imports and source excerpts. Verified facts cite that evidence; inferences
          are labelled.
        </p>
      </header>

      {turns.length === 0 && (
        <div>
          <p className="text-[11px] tracking-wide text-faint uppercase">Try asking</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {SUGGESTED_QUESTIONS.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => void ask(q)}
                  className="w-full rounded border border-line bg-panel px-2.5 py-1.5 text-left text-xs text-muted transition-colors hover:border-faint hover:text-text"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol ref={list} className="flex flex-col gap-4" aria-label="Questions and answers">
        {turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            graph={graph}
            onRetry={() => void ask(turn.question)}
          />
        ))}
      </ol>

      <form onSubmit={onSubmit} className="sticky bottom-0 flex flex-col gap-2 bg-ink pt-1 pb-1">
        <label htmlFor="architect-question" className="sr-only">
          Ask about this repository
        </label>
        <textarea
          id="architect-question"
          value={draft}
          maxLength={MAX_QUESTION_LENGTH}
          rows={2}
          placeholder={
            selectedId
              ? `Ask about ${fileName(selectedId)} or the repository…`
              : "Ask about the architecture…"
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
          className="w-full resize-none rounded border border-line bg-panel px-2.5 py-2 text-sm placeholder:text-faint focus:border-cyan/60 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] text-faint">
            {selectedId ? (
              <>
                Includes the selected file:{" "}
                <span className="font-mono">{fileName(selectedId)}</span>
              </>
            ) : (
              "Select a file to ask about it."
            )}
          </p>
          <button type="submit" disabled={busy || !draft.trim()} className={button}>
            {busy ? "Thinking…" : "Ask"}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Brings a turn to the top of the side panel. Only the panel scrolls: scrollIntoView would also
 * scroll the page's fixed layout and push the header out of view.
 */
function scrollPanelTo(item: HTMLElement) {
  let scroller = item.parentElement;
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement;
  }
  if (!scroller) return;
  const offset = item.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  // Leaves room for the sticky tabs.
  scroller.scrollTop += offset - 44;
}

function TurnView({ turn, graph, onRetry }: { turn: Turn; graph: CodeGraph; onRetry: () => void }) {
  return (
    <li className="flex flex-col gap-2">
      <p className="self-end rounded-md bg-raised px-2.5 py-1.5 text-sm">{turn.question}</p>
      {turn.focus && (
        <p className="self-end font-mono text-[10px] text-faint">about {turn.focus}</p>
      )}
      {turn.status === "loading" && (
        <p role="status" className="animate-pulse text-xs text-muted">
          Gathering evidence and asking the model…
        </p>
      )}
      {turn.status === "error" && (
        <div role="alert" className="rounded border border-amber/40 bg-amber/5 p-2.5 text-xs">
          <p className="text-amber">{turn.error}</p>
          <button type="button" onClick={onRetry} className={`${button} mt-2`}>
            {turn.retryAfterSeconds ? `Retry (wait ${turn.retryAfterSeconds}s)` : "Retry"}
          </button>
        </div>
      )}
      {turn.status === "done" && turn.answer && (
        <AnswerView turnId={turn.id} answer={turn.answer} graph={graph} />
      )}
    </li>
  );
}

function AnswerView({
  turnId,
  answer,
  graph,
}: {
  turnId: number;
  answer: ArchitectAnswer;
  graph: CodeGraph;
}) {
  const spotlight = useArchitectStore((s) => s.spotlight);
  const setSpotlight = useArchitectStore((s) => s.setSpotlight);
  const setTab = useExplorerStore((s) => s.setDetailsTab);
  const select = useExplorerStore((s) => s.select);
  const frameFiles = useExplorerStore((s) => s.frameFiles);
  const { files: present } = useExplorerData();
  const evidence = new Map(answer.evidence.map((e) => [e.id, e]));
  const lit = spotlight?.turnId === turnId;
  const shownHere = answer.commitSha === graph.analysis?.repository.commitSha;
  const inCity = answer.files.map((f) => f.path).filter((p) => present.has(p));

  const openInInspector = (path: string) => {
    select(path);
    setTab("details");
  };

  return (
    <article
      aria-label="Answer"
      className="flex flex-col gap-3 rounded-md border border-line bg-panel p-3"
    >
      <ModeBadge answer={answer} />
      {!shownHere && (
        <p className="text-[11px] text-faint">
          Answered for commit {answer.commitSha.slice(0, 7)}, not the one on screen.
        </p>
      )}

      {answer.answer && (
        <p className="text-sm leading-relaxed whitespace-pre-line">{answer.answer}</p>
      )}

      {answer.claims.length > 0 && (
        <ul aria-label="Claims" className="flex flex-col gap-1.5">
          {answer.claims.map((claim, index) => (
            <li key={index} className="flex gap-2 text-xs leading-relaxed">
              <BasisBadge basis={claim.basis} downgraded={claim.downgraded} />
              <span className="min-w-0">
                {claim.text}
                {claim.evidence.map((id) => (
                  <EvidenceChip key={id} item={evidence.get(id)} id={id} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {answer.uncertainty && (
        <div className="rounded border border-amber/30 bg-amber/5 p-2 text-xs leading-relaxed">
          <p className="font-medium text-amber">
            {answer.sufficientEvidence ? "Uncertainty" : "Not enough evidence"}
          </p>
          <p className="mt-0.5 text-muted">{answer.uncertainty}</p>
        </div>
      )}

      {answer.files.length > 0 && (
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="mr-auto text-[11px] tracking-wide text-faint uppercase">
              Relevant files
            </h3>
            <button
              type="button"
              aria-pressed={lit}
              onClick={() => setSpotlight(lit ? null : spotlightFor(turnId, answer))}
              className={`${button} aria-pressed:border-rose/60 aria-pressed:text-rose`}
            >
              {lit ? "Highlighted" : "Highlight"}
            </button>
            <button
              type="button"
              disabled={inCity.length === 0}
              onClick={() => {
                setSpotlight(spotlightFor(turnId, answer));
                frameFiles(inCity);
              }}
              className={button}
            >
              Focus camera
            </button>
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {answer.files.map((file) => (
              <li key={file.path} className="text-xs">
                <div className="flex items-baseline gap-2">
                  <button
                    type="button"
                    disabled={!present.has(file.path)}
                    onClick={() => openInInspector(file.path)}
                    title="Open in the file inspector"
                    className="min-w-0 truncate font-mono text-cyan hover:underline disabled:text-faint disabled:no-underline"
                  >
                    {file.path}
                  </button>
                </div>
                <p className="mt-0.5 text-muted">{file.reason}</p>
                <LineLinks graph={graph} path={file.path} lines={file.lines} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {answer.relationships.length > 0 && (
        <div>
          <h3 className="text-[11px] tracking-wide text-faint uppercase">Dependencies</h3>
          <ul aria-label="Dependencies" className="mt-1.5 flex flex-col gap-1">
            {answer.relationships.map((rel) => {
              const href = rel.line ? sourceLineUrl(graph, rel.source, rel.line) : null;
              return (
                <li
                  key={`${rel.source}→${rel.target}`}
                  className="font-mono text-[11px] text-muted"
                >
                  <span className="text-text">{fileName(rel.source)}</span>
                  <span className="text-rose"> → </span>
                  <span className="text-text">{fileName(rel.target)}</span>
                  {rel.typeOnly && <span className="text-faint"> (type only)</span>}
                  {rel.line && (
                    <>
                      {" · "}
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="hover:text-text hover:underline"
                        >
                          line {rel.line}
                        </a>
                      ) : (
                        `line ${rel.line}`
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {answer.evidence.length > 0 && (
        // Without an explanation, the evidence is the answer, so it starts open.
        <details className="text-xs" open={answer.mode === "evidence_only"}>
          <summary className="cursor-pointer text-faint hover:text-text">
            Evidence ({answer.evidence.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {answer.evidence.map((item) => (
              <EvidenceItem key={item.id} item={item} graph={graph} />
            ))}
          </ul>
        </details>
      )}

      {answer.notes.length > 0 && (
        <ul aria-label="Checks" className="flex flex-col gap-1 border-t border-line pt-2">
          {answer.notes.map((note) => (
            <li key={note} className="text-[11px] leading-snug text-faint">
              {note}
            </li>
          ))}
        </ul>
      )}
      {answer.model && <p className="text-[10px] text-faint">Model: {answer.model}</p>}
    </article>
  );
}

function ModeBadge({ answer }: { answer: ArchitectAnswer }) {
  const label =
    answer.mode === "ai"
      ? "AI explanation, checked against the analysis"
      : answer.mode === "evidence_only"
        ? "Evidence only: AI explanations are off on this server"
        : "No matching evidence";
  return <p className="font-mono text-[10px] tracking-wide text-faint uppercase">{label}</p>;
}

function BasisBadge({
  basis,
  downgraded,
}: {
  basis: "verified" | "inferred";
  downgraded: boolean;
}) {
  const verified = basis === "verified";
  return (
    <span
      title={
        verified
          ? "Stated directly by the cited evidence."
          : downgraded
            ? "The model called this verified, but cited nothing that supports it."
            : "An interpretation drawn from the evidence."
      }
      className={`mt-0.5 h-fit shrink-0 rounded px-1 font-mono text-[9px] uppercase ${verified ? "bg-cyan/10 text-cyan" : "bg-amber/10 text-amber"}`}
    >
      {verified ? "Verified" : "Inferred"}
    </span>
  );
}

function EvidenceChip({ id, item }: { id: string; item: Evidence | undefined }) {
  return (
    <span
      title={item ? item.title : undefined}
      className="ml-1 rounded bg-raised px-1 font-mono text-[10px] text-faint"
    >
      {id}
    </span>
  );
}

function LineLinks({
  graph,
  path,
  lines,
}: {
  graph: CodeGraph;
  path: string;
  lines: ArchitectAnswer["files"][number]["lines"];
}) {
  if (lines.length === 0) {
    const href = sourceUrl(graph, path);
    return href ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-0.5 inline-block text-[11px] text-faint hover:text-text hover:underline"
      >
        View source
      </a>
    ) : null;
  }
  return (
    <ul
      className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5"
      aria-label={`Lines in ${fileName(path)}`}
    >
      {lines.map((span) => {
        const href = sourceLineUrl(graph, path, span.start, span.end);
        const text = span.end > span.start ? `L${span.start}–${span.end}` : `L${span.start}`;
        return (
          <li key={`${span.start}-${span.end}`} className="font-mono text-[11px]">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                title={span.label}
                className="text-faint hover:text-text hover:underline"
              >
                {text}
              </a>
            ) : (
              <span className="text-faint">{text}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function EvidenceItem({ item, graph }: { item: Evidence; graph: CodeGraph }) {
  const href =
    item.path && item.lineStart
      ? sourceLineUrl(graph, item.path, item.lineStart, item.lineEnd ?? item.lineStart)
      : null;
  return (
    <li className="rounded border border-line p-2">
      <p className="font-mono text-[11px]">
        <span className="text-faint">{item.id}</span>{" "}
        <span className="text-text">{item.title}</span>
      </p>
      {item.facts.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted">
          {item.facts.map((fact, index) => (
            <li key={index}>{fact}</li>
          ))}
        </ul>
      )}
      {item.snippet && (
        <pre className="mt-1.5 max-h-48 overflow-auto rounded bg-void p-2 font-mono text-[10px] leading-relaxed text-muted">
          {item.snippet}
        </pre>
      )}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 inline-block text-[11px] text-faint hover:text-text hover:underline"
        >
          Open these lines on GitHub
        </a>
      )}
    </li>
  );
}

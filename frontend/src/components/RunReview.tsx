import { useState } from "react";

import { useRunStore } from "../store/runStore";
import type { Domain } from "../types";

const DOMAIN_LABEL: Record<Domain, string> = {
  security_ops: "Security Operations",
  access_controls: "Access Controls",
  risk: "Risk Identification & Analysis",
  incident_response: "Incident Response",
  cryptography: "Cryptography",
  network: "Network Security",
  sys_app_security: "Systems & App Security",
};

const LETTERS = ["A", "B", "C", "D"] as const;

export function RunReview() {
  const missed = useRunStore((s) => s.missed);
  const exitReview = useRunStore((s) => s.exitReview);
  const [index, setIndex] = useState(0);

  if (missed.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <h2 className="text-3xl font-bold text-emerald-400">Nothing to review</h2>
        <p className="text-slate-300">You answered every question correctly. Nicely done.</p>
        <button
          onClick={exitReview}
          className="rounded-xl border border-slate-600 px-6 py-2 hover:bg-space-700"
        >
          Back to summary
        </button>
      </div>
    );
  }

  const safeIndex = Math.min(index, missed.length - 1);
  const q = missed[safeIndex];

  return (
    <div className="flex h-full flex-col items-center gap-4 overflow-y-auto p-6">
      <div className="flex w-full max-w-3xl items-center justify-between">
        <h2 className="text-2xl font-bold text-space-accent">Review missed questions</h2>
        <span className="text-sm text-slate-400">
          {safeIndex + 1} / {missed.length}
        </span>
      </div>

      <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-space-800 p-6">
        <div className="mb-3 inline-block rounded-full border border-slate-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
          {DOMAIN_LABEL[q.domain] ?? q.domain}
        </div>
        <p className="mb-5 text-lg leading-relaxed text-slate-100">{q.stem}</p>

        <ul className="flex flex-col gap-2">
          {q.options.map((opt, i) => {
            const isCorrect = i === q.correctIndex;
            const isChosen = i === q.chosenIndex;
            let cls = "border-slate-700 bg-space-900 text-slate-200";
            if (isCorrect) cls = "border-emerald-500 bg-emerald-500/15 text-emerald-100";
            else if (isChosen) cls = "border-rose-500 bg-rose-500/15 text-rose-100";
            return (
              <li
                key={i}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${cls}`}
              >
                <span className="font-mono text-sm font-bold">{LETTERS[i]}</span>
                <span className="flex-1">{opt}</span>
                {isCorrect && (
                  <span className="text-xs font-bold uppercase tracking-wide text-emerald-300">
                    Correct
                  </span>
                )}
                {isChosen && !isCorrect && (
                  <span className="text-xs font-bold uppercase tracking-wide text-rose-300">
                    Your pick
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {q.explanation && (
          <div className="mt-5 rounded-xl border border-slate-700 bg-space-900 p-4">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-space-accent">
              Explanation
            </div>
            <p className="text-sm leading-relaxed text-slate-200">{q.explanation}</p>
          </div>
        )}
      </div>

      <div className="flex w-full max-w-3xl items-center justify-between pb-4">
        <button
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={safeIndex === 0}
          className="rounded-xl border border-slate-600 px-5 py-2 font-semibold hover:bg-space-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Previous
        </button>
        <button
          onClick={exitReview}
          className="rounded-xl border border-slate-600 px-5 py-2 hover:bg-space-700"
        >
          Back to summary
        </button>
        <button
          onClick={() => setIndex((i) => Math.min(missed.length - 1, i + 1))}
          disabled={safeIndex === missed.length - 1}
          className="rounded-xl bg-space-500 px-5 py-2 font-semibold hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

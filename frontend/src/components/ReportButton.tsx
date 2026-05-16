import { useEffect, useState } from "react";

import { api } from "../api/client";
import { useRunStore } from "../store/runStore";

type Status = "idle" | "submitting" | "success" | "error";

export function ReportButton() {
  const currentQuestion = useRunStore((s) => s.currentQuestion);
  const currentChoice = useRunStore((s) => s.currentChoice);

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Snapshot of which question + choice we opened the modal against, so a
  // background batch advance doesn't change what the player is reporting on.
  const [target, setTarget] = useState<{ id: number; choice: number | null } | null>(null);

  // Hide the toast a moment after success so it doesn't linger across questions.
  useEffect(() => {
    if (status !== "success") return;
    const t = window.setTimeout(() => setStatus("idle"), 2400);
    return () => window.clearTimeout(t);
  }, [status]);

  if (!currentQuestion) return null;

  const openModal = () => {
    setTarget({
      id: currentQuestion.id,
      choice: currentChoice === undefined ? null : currentChoice,
    });
    setReason("");
    setErrorMsg(null);
    setStatus("idle");
    setOpen(true);
  };

  const closeModal = () => {
    if (status === "submitting") return;
    setOpen(false);
  };

  const submit = async () => {
    if (!target) return;
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setErrorMsg("Please describe the issue.");
      return;
    }
    setStatus("submitting");
    setErrorMsg(null);
    try {
      await api.reportQuestion(target.id, {
        reason: trimmed,
        had_answered: target.choice !== null,
        player_pick: target.choice,
      });
      setStatus("success");
      setOpen(false);
    } catch (e) {
      setStatus("error");
      setErrorMsg((e as Error).message || "Failed to submit report.");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Report a problem with this question"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full border border-slate-600 bg-space-800/85 px-3 py-1.5 text-xs font-medium text-slate-300 shadow-lg backdrop-blur transition hover:border-rose-400 hover:text-rose-200"
      >
        <span aria-hidden>⚑</span>
        Report question
      </button>

      {status === "success" && !open && (
        <div className="fixed bottom-16 right-4 z-40 rounded-md border border-emerald-500/60 bg-emerald-900/85 px-3 py-1.5 text-xs text-emerald-100 shadow-lg backdrop-blur">
          Thanks — report submitted.
        </div>
      )}

      {open && target && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="w-[min(560px,92vw)] rounded-xl border border-slate-600 bg-space-800 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <h3 className="text-lg font-semibold text-slate-100">Report this question</h3>
              <button
                type="button"
                onClick={closeModal}
                disabled={status === "submitting"}
                className="text-slate-400 transition hover:text-slate-100 disabled:opacity-40"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-slate-400">
              Question #{target.id}
              {target.choice !== null && (
                <>
                  {" · "}You picked{" "}
                  <span className="text-slate-200">
                    {String.fromCharCode(65 + target.choice)}
                  </span>
                </>
              )}
            </p>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              What's wrong with it?
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={status === "submitting"}
              maxLength={2000}
              rows={5}
              placeholder="e.g. The keyed answer looks wrong, two options seem equally correct, typo in the stem…"
              className="w-full rounded-md border border-slate-600 bg-space-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-space-accent focus:outline-none"
              autoFocus
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>{reason.length} / 2000</span>
              {errorMsg && <span className="text-rose-400">{errorMsg}</span>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={status === "submitting"}
                className="rounded-md border border-slate-600 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-space-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={status === "submitting" || reason.trim().length === 0}
                className="rounded-md bg-rose-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === "submitting" ? "Sending…" : "Submit report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

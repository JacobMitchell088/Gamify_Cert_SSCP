import { useEffect, useState } from "react";

import { api } from "../api/client";
import { trackEvent } from "../lib/analytics";
import { useRunStore } from "../store/runStore";

type Status = "idle" | "submitting" | "success" | "error";

type Category = "general" | "bug" | "idea" | "praise";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "general", label: "General" },
  { value: "bug", label: "Bug" },
  { value: "idea", label: "Idea" },
  { value: "praise", label: "Praise" },
];

export function FeedbackButton() {
  const selectedGameKey = useRunStore((s) => s.selectedGameKey);
  const phase = useRunStore((s) => s.phase);

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<Category>("general");
  const [contact, setContact] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "success") return;
    const t = window.setTimeout(() => setStatus("idle"), 2400);
    return () => window.clearTimeout(t);
  }, [status]);

  const openModal = () => {
    setMessage("");
    setContact("");
    setCategory("general");
    setErrorMsg(null);
    setStatus("idle");
    setOpen(true);
  };

  const closeModal = () => {
    if (status === "submitting") return;
    setOpen(false);
  };

  const submit = async () => {
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      setErrorMsg("Please enter your feedback.");
      return;
    }
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const page = `${phase}${selectedGameKey ? `:${selectedGameKey}` : ""}`;
      await api.submitFeedback({
        message: trimmed,
        category,
        contact: contact.trim() || null,
        page,
      });
      trackEvent("feedback_submitted", {
        category,
        has_contact: contact.trim().length > 0,
        page,
      });
      setStatus("success");
      setOpen(false);
    } catch (e) {
      setStatus("error");
      setErrorMsg((e as Error).message || "Failed to submit feedback.");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Send feedback to the developer"
        className="fixed bottom-20 right-4 z-40 flex items-center gap-2.5 rounded-full border border-slate-600 bg-space-800/85 px-6 py-3 text-base font-medium text-slate-300 shadow-lg backdrop-blur transition hover:border-sky-400 hover:text-sky-200"
      >
        <span aria-hidden>💬</span>
        Send feedback
      </button>

      {status === "success" && !open && (
        <div className="fixed bottom-32 right-4 z-40 rounded-md border border-emerald-500/60 bg-emerald-900/85 px-3 py-1.5 text-xs text-emerald-100 shadow-lg backdrop-blur">
          Thanks — feedback sent.
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="w-[min(560px,92vw)] rounded-xl border border-slate-600 bg-space-800 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <h3 className="text-lg font-semibold text-slate-100">Send feedback</h3>
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
              Goes straight to the developer as a GitHub issue. No account required.
            </p>

            <label className="mb-1 block text-xs font-medium text-slate-300">Category</label>
            <div className="mb-3 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  type="button"
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  disabled={status === "submitting"}
                  className={`rounded-md border px-3 py-1 text-xs transition ${
                    category === c.value
                      ? "border-sky-400 bg-sky-900/40 text-sky-100"
                      : "border-slate-600 text-slate-300 hover:bg-space-700"
                  } disabled:opacity-50`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <label className="mb-1 block text-xs font-medium text-slate-300">Your feedback</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={status === "submitting"}
              maxLength={4000}
              rows={6}
              placeholder="What worked, what broke, what you'd love to see…"
              className="w-full rounded-md border border-slate-600 bg-space-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-space-accent focus:outline-none"
              autoFocus
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>{message.length} / 4000</span>
              {errorMsg && <span className="text-rose-400">{errorMsg}</span>}
            </div>

            <label className="mt-3 mb-1 block text-xs font-medium text-slate-300">
              Contact (optional)
            </label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              disabled={status === "submitting"}
              maxLength={200}
              placeholder="email, handle, anything if you want a reply"
              className="w-full rounded-md border border-slate-600 bg-space-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-space-accent focus:outline-none"
            />

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
                disabled={status === "submitting" || message.trim().length === 0}
                className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === "submitting" ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import { useState } from "react";

import { useRunStore } from "../store/runStore";

export function ExitButton() {
  const quitToMenu = useRunStore((s) => s.quitToMenu);
  const [open, setOpen] = useState(false);

  const confirm = () => {
    setOpen(false);
    quitToMenu();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Exit to lobby"
        className="fixed bottom-4 left-4 z-40 flex items-center gap-1.5 rounded-full border border-slate-600 bg-space-800/85 px-3 py-1.5 text-xs font-medium text-slate-300 shadow-lg backdrop-blur transition hover:border-amber-400 hover:text-amber-200"
      >
        <span aria-hidden>←</span>
        Exit to lobby
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-[min(440px,92vw)] rounded-xl border border-slate-600 bg-space-800 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-100">Leave the run?</h3>
            <p className="mt-2 text-sm text-slate-300">
              Your current progress will be lost and you'll return to the lobby. Are you
              sure you want to exit?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-600 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-space-700"
              >
                Stay
              </button>
              <button
                type="button"
                onClick={confirm}
                className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-amber-500"
              >
                Exit to lobby
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import { readLocalProgress, useRunStore } from "../store/runStore";

export function Menu() {
  const startRun = useRunStore((s) => s.startRun);
  const progress = readLocalProgress();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-5xl font-bold tracking-tight text-space-accent">
        SSCP Gauntlet
      </h1>
      <p className="max-w-xl text-center text-slate-300">
        Run a rotating gauntlet of arcade mini-games. Each round throws SSCP
        practice questions at you in a different way. Stay sharp.
      </p>

      <div className="rounded-2xl border border-slate-700 bg-space-800 px-6 py-4 text-sm text-slate-300">
        <div>Career XP: <span className="text-space-accent">{progress.totalXP.toLocaleString()}</span></div>
        <div>Best streak: <span className="text-space-accent">{progress.bestStreak}</span></div>
        <div>Runs completed: <span className="text-space-accent">{progress.runsCompleted}</span></div>
      </div>

      <button
        onClick={() => void startRun()}
        className="rounded-xl bg-space-500 px-10 py-4 text-lg font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:scale-105 hover:bg-indigo-500"
      >
        ▶ Play
      </button>
    </div>
  );
}

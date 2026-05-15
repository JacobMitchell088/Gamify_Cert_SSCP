import { useRunStore } from "../store/runStore";

export function RunSummary() {
  const score = useRunStore((s) => s.score);
  const totalAnswered = useRunStore((s) => s.totalAnswered);
  const totalCorrect = useRunStore((s) => s.totalCorrect);
  const bestStreak = useRunStore((s) => s.bestStreak);
  const reset = useRunStore((s) => s.reset);
  const startRun = useRunStore((s) => s.startRun);

  const accuracy = totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <h2 className="text-4xl font-bold text-space-accent">Run Complete</h2>
      <div className="grid grid-cols-2 gap-x-12 gap-y-3 rounded-2xl border border-slate-700 bg-space-800 px-10 py-6 font-mono">
        <span className="text-slate-400">Score</span>
        <span className="text-right text-space-accent">{score.toLocaleString()}</span>
        <span className="text-slate-400">Accuracy</span>
        <span className="text-right text-space-accent">{accuracy}%</span>
        <span className="text-slate-400">Correct</span>
        <span className="text-right">{totalCorrect} / {totalAnswered}</span>
        <span className="text-slate-400">Best streak</span>
        <span className="text-right">{bestStreak}</span>
      </div>
      <div className="flex gap-4">
        <button
          onClick={() => void startRun()}
          className="rounded-xl bg-space-500 px-8 py-3 font-semibold hover:bg-indigo-500"
        >
          Play again
        </button>
        <button
          onClick={reset}
          className="rounded-xl border border-slate-600 px-8 py-3 font-semibold hover:bg-space-700"
        >
          Menu
        </button>
      </div>
    </div>
  );
}

import { useRunStore } from "../store/runStore";

export function HUD() {
  const score = useRunStore((s) => s.score);
  const streak = useRunStore((s) => s.streak);
  const batchIndex = useRunStore((s) => s.batchIndex);
  const totalAnswered = useRunStore((s) => s.totalAnswered);
  const gameKey = useRunStore((s) => s.gameKey);

  return (
    <div className="flex items-center justify-between border-b border-slate-700 bg-space-800/70 px-6 py-3 text-sm">
      <div className="font-mono text-slate-400">
        Game <span className="text-space-accent">{gameKey ?? "—"}</span> · Round{" "}
        <span className="text-space-accent">{batchIndex + 1}</span>
      </div>
      <div className="flex gap-6 font-mono">
        <span>Q <span className="text-space-accent">{totalAnswered}</span></span>
        <span>Streak <span className="text-space-accent">{streak}</span></span>
        <span>Score <span className="text-space-accent">{score}</span></span>
      </div>
    </div>
  );
}

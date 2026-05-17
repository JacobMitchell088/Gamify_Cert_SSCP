import { useEffect } from "react";

import { ExitButton } from "./components/ExitButton";
import { GameOverview } from "./components/GameOverview";
import { HUD } from "./components/HUD";
import { Menu } from "./components/Menu";
import { ReportButton } from "./components/ReportButton";
import { RunReview } from "./components/RunReview";
import { RunSummary } from "./components/RunSummary";
import { GameHost } from "./games/GameHost";
import { useRunStore } from "./store/runStore";
import { api } from "./api/client";

export default function App() {
  const phase = useRunStore((s) => s.phase);
  const errorMessage = useRunStore((s) => s.errorMessage);
  const reset = useRunStore((s) => s.reset);

  useEffect(() => {
    api.health().catch(() => {
      // surfaced via errorMessage if it matters for a Play attempt
    });
  }, []);

  if (phase === "menu") return <Menu />;
  if (phase === "overview") return <GameOverview />;
  if (phase === "loading") return <LoadingScreen />;
  if (phase === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <h2 className="text-2xl font-bold text-rose-400">Backend not reachable</h2>
        <p className="text-slate-300">{errorMessage}</p>
        <p className="text-sm text-slate-500">
          Make sure the backend is running on <code>localhost:8000</code>.
        </p>
        <button
          onClick={reset}
          className="rounded-xl border border-slate-600 px-6 py-2 hover:bg-space-700"
        >
          Back to menu
        </button>
      </div>
    );
  }
  if (phase === "summary") return <RunSummary />;
  if (phase === "review") return <RunReview />;

  return (
    <div className="flex h-full flex-col">
      <HUD />
      <GameHost />
      <ReportButton />
      <ExitButton />
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-full items-center justify-center text-slate-400">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-space-accent border-t-transparent" />
        <div>Warming up the gauntlet…</div>
      </div>
    </div>
  );
}

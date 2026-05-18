import { useEffect, useState } from "react";

import { ExitButton } from "./components/ExitButton";
import { FeedbackButton } from "./components/FeedbackButton";
import { GameOverview } from "./components/GameOverview";
import { HUD } from "./components/HUD";
import { Menu } from "./components/Menu";
import { ReportButton } from "./components/ReportButton";
import { RunReview } from "./components/RunReview";
import { RunSummary } from "./components/RunSummary";
import { GameHost } from "./games/GameHost";
import { useBackendStatus } from "./store/backendStatus";
import { useRunStore } from "./store/runStore";

export default function App() {
  const phase = useRunStore((s) => s.phase);
  const errorMessage = useRunStore((s) => s.errorMessage);
  const reset = useRunStore((s) => s.reset);
  const startWarmup = useBackendStatus((s) => s.startWarmup);

  useEffect(() => {
    // Fire the cold-start ping as soon as the user lands so the backend is
    // already warm by the time they hit Play. The store polls until ready.
    startWarmup();
  }, [startWarmup]);

  return (
    <>
      <PhaseContent phase={phase} errorMessage={errorMessage} reset={reset} />
      <FeedbackButton />
    </>
  );
}

interface PhaseContentProps {
  phase: ReturnType<typeof useRunStore.getState>["phase"];
  errorMessage?: string;
  reset: () => void;
}

function PhaseContent({ phase, errorMessage, reset }: PhaseContentProps) {
  if (phase === "menu") return <Menu />;
  if (phase === "overview") return <GameOverview />;
  if (phase === "loading") return <LoadingScreen />;
  if (phase === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <h2 className="text-2xl font-bold text-rose-400">Backend not reachable</h2>
        <p className="text-slate-300">{errorMessage}</p>
        <p className="text-sm text-slate-500">
          The backend may still be waking up from a cold start — give it ~60 seconds
          and try again.
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
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((performance.now() - start) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const expected = 60;
  const pct = Math.min(100, Math.round((elapsed / expected) * 100));
  const overdue = elapsed > expected;

  return (
    <div className="flex h-full items-center justify-center text-slate-400">
      <div className="flex flex-col items-center gap-3 px-6">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-space-accent border-t-transparent" />
        <div className="text-lg text-slate-200">Warming up the gauntlet…</div>
        <div className="font-mono text-sm text-slate-300">
          {elapsed}s {overdue ? "(taking longer than usual)" : `/ ~${expected}s expected`}
        </div>
        <div className="h-1.5 w-64 overflow-hidden rounded-full bg-space-700">
          <div
            className="h-full bg-space-accent transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="max-w-md text-center text-xs text-slate-500">
          Free-tier backend cold start — first load after a 15-minute idle period
          can take up to a minute. It's not stuck.
        </div>
      </div>
    </div>
  );
}

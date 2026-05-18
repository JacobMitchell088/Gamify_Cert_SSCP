import { create } from "zustand";

import { api } from "../api/client";
import { trackEvent } from "../lib/analytics";
import type { AnswerResult, Batch, Domain, Question } from "../types";

export type Phase =
  | "menu"
  | "overview"
  | "loading"
  | "playing"
  | "summary"
  | "review"
  | "error";

export interface MissedQuestion {
  id: number;
  stem: string;
  options: [string, string, string, string];
  domain: Domain;
  chosenIndex: number;
  correctIndex: number;
  explanation: string;
}

interface RunState {
  phase: Phase;
  errorMessage?: string;
  runId?: number;
  gameKey?: string;
  selectedGameKey: string;
  batchIndex: number;
  isFinalBatch: boolean;
  queue: Question[];
  currentQuestion?: Question;
  /** Index the player picked for the current question, or undefined before answer. */
  currentChoice?: number;
  score: number;
  streak: number;
  bestStreak: number;
  totalAnswered: number;
  totalCorrect: number;
  missed: MissedQuestion[];
  setSelectedGame: (key: string) => void;
  startRun: () => Promise<void>;
  recordAnswer: (chosenIndex: number) => Promise<AnswerResult>;
  advance: () => Promise<void>;
  abortRun: () => void;
  quitToMenu: () => void;
  startReview: () => void;
  exitReview: () => void;
  reset: () => void;
}

function loadBatchIntoState(
  b: Batch,
  forcedGameKey?: string,
): Partial<RunState> {
  const [head, ...rest] = b.questions;
  return {
    runId: b.run_id,
    gameKey: forcedGameKey ?? b.game_key,
    batchIndex: b.batch_index,
    isFinalBatch: b.is_final,
    queue: rest,
    currentQuestion: head,
    currentChoice: undefined,
    phase: "playing",
  };
}

// Module-level re-entrancy guards. These live outside the Zustand state so they
// don't trigger re-renders; they only protect the network calls from being
// double-fired by a fast clicker or by two scenes racing the same action.
let answerInflight: Promise<AnswerResult> | null = null;
let advanceInflight: Promise<void> | null = null;

export const useRunStore = create<RunState>((set, get) => ({
  phase: "menu",
  batchIndex: 0,
  isFinalBatch: false,
  queue: [],
  score: 0,
  streak: 0,
  bestStreak: 0,
  totalAnswered: 0,
  totalCorrect: 0,
  missed: [],
  selectedGameKey: "tower_defense",

  setSelectedGame: (key: string) => {
    if (get().selectedGameKey !== key) {
      trackEvent("game_selected", { game_key: key });
    }
    set({ selectedGameKey: key });
  },

  startRun: async () => {
    set({ phase: "loading", errorMessage: undefined });
    try {
      const batch = await api.startRun();
      const choice = get().selectedGameKey;
      set({
        score: 0,
        streak: 0,
        bestStreak: 0,
        totalAnswered: 0,
        totalCorrect: 0,
        missed: [],
        ...loadBatchIntoState(batch, choice),
      });
      trackEvent("play_started", { game_key: choice, run_id: batch.run_id });
    } catch (e) {
      set({ phase: "error", errorMessage: (e as Error).message });
    }
  },

  recordAnswer: async (chosenIndex: number) => {
    // A previous click is still resolving — return that same promise instead of
    // firing a second /answer for the (already-graded) question.
    if (answerInflight) return answerInflight;
    const { runId, currentQuestion } = get();
    if (!runId || !currentQuestion) {
      return { correct: false, correct_index: -1, explanation: "" };
    }
    const run = async (): Promise<AnswerResult> => {
      const result = await api.submitAnswer(runId, currentQuestion.id, chosenIndex);
      set({ currentChoice: chosenIndex });
      return result;
    };
    answerInflight = run();
    let result: AnswerResult;
    try {
      result = await answerInflight;
    } finally {
      answerInflight = null;
    }
    set((s) => {
      const newStreak = result.correct ? s.streak + 1 : 0;
      const missed = result.correct
        ? s.missed
        : [
            ...s.missed,
            {
              id: currentQuestion.id,
              stem: currentQuestion.stem,
              options: currentQuestion.options,
              domain: currentQuestion.domain,
              chosenIndex,
              correctIndex: result.correct_index,
              explanation: result.explanation,
            },
          ];
      return {
        score: s.score + (result.correct ? 100 + s.streak * 10 : 0),
        streak: newStreak,
        bestStreak: Math.max(s.bestStreak, newStreak),
        totalAnswered: s.totalAnswered + 1,
        totalCorrect: s.totalCorrect + (result.correct ? 1 : 0),
        missed,
      };
    });
    return result;
  },

  advance: async () => {
    // Coalesce double-clicks on Continue: if a fetch is already in flight, the
    // second caller just waits on the same promise instead of skipping a
    // question or fetching a redundant batch.
    if (advanceInflight) return advanceInflight;
    const { queue, runId, isFinalBatch } = get();
    if (queue.length > 0) {
      set({
        currentQuestion: queue[0],
        queue: queue.slice(1),
        currentChoice: undefined,
      });
      return;
    }
    if (isFinalBatch || !runId) {
      const finalState = get();
      try {
        await api.finishRun(runId!);
      } catch {
        // non-fatal: summary still renders
      }
      persistLocalProgress(finalState.score, finalState.bestStreak);
      trackEvent("play_finished", {
        reason: "completed",
        game_key: finalState.gameKey ?? "unknown",
        score: finalState.score,
        total_answered: finalState.totalAnswered,
        total_correct: finalState.totalCorrect,
      });
      set({ phase: "summary" });
      return;
    }
    // Do NOT set phase: "loading" here — it would unmount GameHost between
    // batches, destroying the Phaser.Game and wiping the per-scene registry
    // (which is where TD/RPG persist their HP and progress). Keep GameHost
    // mounted; the scene stays on the feedback panel while the new batch
    // arrives, then re-inits with the next question.
    const fetchAndLoad = async () => {
      try {
        const batch = await api.nextBatch(runId);
        const choice = get().selectedGameKey;
        set(loadBatchIntoState(batch, choice));
      } catch (e) {
        set({ phase: "error", errorMessage: (e as Error).message });
      }
    };
    advanceInflight = fetchAndLoad();
    try {
      await advanceInflight;
    } finally {
      advanceInflight = null;
    }
  },

  abortRun: () => {
    const s = get();
    if (s.runId) {
      api.finishRun(s.runId).catch(() => {});
    }
    persistLocalProgress(s.score, s.bestStreak);
    trackEvent("play_finished", {
      reason: "lost",
      game_key: s.gameKey ?? "unknown",
      score: s.score,
      total_answered: s.totalAnswered,
      total_correct: s.totalCorrect,
    });
    set({ phase: "summary" });
  },

  quitToMenu: () => {
    const s = get();
    if (s.runId) {
      api.finishRun(s.runId).catch(() => {});
      trackEvent("play_finished", {
        reason: "quit",
        game_key: s.gameKey ?? "unknown",
        score: s.score,
        total_answered: s.totalAnswered,
        total_correct: s.totalCorrect,
      });
    }
    set({
      phase: "menu",
      errorMessage: undefined,
      runId: undefined,
      gameKey: undefined,
      batchIndex: 0,
      isFinalBatch: false,
      queue: [],
      currentQuestion: undefined,
      currentChoice: undefined,
      score: 0,
      streak: 0,
      bestStreak: 0,
      totalAnswered: 0,
      totalCorrect: 0,
      missed: [],
    });
  },

  startReview: () => set({ phase: "review" }),
  exitReview: () => set({ phase: "summary" }),

  reset: () => set({ phase: "menu", errorMessage: undefined }),
}));

const LS_KEY = "sscp-progress-v1";

interface LocalProgress {
  totalXP: number;
  bestStreak: number;
  runsCompleted: number;
}

export function readLocalProgress(): LocalProgress {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { totalXP: 0, bestStreak: 0, runsCompleted: 0 };
    return JSON.parse(raw) as LocalProgress;
  } catch {
    return { totalXP: 0, bestStreak: 0, runsCompleted: 0 };
  }
}

function persistLocalProgress(score: number, bestStreak: number): void {
  const prev = readLocalProgress();
  const next: LocalProgress = {
    totalXP: prev.totalXP + score,
    bestStreak: Math.max(prev.bestStreak, bestStreak),
    runsCompleted: prev.runsCompleted + 1,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(next));
}

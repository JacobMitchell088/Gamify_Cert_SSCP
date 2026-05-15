import { create } from "zustand";

import { api } from "../api/client";
import type { AnswerResult, Batch, Domain, Question } from "../types";

export type Phase = "menu" | "loading" | "playing" | "summary" | "review" | "error";

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
  startReview: () => void;
  exitReview: () => void;
  reset: () => void;
}

function loadBatchIntoState(
  s: Partial<RunState>,
  b: Batch,
  forcedGameKey?: string,
): Partial<RunState> {
  const [head, ...rest] = b.questions;
  return {
    ...s,
    runId: b.run_id,
    gameKey: forcedGameKey ?? b.game_key,
    batchIndex: b.batch_index,
    isFinalBatch: b.is_final,
    queue: rest,
    currentQuestion: head,
    phase: "playing",
  };
}

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

  setSelectedGame: (key: string) => set({ selectedGameKey: key }),

  startRun: async () => {
    set({ phase: "loading", errorMessage: undefined });
    try {
      const batch = await api.startRun();
      const choice = get().selectedGameKey;
      set((s) => ({
        ...s,
        score: 0,
        streak: 0,
        bestStreak: 0,
        totalAnswered: 0,
        totalCorrect: 0,
        missed: [],
        ...loadBatchIntoState(s, batch, choice),
      }));
    } catch (e) {
      set({ phase: "error", errorMessage: (e as Error).message });
    }
  },

  recordAnswer: async (chosenIndex: number) => {
    const { runId, currentQuestion } = get();
    if (!runId || !currentQuestion) {
      return { correct: false, correct_index: -1, explanation: "" };
    }
    const result = await api.submitAnswer(runId, currentQuestion.id, chosenIndex);
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
    const { queue, runId, isFinalBatch } = get();
    if (queue.length > 0) {
      set({
        currentQuestion: queue[0],
        queue: queue.slice(1),
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
      set({ phase: "summary" });
      return;
    }
    set({ phase: "loading" });
    try {
      const batch = await api.nextBatch(runId);
      const choice = get().selectedGameKey;
      set((s) => ({ ...loadBatchIntoState(s, batch, choice) }));
    } catch (e) {
      set({ phase: "error", errorMessage: (e as Error).message });
    }
  },

  abortRun: () => {
    const { runId, score, bestStreak } = get();
    if (runId) {
      api.finishRun(runId).catch(() => {});
    }
    persistLocalProgress(score, bestStreak);
    set({ phase: "summary" });
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

import { create } from "zustand";

import { api } from "../api/client";
import type { AnswerResult, Batch, Question } from "../types";

export type Phase = "menu" | "loading" | "playing" | "summary" | "error";

interface RunState {
  phase: Phase;
  errorMessage?: string;
  runId?: number;
  gameKey?: string;
  batchIndex: number;
  isFinalBatch: boolean;
  queue: Question[];
  currentQuestion?: Question;
  score: number;
  streak: number;
  bestStreak: number;
  totalAnswered: number;
  totalCorrect: number;
  startRun: () => Promise<void>;
  recordAnswer: (chosenIndex: number) => Promise<AnswerResult>;
  advance: () => Promise<void>;
  reset: () => void;
}

function loadBatchIntoState(s: Partial<RunState>, b: Batch): Partial<RunState> {
  const [head, ...rest] = b.questions;
  return {
    ...s,
    runId: b.run_id,
    gameKey: b.game_key,
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

  startRun: async () => {
    set({ phase: "loading", errorMessage: undefined });
    try {
      const batch = await api.startRun();
      set((s) => ({
        ...s,
        score: 0,
        streak: 0,
        bestStreak: 0,
        totalAnswered: 0,
        totalCorrect: 0,
        ...loadBatchIntoState(s, batch),
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
      return {
        score: s.score + (result.correct ? 100 + s.streak * 10 : 0),
        streak: newStreak,
        bestStreak: Math.max(s.bestStreak, newStreak),
        totalAnswered: s.totalAnswered + 1,
        totalCorrect: s.totalCorrect + (result.correct ? 1 : 0),
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
      set((s) => ({ ...loadBatchIntoState(s, batch) }));
    } catch (e) {
      set({ phase: "error", errorMessage: (e as Error).message });
    }
  },

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

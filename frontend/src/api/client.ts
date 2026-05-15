import type { AnswerResult, Batch } from "../types";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!r.ok) {
    throw new Error(`${r.status} ${r.statusText}`);
  }
  return (await r.json()) as T;
}

export const api = {
  health: () => jsonFetch<{ status: string }>("/health"),
  startRun: () => jsonFetch<Batch>("/run/start", { method: "POST" }),
  nextBatch: (runId: number) => jsonFetch<Batch>(`/run/${runId}/next-batch`),
  submitAnswer: (runId: number, questionId: number, chosenIndex: number) =>
    jsonFetch<AnswerResult>(`/run/${runId}/answer`, {
      method: "POST",
      body: JSON.stringify({ question_id: questionId, chosen_index: chosenIndex }),
    }),
  finishRun: (runId: number) =>
    jsonFetch<{ run_id: number; question_count: number; correct_count: number }>(
      `/run/${runId}/finish`,
      { method: "POST" },
    ),
};

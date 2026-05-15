import type { AnswerResult, Question } from "../types";

export interface SceneData {
  question: Question;
  recordAnswer: (chosenIndex: number) => Promise<AnswerResult>;
  onComplete: () => void;
  abortRun: () => void;
}

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

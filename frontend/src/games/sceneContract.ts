import type { AnswerResult, Question } from "../types";

export interface SceneData {
  question: Question;
  recordAnswer: (chosenIndex: number) => Promise<AnswerResult>;
  onComplete: () => void;
}

export const GAME_WIDTH = 900;
export const GAME_HEIGHT = 560;

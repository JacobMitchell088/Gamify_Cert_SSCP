import Phaser from "phaser";

import type { AnswerResult, Question } from "../types";

export interface SceneData {
  question: Question;
  recordAnswer: (chosenIndex: number) => Promise<AnswerResult>;
  onComplete: () => void;
  abortRun: () => void;
}

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/**
 * Returns a "✓ DEV" badge container if this is the correct answer AND the
 * backend is sending `correct_index` (dev_reveal_answers=True). Otherwise
 * returns null. Caller adds the returned object to the option-card container
 * at the top-right corner. See CLAUDE.md §11.
 */
export function makeDevAnswerBadge(
  scene: Phaser.Scene,
  question: Question,
  optionIndex: number,
  cardWidth: number,
  cardHeight: number,
): Phaser.GameObjects.Container | null {
  if (question.correct_index === undefined) return null;
  if (question.correct_index !== optionIndex) return null;
  const c = scene.add.container(cardWidth / 2 - 24, -cardHeight / 2 + 12);
  const bg = scene.add
    .rectangle(0, 0, 40, 16, 0x4ade80, 0.95)
    .setStrokeStyle(1, 0x16a34a);
  const txt = scene.add
    .text(0, 0, "✓ DEV", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "9px",
      color: "#062e0f",
      fontStyle: "bold",
    })
    .setOrigin(0.5);
  c.add([bg, txt]);
  return c;
}

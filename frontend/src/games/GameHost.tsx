import Phaser from "phaser";
import { useEffect, useRef } from "react";

import { useRunStore } from "../store/runStore";
import type { Question } from "../types";
import { AsteroidAnswerScene } from "./AsteroidAnswerScene";
import { RpgBossScene } from "./RpgBossScene";
import { GAME_HEIGHT, GAME_WIDTH, type SceneData } from "./sceneContract";
import { TowerDefenseScene } from "./TowerDefenseScene";

const SCENE_KEY_BY_GAME: Record<string, string> = {
  tower_defense: "TowerDefenseScene",
  rpg_boss: "RpgBossScene",
  asteroid_answer: "AsteroidAnswerScene",
};

const DEFAULT_SCENE_KEY = "TowerDefenseScene";

export function GameHost() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const launchedFor = useRef<number | null>(null);
  const currentQuestion = useRunStore((s) => s.currentQuestion);
  const gameKey = useRunStore((s) => s.gameKey);
  const recordAnswer = useRunStore((s) => s.recordAnswer);
  const advance = useRunStore((s) => s.advance);
  const abortRun = useRunStore((s) => s.abortRun);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;
    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      backgroundColor: "#05060f",
      scene: [TowerDefenseScene, RpgBossScene, AsteroidAnswerScene],
      scale: { mode: Phaser.Scale.NONE },
      render: { pixelArt: false, antialias: true, roundPixels: true },
      disableContextMenu: true,
    });
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      launchedFor.current = null;
    };
  }, []);

  useEffect(() => {
    const game = gameRef.current;
    if (!game || !currentQuestion) return;
    if (launchedFor.current === currentQuestion.id) return;
    launchedFor.current = currentQuestion.id;

    const sceneKey = SCENE_KEY_BY_GAME[gameKey ?? ""] ?? DEFAULT_SCENE_KEY;

    // Stop any other scene that might still be active.
    for (const k of Object.values(SCENE_KEY_BY_GAME)) {
      if (k !== sceneKey && game.scene.isActive(k)) game.scene.stop(k);
    }
    if (game.scene.isActive(sceneKey)) game.scene.stop(sceneKey);

    const data: SceneData = {
      question: currentQuestion as Question,
      recordAnswer,
      onComplete: () => {
        void advance();
      },
      abortRun,
    };
    game.scene.start(sceneKey, data);
  }, [currentQuestion?.id, gameKey, recordAnswer, advance, abortRun]);

  return (
    <div className="relative flex flex-1 items-center justify-center bg-space-900">
      <div
        ref={containerRef}
        className="overflow-hidden rounded-2xl border border-slate-700"
        style={{ width: GAME_WIDTH, height: GAME_HEIGHT }}
      />
    </div>
  );
}

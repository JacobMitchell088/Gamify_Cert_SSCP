import Phaser from "phaser";

import type { AnswerResult, Question } from "../types";
import { GAME_HEIGHT, GAME_WIDTH, type SceneData } from "./sceneContract";

const LANE_COUNT = 4;
const LANE_WIDTH = GAME_WIDTH / LANE_COUNT;
const PORTAL_Y = 80;
const SHIP_Y = GAME_HEIGHT - 70;

export class AsteroidAnswerScene extends Phaser.Scene {
  private ship!: Phaser.GameObjects.Triangle;
  private portals: Phaser.GameObjects.Container[] = [];
  private currentLane = 1;
  private committed = false;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private asteroids: Phaser.GameObjects.Arc[] = [];
  private stars: Phaser.GameObjects.Arc[] = [];
  private question!: Question;
  private recordAnswer!: (idx: number) => Promise<AnswerResult>;
  private onComplete!: () => void;
  private moveCooldown = 0;
  private inFeedback = false;

  constructor() {
    super({ key: "AsteroidAnswerScene" });
  }

  init(data: SceneData) {
    this.question = data.question;
    this.recordAnswer = data.recordAnswer;
    this.onComplete = data.onComplete;
    this.committed = false;
    this.inFeedback = false;
    this.currentLane = 1;
    this.portals = [];
    this.asteroids = [];
    this.stars = [];
    this.moveCooldown = 0;
  }

  create() {
    this.cameras.main.setBackgroundColor("#05060f");

    for (let i = 0; i < 80; i++) {
      const star = this.add.circle(
        Phaser.Math.Between(0, GAME_WIDTH),
        Phaser.Math.Between(0, GAME_HEIGHT),
        Phaser.Math.FloatBetween(0.5, 1.6),
        0xffffff,
        Phaser.Math.FloatBetween(0.3, 0.9),
      );
      this.stars.push(star);
    }

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, this.wrap(this.question.stem, 80), {
        fontFamily: "system-ui, sans-serif",
        fontSize: "18px",
        color: "#cbd5f5",
        align: "center",
        wordWrap: { width: GAME_WIDTH - 80 },
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 70, "← / → or A / D to steer · SPACE to commit", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#64748b",
      })
      .setOrigin(0.5);

    for (let i = 0; i < LANE_COUNT; i++) {
      const x = LANE_WIDTH * (i + 0.5);
      const portal = this.add.container(x, PORTAL_Y);
      const ring = this.add.ellipse(0, 0, LANE_WIDTH - 30, 60, 0x11163a, 0.9).setStrokeStyle(2, 0x3b3fff, 0.9);
      const label = this.add
        .text(0, 0, this.wrap(this.question.options[i], 22), {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          color: "#e2e8f0",
          align: "center",
          wordWrap: { width: LANE_WIDTH - 40 },
        })
        .setOrigin(0.5);
      portal.add([ring, label]);
      this.portals.push(portal);
    }

    const ship = this.add.triangle(
      LANE_WIDTH * (this.currentLane + 0.5),
      SHIP_Y,
      0, 24, 14, -12, -14, -12,
      0x7af0ff,
    );
    ship.setStrokeStyle(2, 0xffffff, 1);
    this.ship = ship;

    for (let i = 0; i < 8; i++) this.spawnAsteroid();

    const keyboard = this.input.keyboard!;
    this.cursors = keyboard.createCursorKeys();
    this.keyA = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keySpace = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  }

  update(_time: number, delta: number) {
    if (this.committed) return;
    if (this.moveCooldown > 0) this.moveCooldown -= delta;

    const left = this.cursors.left?.isDown || this.keyA.isDown;
    const right = this.cursors.right?.isDown || this.keyD.isDown;
    if (this.moveCooldown <= 0) {
      if (left && this.currentLane > 0) {
        this.currentLane -= 1;
        this.moveCooldown = 150;
      } else if (right && this.currentLane < LANE_COUNT - 1) {
        this.currentLane += 1;
        this.moveCooldown = 150;
      }
    }

    const targetX = LANE_WIDTH * (this.currentLane + 0.5);
    this.ship.x = Phaser.Math.Linear(this.ship.x, targetX, Math.min(0.25, delta / 60));

    this.portals.forEach((p, i) => {
      const ring = p.list[0] as Phaser.GameObjects.Ellipse;
      const active = i === this.currentLane;
      ring.setStrokeStyle(active ? 3 : 2, active ? 0x7af0ff : 0x3b3fff, active ? 1 : 0.7);
    });

    this.stars.forEach((s) => {
      s.y += 0.4;
      if (s.y > GAME_HEIGHT) {
        s.y = 0;
        s.x = Phaser.Math.Between(0, GAME_WIDTH);
      }
    });

    this.asteroids.forEach((a) => {
      a.y += a.getData("speed");
      a.rotation += 0.02;
      if (a.y - a.radius > GAME_HEIGHT) this.resetAsteroid(a);
      const dx = a.x - this.ship.x;
      const dy = a.y - this.ship.y;
      if (Math.hypot(dx, dy) < a.radius + 12) {
        this.cameras.main.shake(120, 0.005);
        this.resetAsteroid(a);
      }
    });

    if (this.keySpace.isDown) void this.commit();
  }

  private async commit() {
    if (this.committed) return;
    this.committed = true;
    const chosen = this.currentLane;
    await new Promise<void>((res) =>
      this.tweens.add({
        targets: this.ship,
        y: PORTAL_Y,
        duration: 350,
        ease: "Quad.easeIn",
        onComplete: () => res(),
      }),
    );
    let result: AnswerResult;
    try {
      result = await this.recordAnswer(chosen);
    } catch {
      result = { correct: false, correct_index: -1, explanation: "Network error." };
    }
    this.showFeedback(result);
  }

  private showFeedback(result: AnswerResult) {
    this.inFeedback = true;
    const container = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    const bg = this.add
      .rectangle(0, 0, 540, 220, 0x0a0d1f, 0.97)
      .setStrokeStyle(2, result.correct ? 0x4ade80 : 0xef4444);
    const title = this.add
      .text(0, -88, result.correct ? "TARGET LOCKED" : "MISFIRE", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "22px",
        color: result.correct ? "#4ade80" : "#ef4444",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    let detail = "";
    if (!result.correct && result.correct_index >= 0) {
      detail = `Correct: ${this.question.options[result.correct_index]}\n\n`;
    }
    detail += result.explanation;
    const body = this.add
      .text(0, -6, this.wrap(detail, 70), {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#cbd5f5",
        align: "center",
        wordWrap: { width: 500 },
      })
      .setOrigin(0.5);
    const btnBg = this.add
      .rectangle(0, 78, 160, 36, 0x3b3fff)
      .setStrokeStyle(1, 0x7af0ff);
    const btnText = this.add
      .text(0, 78, "Continue ▶", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    container.add([bg, title, body, btnBg, btnText]);
    btnBg.setInteractive(new Phaser.Geom.Rectangle(-80, 60, 160, 36), Phaser.Geom.Rectangle.Contains);
    btnBg.on("pointerover", () => btnBg.setFillStyle(0x4f46e5));
    btnBg.on("pointerout", () => btnBg.setFillStyle(0x3b3fff));
    btnBg.on("pointerdown", () => this.onComplete());
    this.keySpace.once("down", () => this.inFeedback && this.onComplete());
  }

  private spawnAsteroid() {
    const radius = Phaser.Math.Between(10, 22);
    const x = Phaser.Math.Between(0, GAME_WIDTH);
    const y = Phaser.Math.Between(-GAME_HEIGHT, PORTAL_Y + 100);
    const a = this.add.circle(x, y, radius, 0x52525b, 0.9).setStrokeStyle(1, 0x71717a);
    a.setData("speed", Phaser.Math.FloatBetween(1.2, 2.8));
    this.asteroids.push(a);
  }

  private resetAsteroid(a: Phaser.GameObjects.Arc) {
    a.y = -30;
    a.x = Phaser.Math.Between(0, GAME_WIDTH);
    a.setData("speed", Phaser.Math.FloatBetween(1.2, 2.8));
  }

  private wrap(s: string, width: number): string {
    const words = s.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > width) {
        if (cur) lines.push(cur);
        cur = w;
      } else {
        cur = (cur + " " + w).trim();
      }
    }
    if (cur) lines.push(cur);
    return lines.join("\n");
  }
}

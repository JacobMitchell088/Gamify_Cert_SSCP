import Phaser from "phaser";

import type { AnswerResult, Question } from "../types";
import { GAME_HEIGHT, GAME_WIDTH, type SceneData } from "./sceneContract";

const TOWER_COLORS = [0x7af0ff, 0xf472b6, 0xfacc15, 0x4ade80];
const TOWER_HEX = ["#7af0ff", "#f472b6", "#facc15", "#4ade80"];
const TOWER_NAMES = ["Alpha Stack", "Beta Stack", "Gamma Stack", "Delta Stack"];

const PATH_POINTS: [number, number][] = [
  [-20, 200],
  [150, 200],
  [150, 320],
  [400, 320],
  [400, 180],
  [620, 180],
  [620, 320],
  [820, 320],
];

const TOWER_SLOTS: [number, number][] = [
  [150, 260],
  [280, 360],
  [400, 240],
  [510, 130],
  [620, 240],
  [720, 360],
];

interface Creep {
  sprite: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
  hp: number;
  maxHp: number;
  pathProgress: number;
  speed: number;
  alive: boolean;
}

interface Tower {
  container: Phaser.GameObjects.Container;
  cannon: Phaser.GameObjects.Rectangle;
  x: number;
  y: number;
  range: number;
  dps: number;
  fireCooldown: number;
  active: boolean;
  index: number;
}

interface Projectile {
  sprite: Phaser.GameObjects.Arc;
  target: Creep;
  speed: number;
  damage: number;
  alive: boolean;
}

type Phase = "answering" | "wave" | "feedback";

export class TowerDefenseScene extends Phaser.Scene {
  private question!: Question;
  private recordAnswer!: (idx: number) => Promise<AnswerResult>;
  private onComplete!: () => void;

  private phase: Phase = "answering";
  private answered = false;

  private path!: Phaser.Curves.Path;
  private hp = 100;
  private hpBar!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;

  private optionCards: Phaser.GameObjects.Container[] = [];
  private placedTowers: Tower[] = [];
  private creeps: Creep[] = [];
  private projectiles: Projectile[] = [];

  private waveTimeRemaining = 0;
  private spawnTimer = 0;
  private spawnedCount = 0;
  private creepsToSpawn = 6;
  private pendingResult?: AnswerResult;

  constructor() {
    super({ key: "TowerDefenseScene" });
  }

  init(data: SceneData) {
    this.question = data.question;
    this.recordAnswer = data.recordAnswer;
    this.onComplete = data.onComplete;
    this.phase = "answering";
    this.answered = false;
    this.hp = 100;
    this.placedTowers = [];
    this.creeps = [];
    this.projectiles = [];
    this.optionCards = [];
    this.pendingResult = undefined;
    this.spawnedCount = 0;
    this.spawnTimer = 0;
    this.waveTimeRemaining = 0;
  }

  create() {
    this.cameras.main.setBackgroundColor("#05060f");
    this.drawGrid();
    this.buildPath();
    this.drawCore();
    this.drawHP();
    this.drawQuestion();
    this.drawOptionCards();
    this.drawSlots();
  }

  update(_time: number, delta: number) {
    if (this.phase !== "wave") return;

    this.waveTimeRemaining -= delta;
    this.spawnTimer -= delta;

    if (this.spawnedCount < this.creepsToSpawn && this.spawnTimer <= 0) {
      this.spawnCreep();
      this.spawnedCount += 1;
      this.spawnTimer = 650;
    }

    for (const c of this.creeps) {
      if (!c.alive) continue;
      c.pathProgress += (c.speed * delta) / 1000;
      if (c.pathProgress >= 1) {
        c.alive = false;
        c.sprite.destroy();
        c.hpBar.destroy();
        this.takeDamage(15);
        continue;
      }
      const pos = this.path.getPoint(c.pathProgress);
      if (pos) {
        c.sprite.setPosition(pos.x, pos.y);
        c.hpBar.setPosition(pos.x - 10, pos.y - 14);
        c.hpBar.width = 20 * (c.hp / c.maxHp);
      }
    }

    for (const t of this.placedTowers) {
      t.fireCooldown -= delta;
      if (t.fireCooldown > 0) continue;
      let nearest: Creep | null = null;
      let bestDist = t.range;
      for (const c of this.creeps) {
        if (!c.alive) continue;
        const d = Phaser.Math.Distance.Between(t.x, t.y, c.sprite.x, c.sprite.y);
        if (d < bestDist) {
          bestDist = d;
          nearest = c;
        }
      }
      if (nearest) {
        const dx = nearest.sprite.x - t.x;
        const dy = nearest.sprite.y - t.y;
        t.cannon.setRotation(Math.atan2(dy, dx) + Math.PI / 2);
        this.fireProjectile(t, nearest);
        t.fireCooldown = t.active ? 600 : 1100;
      }
    }

    for (const p of this.projectiles) {
      if (!p.alive) continue;
      if (!p.target.alive) {
        p.alive = false;
        p.sprite.destroy();
        continue;
      }
      const dx = p.target.sprite.x - p.sprite.x;
      const dy = p.target.sprite.y - p.sprite.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 10) {
        p.target.hp -= p.damage;
        p.alive = false;
        p.sprite.destroy();
        if (p.target.hp <= 0) {
          p.target.alive = false;
          p.target.sprite.destroy();
          p.target.hpBar.destroy();
        }
        continue;
      }
      const step = (p.speed * delta) / 1000;
      p.sprite.x += (dx / dist) * step;
      p.sprite.y += (dy / dist) * step;
    }

    this.creeps = this.creeps.filter((c) => c.alive);
    this.projectiles = this.projectiles.filter((p) => p.alive);

    const allSpawned = this.spawnedCount >= this.creepsToSpawn;
    if ((allSpawned && this.creeps.length === 0) || this.waveTimeRemaining <= 0) {
      this.endWave();
    }
  }

  private drawGrid() {
    const g = this.add.graphics();
    g.lineStyle(1, 0x1e293b, 0.45);
    for (let x = 0; x < GAME_WIDTH; x += 30) g.lineBetween(x, 0, x, GAME_HEIGHT);
    for (let y = 0; y < GAME_HEIGHT; y += 30) g.lineBetween(0, y, GAME_WIDTH, y);
  }

  private buildPath() {
    this.path = new Phaser.Curves.Path(PATH_POINTS[0][0], PATH_POINTS[0][1]);
    for (let i = 1; i < PATH_POINTS.length; i++) {
      this.path.lineTo(PATH_POINTS[i][0], PATH_POINTS[i][1]);
    }

    const outline = this.add.graphics();
    outline.lineStyle(28, 0x1e293b, 1);
    this.path.draw(outline);
    const inner = this.add.graphics();
    inner.lineStyle(22, 0x0a0d1f, 1);
    this.path.draw(inner);
    const accent = this.add.graphics();
    accent.lineStyle(1, 0x3b3fff, 0.7);
    this.path.draw(accent);
  }

  private drawCore() {
    const [x, y] = PATH_POINTS[PATH_POINTS.length - 1];
    this.add
      .rectangle(x + 30, y, 60, 70, 0x11163a)
      .setStrokeStyle(2, 0x7af0ff);
    this.add
      .text(x + 30, y, "CORE", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#7af0ff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
  }

  private drawHP() {
    this.add
      .rectangle(GAME_WIDTH / 2, 20, 320, 16, 0x1f2937)
      .setOrigin(0.5)
      .setStrokeStyle(1, 0x334155);
    this.hpBar = this.add
      .rectangle(GAME_WIDTH / 2 - 160, 20, 320, 14, 0x4ade80)
      .setOrigin(0, 0.5);
    this.hpText = this.add
      .text(GAME_WIDTH / 2, 40, "Core integrity 100%", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#94a3b8",
      })
      .setOrigin(0.5);
  }

  private drawQuestion() {
    this.add
      .text(GAME_WIDTH / 2, 80, this.wrap(this.question.stem, 95), {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: "#e2e8f0",
        align: "center",
        wordWrap: { width: GAME_WIDTH - 80 },
      })
      .setOrigin(0.5);
  }

  private drawOptionCards() {
    const cardW = 200;
    const cardH = 84;
    const gap = 14;
    const totalW = cardW * 4 + gap * 3;
    const startX = (GAME_WIDTH - totalW) / 2;
    const y = GAME_HEIGHT - 60;

    this.question.options.forEach((opt, i) => {
      const x = startX + i * (cardW + gap) + cardW / 2;
      const container = this.add.container(x, y);
      const bg = this.add
        .rectangle(0, 0, cardW, cardH, 0x11163a, 0.95)
        .setStrokeStyle(2, TOWER_COLORS[i], 0.9);
      const accentBar = this.add
        .rectangle(-cardW / 2 + 5, 0, 4, cardH - 14, TOWER_COLORS[i])
        .setOrigin(0.5);
      const towerIcon = this.add.container(-cardW / 2 + 28, -8);
      towerIcon.add(this.add.circle(0, 0, 12, 0x0a0d1f).setStrokeStyle(2, TOWER_COLORS[i]));
      towerIcon.add(this.add.rectangle(0, -2, 3, 14, TOWER_COLORS[i]));
      const label = this.add
        .text(-cardW / 2 + 48, -cardH / 2 + 12, TOWER_NAMES[i], {
          fontFamily: "system-ui, sans-serif",
          fontSize: "10px",
          color: TOWER_HEX[i],
          fontStyle: "bold",
        })
        .setOrigin(0, 0);
      const text = this.add
        .text(-cardW / 2 + 48, -cardH / 2 + 28, this.wrap(opt, 24), {
          fontFamily: "system-ui, sans-serif",
          fontSize: "11px",
          color: "#e2e8f0",
          wordWrap: { width: cardW - 60 },
        })
        .setOrigin(0, 0);
      container.add([bg, accentBar, towerIcon, label, text]);
      container.setSize(cardW, cardH);
      container.setInteractive(
        new Phaser.Geom.Rectangle(-cardW / 2, -cardH / 2, cardW, cardH),
        Phaser.Geom.Rectangle.Contains,
      );
      container.on("pointerover", () => {
        bg.setFillStyle(0x1e2547, 1);
        container.setScale(1.03);
      });
      container.on("pointerout", () => {
        bg.setFillStyle(0x11163a, 0.95);
        container.setScale(1);
      });
      container.on("pointerdown", () => void this.commitAnswer(i));
      this.optionCards.push(container);
    });
  }

  private drawSlots() {
    TOWER_SLOTS.forEach(([x, y]) => {
      this.add.circle(x, y, 9, 0x334155, 0.45).setStrokeStyle(1, 0x64748b, 0.5);
    });
  }

  private async commitAnswer(chosenIndex: number) {
    if (this.answered) return;
    this.answered = true;

    this.optionCards.forEach((c, i) => {
      c.disableInteractive();
      c.removeAllListeners();
      const bg = c.list[0] as Phaser.GameObjects.Rectangle;
      if (i === chosenIndex) {
        bg.setFillStyle(0x1e2547, 1);
        c.setScale(1.04);
      } else {
        bg.setFillStyle(0x0a0d1f, 0.6);
        c.setAlpha(0.5);
      }
    });

    let result: AnswerResult;
    try {
      result = await this.recordAnswer(chosenIndex);
    } catch (e) {
      console.error(e);
      result = { correct: false, correct_index: -1, explanation: "Network error." };
    }
    this.pendingResult = result;

    TOWER_SLOTS.forEach(([sx, sy]) => {
      this.placedTowers.push(this.createTower(sx, sy, chosenIndex, result.correct));
    });

    this.creepsToSpawn = 6;
    this.spawnedCount = 0;
    this.spawnTimer = 0;
    this.waveTimeRemaining = 14000;
    this.phase = "wave";
  }

  private createTower(x: number, y: number, towerIndex: number, isCorrect: boolean): Tower {
    const container = this.add.container(x, y);
    const base = this.add
      .circle(0, 0, 14, 0x0a0d1f)
      .setStrokeStyle(2, TOWER_COLORS[towerIndex]);
    const cannon = this.add
      .rectangle(0, -8, 3, 16, TOWER_COLORS[towerIndex])
      .setOrigin(0.5, 1);
    container.add([base, cannon]);
    if (!isCorrect) {
      base.setStrokeStyle(2, 0x52525b);
      cannon.setFillStyle(0x52525b);
      container.setAlpha(0.55);
    }
    container.setScale(0.4);
    this.tweens.add({ targets: container, scale: 1, duration: 220, ease: "Back.easeOut" });
    return {
      container,
      cannon,
      x,
      y,
      range: 130,
      dps: isCorrect ? 32 : 8,
      fireCooldown: 200,
      active: isCorrect,
      index: towerIndex,
    };
  }

  private spawnCreep() {
    const [x, y] = PATH_POINTS[0];
    const sprite = this.add
      .rectangle(x, y, 16, 16, 0xef4444)
      .setStrokeStyle(1, 0x991b1b);
    const hpBar = this.add
      .rectangle(x - 10, y - 14, 20, 3, 0x4ade80)
      .setOrigin(0, 0.5);
    this.creeps.push({
      sprite,
      hpBar,
      hp: 50,
      maxHp: 50,
      pathProgress: 0,
      speed: 0.1,
      alive: true,
    });
  }

  private fireProjectile(from: Tower, to: Creep) {
    const sprite = this.add.circle(from.x, from.y - 8, 3, TOWER_COLORS[from.index]);
    this.projectiles.push({
      sprite,
      target: to,
      speed: 420,
      damage: from.dps,
      alive: true,
    });
  }

  private takeDamage(n: number) {
    this.hp = Math.max(0, this.hp - n);
    this.hpBar.width = 320 * (this.hp / 100);
    this.hpText.setText(`Core integrity ${this.hp}%`);
    if (this.hp <= 30) this.hpBar.setFillStyle(0xef4444);
    else if (this.hp <= 60) this.hpBar.setFillStyle(0xf59e0b);
    this.cameras.main.shake(80, 0.0025);
  }

  private endWave() {
    if (this.phase === "feedback") return;
    this.phase = "feedback";
    for (const c of this.creeps) {
      c.sprite.destroy();
      c.hpBar.destroy();
    }
    this.creeps = [];
    for (const p of this.projectiles) p.sprite.destroy();
    this.projectiles = [];
    if (this.pendingResult) this.showFeedback(this.pendingResult);
  }

  private showFeedback(result: AnswerResult) {
    const panelW = 580;
    const panelH = 240;
    const container = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    const bg = this.add
      .rectangle(0, 0, panelW, panelH, 0x0a0d1f, 0.97)
      .setStrokeStyle(2, result.correct ? 0x4ade80 : 0xef4444);
    const title = this.add
      .text(0, -panelH / 2 + 24, result.correct ? "DEFENSE HELD" : "BREACH DETECTED", {
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
      .text(0, -6, this.wrap(detail, 78), {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#cbd5f5",
        align: "center",
        wordWrap: { width: panelW - 40 },
      })
      .setOrigin(0.5);

    const btnBg = this.add
      .rectangle(0, panelH / 2 - 32, 170, 38, 0x3b3fff)
      .setStrokeStyle(1, 0x7af0ff);
    const btnText = this.add
      .text(0, panelH / 2 - 32, "Continue ▶", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    container.add([bg, title, body, btnBg, btnText]);

    btnBg.setInteractive(
      new Phaser.Geom.Rectangle(-85, -19, 170, 38),
      Phaser.Geom.Rectangle.Contains,
    );
    btnBg.on("pointerover", () => btnBg.setFillStyle(0x4f46e5));
    btnBg.on("pointerout", () => btnBg.setFillStyle(0x3b3fff));
    btnBg.on("pointerdown", () => this.onComplete());

    container.setScale(0.85);
    this.tweens.add({ targets: container, scale: 1, duration: 200, ease: "Back.easeOut" });

    const space = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    space?.once("down", () => this.onComplete());
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

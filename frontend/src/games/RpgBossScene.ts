import Phaser from "phaser";

import type { AnswerResult, Question } from "../types";
import { GAME_HEIGHT, GAME_WIDTH, type SceneData } from "./sceneContract";

// ----------------------- Tunables -----------------------

const HERO_MAX_HP = 100;
const BOSS_MAX_HP = 700;
const COUNTER_BASE = 25;

const TREASURE_EVERY = 6;
const TREASURE_EVERY_FORTUNE = 4;

// ----------------------- Modifiers -----------------------

type ModifierKey =
  | "sharp_edge"
  | "vampire"
  | "iron_stance"
  | "riposte"
  | "second_wind"
  | "streak_rage"
  | "bulwark"
  | "fortune";

interface ModifierDef {
  key: ModifierKey;
  name: string;
  icon: string;
  description: string;
  color: number;
}

const MODIFIERS: Record<ModifierKey, ModifierDef> = {
  sharp_edge: {
    key: "sharp_edge",
    name: "Sharp Edge",
    icon: "⚔",
    description: "Parry counter-strikes deal +50% damage.",
    color: 0xf97316,
  },
  vampire: {
    key: "vampire",
    name: "Vampire Strike",
    icon: "❤",
    description: "Each successful parry heals 5 HP.",
    color: 0xef4444,
  },
  iron_stance: {
    key: "iron_stance",
    name: "Iron Stance",
    icon: "🛡",
    description: "Take 30% less damage from boss attacks.",
    color: 0x60a5fa,
  },
  riposte: {
    key: "riposte",
    name: "Riposte",
    icon: "↯",
    description: "Parries trigger two counter-strikes instead of one.",
    color: 0xfacc15,
  },
  second_wind: {
    key: "second_wind",
    name: "Second Wind",
    icon: "✦",
    description: "50% chance to ignore damage on a wrong answer.",
    color: 0xa78bfa,
  },
  streak_rage: {
    key: "streak_rage",
    name: "Streak Rage",
    icon: "🔥",
    description: "Counter damage +3 for every current parry streak.",
    color: 0xfb7185,
  },
  bulwark: {
    key: "bulwark",
    name: "Bulwark",
    icon: "✚",
    description: "Max HP +30 and fully heal.",
    color: 0x4ade80,
  },
  fortune: {
    key: "fortune",
    name: "Fortune",
    icon: "♦",
    description: "Relic chambers appear more often (every 4 fights).",
    color: 0x7af0ff,
  },
};

const ALL_MODIFIER_KEYS = Object.keys(MODIFIERS) as ModifierKey[];

// ----------------------- Persistent state -----------------------

interface PersistentState {
  questionsAnswered: number;
  heroMaxHp: number;
  heroHp: number;
  bossMaxHp: number;
  bossHp: number;
  modifiers: ModifierKey[];
  treasureCounter: number;
  streak: number;
}

const REGISTRY_KEY = "rpg_state_v1";

// ----------------------- Phases -----------------------

type Phase =
  | "telegraph"
  | "question"
  | "resolveCorrect"
  | "resolveWrong"
  | "treasureOffer"
  | "feedback"
  | "victory"
  | "gameOver";

// ----------------------- Layout -----------------------

const HERO_X = 320;
const HERO_Y = 380;
const BOSS_X = 960;
const BOSS_Y = 360;

// ----------------------- Scene -----------------------

export class RpgBossScene extends Phaser.Scene {
  private state!: PersistentState;

  private question!: Question;
  private recordAnswer!: (idx: number) => Promise<AnswerResult>;
  private onComplete!: () => void;
  private abortRun!: () => void;
  private answerResult: AnswerResult | null = null;
  private phase: Phase = "telegraph";
  private isTreasure = false;

  private layerWorld!: Phaser.GameObjects.Container;
  private layerEffects!: Phaser.GameObjects.Container;
  private layerUi!: Phaser.GameObjects.Container;
  private layerPanel!: Phaser.GameObjects.Container;

  private heroContainer!: Phaser.GameObjects.Container;
  private bossContainer!: Phaser.GameObjects.Container;
  private bossBody!: Phaser.GameObjects.Ellipse;
  private bossEyeL!: Phaser.GameObjects.Arc;
  private bossEyeR!: Phaser.GameObjects.Arc;

  private heroHpBar!: Phaser.GameObjects.Rectangle;
  private heroHpText!: Phaser.GameObjects.Text;
  private bossHpBar!: Phaser.GameObjects.Rectangle;
  private bossHpText!: Phaser.GameObjects.Text;
  private modBadges!: Phaser.GameObjects.Container;
  private statusText!: Phaser.GameObjects.Text;

  private panel: Phaser.GameObjects.Container | null = null;

  constructor() {
    super({ key: "RpgBossScene" });
  }

  init(data: SceneData) {
    if (!data || !data.question) return;
    this.question = data.question;
    this.recordAnswer = data.recordAnswer;
    this.onComplete = data.onComplete;
    this.abortRun = data.abortRun;
    this.answerResult = null;
    this.phase = "telegraph";
    this.isTreasure = false;
    this.panel = null;
  }

  create() {
    if (!this.question) return;
    try {
      console.log("[RpgBossScene] create() starting");
      this.cameras.main.setBackgroundColor("#0b0512");
      this.loadOrInitState();

      this.layerWorld = this.add.container(0, 0);
      this.layerEffects = this.add.container(0, 0);
      this.layerUi = this.add.container(0, 0);
      this.layerPanel = this.add.container(0, 0);

      this.drawBackdrop();
      this.drawBoss();
      this.drawHero();
      this.drawHud();

      // Treasure cadence: bump counter, fire on threshold.
      const interval = this.state.modifiers.includes("fortune")
        ? TREASURE_EVERY_FORTUNE
        : TREASURE_EVERY;
      this.state.treasureCounter += 1;
      if (this.state.treasureCounter >= interval) {
        this.isTreasure = true;
        this.state.treasureCounter = 0;
      }

      this.startTelegraph();
      console.log("[RpgBossScene] create() complete");
    } catch (err) {
      console.error("[RpgBossScene] create() failed:", err);
      // Render an on-canvas error so the user sees something instead of blank
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, `Scene error:\n${(err as Error).message}`, {
          fontFamily: "monospace",
          fontSize: "16px",
          color: "#ef4444",
          align: "center",
          wordWrap: { width: GAME_WIDTH - 80 },
        })
        .setOrigin(0.5);
    }
  }

  // ----------------------- Persistence -----------------------

  private loadOrInitState() {
    const existing = this.registry.get(REGISTRY_KEY) as PersistentState | undefined;
    if (existing) {
      this.state = existing;
      return;
    }
    this.state = {
      questionsAnswered: 0,
      heroMaxHp: HERO_MAX_HP,
      heroHp: HERO_MAX_HP,
      bossMaxHp: BOSS_MAX_HP,
      bossHp: BOSS_MAX_HP,
      modifiers: [],
      treasureCounter: 0,
      streak: 0,
    };
    this.registry.set(REGISTRY_KEY, this.state);
  }

  private saveState() {
    this.registry.set(REGISTRY_KEY, this.state);
  }

  // ----------------------- Backdrop -----------------------

  private drawBackdrop() {
    // Layered gradient floor + pillars for arena vibe (pure shapes, swap with sprites later).
    const floor = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 120, GAME_WIDTH, 240, 0x140820, 1)
      .setOrigin(0.5, 0);
    const horizon = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 120, GAME_WIDTH, 2, 0x4a1d4a, 1)
      .setOrigin(0.5, 0.5);
    this.layerWorld.add([floor, horizon]);

    // Soft glow behind boss.
    const glow = this.add.circle(BOSS_X, BOSS_Y, 200, 0x6d28d9, 0.15);
    this.layerWorld.add(glow);
    this.tweens.add({
      targets: glow,
      alpha: 0.28,
      yoyo: true,
      repeat: -1,
      duration: 1800,
      ease: "Sine.easeInOut",
    });

    // Pillars
    for (const x of [140, GAME_WIDTH - 140]) {
      const pillar = this.add.rectangle(x, GAME_HEIGHT - 320, 36, 360, 0x1c1430, 1).setOrigin(0.5, 0);
      const cap = this.add.rectangle(x, GAME_HEIGHT - 320, 56, 16, 0x2a1f48, 1).setOrigin(0.5, 0.5);
      this.layerWorld.add([pillar, cap]);
    }
  }

  // ----------------------- Boss -----------------------

  private drawBoss() {
    const c = this.add.container(BOSS_X, BOSS_Y);

    // Shadow under boss
    const shadow = this.add.ellipse(0, 110, 220, 36, 0x000000, 0.4);

    // Body — large dark mass
    const phaseTint = this.bossPhaseColor();
    const body = this.add
      .ellipse(0, 0, 220, 280, phaseTint, 1)
      .setStrokeStyle(3, 0xe11d48, 0.9);
    this.bossBody = body;

    // Horns
    const hornL = this.add
      .triangle(-70, -110, 0, 0, 30, -60, 60, 10, 0x1a0a1a, 1)
      .setStrokeStyle(2, 0xe11d48, 0.8);
    const hornR = this.add
      .triangle(70, -110, 0, 0, -30, -60, -60, 10, 0x1a0a1a, 1)
      .setStrokeStyle(2, 0xe11d48, 0.8);

    // Eyes
    this.bossEyeL = this.add.circle(-38, -30, 10, 0xfacc15, 1);
    this.bossEyeR = this.add.circle(38, -30, 10, 0xfacc15, 1);
    const pupilL = this.add.circle(-38, -30, 4, 0x0b0512, 1);
    const pupilR = this.add.circle(38, -30, 4, 0x0b0512, 1);

    // Mouth — thin lines built from rectangles (Graphics-in-container can mis-render).
    const mouthColor = 0xe11d48;
    const m1 = this.add.rectangle(-33, 41, 24, 3, mouthColor, 1).setAngle(22);
    const m2 = this.add.rectangle(-11, 41, 24, 3, mouthColor, 1).setAngle(-22);
    const m3 = this.add.rectangle(11, 41, 24, 3, mouthColor, 1).setAngle(22);
    const m4 = this.add.rectangle(33, 41, 24, 3, mouthColor, 1).setAngle(-22);

    // Claws (arms)
    const armL = this.add.rectangle(-105, 40, 30, 130, 0x1a0a1a, 1).setStrokeStyle(2, 0xe11d48, 0.7);
    const armR = this.add.rectangle(105, 40, 30, 130, 0x1a0a1a, 1).setStrokeStyle(2, 0xe11d48, 0.7);
    const clawL = this.add.triangle(-105, 110, 0, 0, -18, 30, 18, 30, 0xe11d48, 1);
    const clawR = this.add.triangle(105, 110, 0, 0, -18, 30, 18, 30, 0xe11d48, 1);

    c.add([
      shadow,
      armL,
      armR,
      clawL,
      clawR,
      body,
      hornL,
      hornR,
      this.bossEyeL,
      this.bossEyeR,
      pupilL,
      pupilR,
      m1,
      m2,
      m3,
      m4,
    ]);
    this.layerWorld.add(c);
    this.bossContainer = c;

    // Idle breathing
    this.tweens.add({
      targets: c,
      scaleY: 1.04,
      yoyo: true,
      repeat: -1,
      duration: 1400,
      ease: "Sine.easeInOut",
    });

    // Eye flicker
    for (const eye of [this.bossEyeL, this.bossEyeR]) {
      this.tweens.add({
        targets: eye,
        alpha: 0.4,
        yoyo: true,
        repeat: -1,
        duration: 900 + Math.random() * 400,
        ease: "Sine.easeInOut",
      });
    }
  }

  private bossPhaseColor(): number {
    const pct = this.state.bossHp / this.state.bossMaxHp;
    if (pct <= 0.33) return 0x4a0a1a;
    if (pct <= 0.66) return 0x3a0a2a;
    return 0x2a1230;
  }

  // ----------------------- Hero -----------------------

  private drawHero() {
    const c = this.add.container(HERO_X, HERO_Y);
    const shadow = this.add.ellipse(0, 70, 100, 18, 0x000000, 0.45);
    // Body
    const body = this.add.rectangle(0, 0, 60, 90, 0x60a5fa, 1).setStrokeStyle(2, 0x93c5fd, 1);
    // Head
    const head = this.add.circle(0, -64, 26, 0xfde68a, 1).setStrokeStyle(2, 0xfacc15, 1);
    // Eye dots
    const eyeL = this.add.circle(-7, -66, 2.5, 0x0b0512, 1);
    const eyeR = this.add.circle(7, -66, 2.5, 0x0b0512, 1);
    // Belt
    const belt = this.add.rectangle(0, 16, 60, 8, 0x1e293b, 1);
    // Legs
    const legL = this.add.rectangle(-14, 56, 22, 36, 0x1e293b, 1);
    const legR = this.add.rectangle(14, 56, 22, 36, 0x1e293b, 1);
    // Sword (right side)
    const blade = this.add.rectangle(38, -10, 8, 70, 0xe2e8f0, 1).setStrokeStyle(1, 0x94a3b8);
    const guard = this.add.rectangle(38, 22, 24, 6, 0xfacc15, 1);
    const grip = this.add.rectangle(38, 32, 6, 14, 0x7c2d12, 1);
    // Shield (left side)
    const shield = this.add
      .rectangle(-38, -4, 18, 56, 0x6366f1, 1)
      .setStrokeStyle(2, 0xa5b4fc, 1);

    c.add([shadow, legL, legR, body, belt, shield, head, eyeL, eyeR, blade, guard, grip]);
    this.layerWorld.add(c);
    this.heroContainer = c;

    // Subtle idle bob
    this.tweens.add({
      targets: c,
      y: HERO_Y - 6,
      yoyo: true,
      repeat: -1,
      duration: 1200,
      ease: "Sine.easeInOut",
    });
  }

  // ----------------------- HUD -----------------------

  private drawHud() {
    // Hero HP bar (top-left)
    const heroBarBg = this.add
      .rectangle(20, 20, 360, 28, 0x1e0a1a, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x475569);
    this.heroHpBar = this.add
      .rectangle(22, 22, 356 * this.heroHpPct(), 24, 0x4ade80, 1)
      .setOrigin(0, 0);
    const heroLabel = this.add
      .text(28, 24, "HERO", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#cbd5f5",
        fontStyle: "bold",
      })
      .setOrigin(0, 0);
    this.heroHpText = this.add
      .text(
        376,
        24,
        `${this.state.heroHp} / ${this.state.heroMaxHp}`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "11px",
          color: "#f1f5f9",
          fontStyle: "bold",
        },
      )
      .setOrigin(1, 0);

    // Boss HP bar (top-center, wide)
    const bossBarW = 600;
    const bossBarX = (GAME_WIDTH - bossBarW) / 2;
    const bossBarBg = this.add
      .rectangle(bossBarX, 20, bossBarW, 28, 0x140820, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0xe11d48);
    this.bossHpBar = this.add
      .rectangle(bossBarX + 2, 22, (bossBarW - 4) * this.bossHpPct(), 24, 0xe11d48, 1)
      .setOrigin(0, 0);
    const bossLabel = this.add
      .text(GAME_WIDTH / 2, 12, "THE WARDEN", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#fda4af",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 1);
    this.bossHpText = this.add
      .text(
        GAME_WIDTH / 2,
        24,
        `${this.state.bossHp} / ${this.state.bossMaxHp}`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "12px",
          color: "#fee2e2",
          fontStyle: "bold",
        },
      )
      .setOrigin(0.5, 0);

    // Status (run progress + streak)
    this.statusText = this.add
      .text(GAME_WIDTH - 20, 22, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#cbd5f5",
        align: "right",
      })
      .setOrigin(1, 0);

    // Modifier badges row (under hero hp)
    this.modBadges = this.add.container(20, 56);

    this.layerUi.add([
      heroBarBg,
      this.heroHpBar,
      heroLabel,
      this.heroHpText,
      bossBarBg,
      this.bossHpBar,
      bossLabel,
      this.bossHpText,
      this.statusText,
      this.modBadges,
    ]);

    this.refreshHud();
  }

  private heroHpPct() {
    return Math.max(0, this.state.heroHp / this.state.heroMaxHp);
  }
  private bossHpPct() {
    return Math.max(0, this.state.bossHp / this.state.bossMaxHp);
  }

  private refreshHud() {
    this.heroHpBar.width = 356 * this.heroHpPct();
    this.heroHpBar.fillColor =
      this.heroHpPct() > 0.5 ? 0x4ade80 : this.heroHpPct() > 0.2 ? 0xfacc15 : 0xef4444;
    this.heroHpText.setText(`${Math.max(0, this.state.heroHp)} / ${this.state.heroMaxHp}`);

    const bossBarW = 600;
    this.bossHpBar.width = (bossBarW - 4) * this.bossHpPct();
    this.bossHpText.setText(`${Math.max(0, this.state.bossHp)} / ${this.state.bossMaxHp}`);
    this.bossBody.fillColor = this.bossPhaseColor();

    this.statusText.setText(
      `Q ${this.state.questionsAnswered + 1}/30   ·   Streak ${this.state.streak}`,
    );

    // Refresh modifier badges
    this.modBadges.removeAll(true);
    const badgeW = 130;
    const badgeH = 26;
    this.state.modifiers.forEach((key, i) => {
      const def = MODIFIERS[key];
      const x = i * (badgeW + 6);
      const bg = this.add
        .rectangle(x, 0, badgeW, badgeH, 0x140820, 0.95)
        .setOrigin(0, 0)
        .setStrokeStyle(1, def.color);
      const txt = this.add
        .text(x + 8, badgeH / 2, `${def.icon}  ${def.name}`, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "11px",
          color: "#f1f5f9",
          fontStyle: "bold",
        })
        .setOrigin(0, 0.5);
      this.modBadges.add([bg, txt]);
    });
  }

  // ----------------------- Phase: telegraph -----------------------

  private startTelegraph() {
    this.phase = "telegraph";

    // Boss winds up — quick scale punch + red flash on eyes
    this.tweens.add({
      targets: this.bossContainer,
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 280,
      yoyo: true,
      ease: "Quad.easeOut",
    });
    for (const eye of [this.bossEyeL, this.bossEyeR]) {
      eye.setFillStyle(0xef4444, 1);
      this.time.delayedCall(280, () => eye.setFillStyle(0xfacc15, 1));
    }
    const sigil = this.add
      .text(GAME_WIDTH / 2, 120, this.isTreasure ? "✦ RELIC CHAMBER ✦" : "INCOMING ATTACK", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "22px",
        color: this.isTreasure ? "#7af0ff" : "#fca5a5",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.layerEffects.add(sigil);
    this.tweens.add({
      targets: sigil,
      alpha: 1,
      y: 110,
      duration: 320,
      yoyo: true,
      hold: 280,
      onComplete: () => {
        sigil.destroy();
        this.startQuestion();
      },
    });
  }

  // ----------------------- Phase: question -----------------------

  private startQuestion() {
    this.phase = "question";
    this.clearPanel();

    const panel = this.add.container(0, 0);
    const dim = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05060f, 0.55)
      .setOrigin(0.5);
    panel.add(dim);

    // Dynamic-height stem card
    const stemBoxW = 760;
    const padTop = 12;
    const padBottom = 22;
    const labelGap = 14;
    const labelH = 14;

    const stem = this.add
      .text(0, 0, this.question.stem, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "17px",
        color: "#f1f5f9",
        align: "center",
        wordWrap: { width: stemBoxW - 56 },
        lineSpacing: 4,
      })
      .setOrigin(0.5, 0);
    const stemH = stem.height;
    const computedBoxH = padTop + labelH + labelGap + stemH + padBottom;
    const stemBoxH = Phaser.Math.Clamp(computedBoxH, 96, 420);

    const bandTop = 100;
    const bandBottom = GAME_HEIGHT - 160;
    const boxTop = Phaser.Math.Clamp(
      (bandTop + bandBottom) / 2 - stemBoxH / 2,
      bandTop,
      bandBottom - stemBoxH,
    );
    const boxY = boxTop + stemBoxH / 2;

    const accent = this.isTreasure ? 0x7af0ff : 0xe11d48;
    const labelText = this.isTreasure ? "✦ RELIC TRIAL" : "BOSS ATTACK";
    const stemBg = this.add
      .rectangle(GAME_WIDTH / 2, boxY, stemBoxW, stemBoxH, 0x0a0512, 0.97)
      .setStrokeStyle(2, accent, 0.85);
    const labelTxt = this.add
      .text(GAME_WIDTH / 2, boxTop + padTop + labelH / 2, labelText, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: this.isTreasure ? "#7af0ff" : "#fca5a5",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    stem.setPosition(GAME_WIDTH / 2, boxTop + padTop + labelH + labelGap);
    stem.setOrigin(0.5, 0);
    panel.add([stemBg, labelTxt, stem]);

    // Option row
    const cardW = 230;
    const cardH = 120;
    const gap = 14;
    const totalW = cardW * 4 + gap * 3;
    const startX = (GAME_WIDTH - totalW) / 2;
    const y = GAME_HEIGHT - cardH / 2 - 18;

    this.question.options.forEach((opt, i) => {
      const x = startX + i * (cardW + gap) + cardW / 2;
      panel.add(this.makeOptionCard(x, y, cardW, cardH, opt, i));
    });

    this.layerPanel.add(panel);
    this.panel = panel;
  }

  private makeOptionCard(
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    idx: number,
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const labels = ["A", "B", "C", "D"];
    const accents = [0x60a5fa, 0xa78bfa, 0x4ade80, 0xfacc15];
    const accent = accents[idx];

    const bg = this.add.rectangle(0, 0, w, h, 0x0e1430, 0.96).setStrokeStyle(2, accent);
    const stripe = this.add.rectangle(-w / 2 + 6, 0, 4, h - 16, accent, 0.9);
    const letter = this.add
      .text(-w / 2 + 22, -h / 2 + 12, labels[idx], {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#cbd5f5",
        fontStyle: "bold",
      })
      .setOrigin(0, 0);
    const body = this.add
      .text(0, 10, text, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#f1f5f9",
        align: "center",
        wordWrap: { width: w - 28 },
        lineSpacing: 3,
      })
      .setOrigin(0.5);
    c.add([bg, stripe, letter, body]);

    const hit = this.add.zone(0, 0, w, h).setOrigin(0.5);
    hit.setInteractive({ useHandCursor: true });
    c.add(hit);
    hit.on("pointerover", () => bg.setFillStyle(0x172040, 1));
    hit.on("pointerout", () => bg.setFillStyle(0x0e1430, 0.96));
    hit.on("pointerdown", () => {
      hit.disableInteractive();
      void this.onOptionPicked(idx);
    });
    return c;
  }

  private async onOptionPicked(idx: number) {
    if (this.phase !== "question") return;
    let result: AnswerResult;
    try {
      result = await this.recordAnswer(idx);
    } catch {
      result = { correct: false, correct_index: -1, explanation: "Network error." };
    }
    this.answerResult = result;
    this.clearPanel();

    if (result.correct) {
      this.state.streak += 1;
      this.resolveCorrect();
    } else {
      this.state.streak = 0;
      this.resolveWrong();
    }
  }

  // ----------------------- Phase: resolve correct -----------------------

  private resolveCorrect() {
    this.phase = "resolveCorrect";

    // Visual: hero lunges, boss flashes
    const lunge = this.tweens.add({
      targets: this.heroContainer,
      x: HERO_X + 80,
      duration: 160,
      yoyo: true,
      ease: "Quad.easeOut",
    });
    void lunge;

    const dmg = this.computeCounterDamage();
    const strikes = this.state.modifiers.includes("riposte") ? 2 : 1;
    let totalDealt = 0;
    for (let i = 0; i < strikes; i++) {
      this.time.delayedCall(180 + i * 220, () => {
        const dealt = Math.min(dmg, this.state.bossHp);
        this.state.bossHp = Math.max(0, this.state.bossHp - dmg);
        totalDealt += dealt;
        this.flashBoss();
        this.floatDamage(BOSS_X, BOSS_Y - 80, dmg, "#fde68a");
        this.refreshHud();
      });
    }

    if (this.state.modifiers.includes("vampire")) {
      const heal = 5;
      this.state.heroHp = Math.min(this.state.heroMaxHp, this.state.heroHp + heal);
      this.time.delayedCall(220, () => {
        this.floatDamage(HERO_X, HERO_Y - 80, heal, "#86efac", "+");
        this.refreshHud();
      });
    }

    // Banner
    const banner = this.add
      .text(GAME_WIDTH / 2, 100, this.isTreasure ? "RELIC SECURED" : "PARRY!", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "30px",
        color: this.isTreasure ? "#7af0ff" : "#4ade80",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.layerEffects.add(banner);
    this.tweens.add({
      targets: banner,
      alpha: 1,
      y: 90,
      duration: 200,
      yoyo: true,
      hold: 350,
      onComplete: () => banner.destroy(),
    });

    const settleAfter = 200 + strikes * 220 + 200;
    this.time.delayedCall(settleAfter, () => {
      this.saveState();
      if (this.state.bossHp <= 0) {
        this.startVictory();
        return;
      }
      if (this.isTreasure) {
        this.startTreasureOffer();
      } else {
        this.startFeedback();
      }
      void totalDealt;
    });
  }

  private computeCounterDamage(): number {
    let dmg = COUNTER_BASE;
    if (this.state.modifiers.includes("streak_rage")) dmg += 3 * Math.max(0, this.state.streak - 1);
    if (this.state.modifiers.includes("sharp_edge")) dmg = Math.round(dmg * 1.5);
    return dmg;
  }

  // ----------------------- Phase: resolve wrong -----------------------

  private resolveWrong() {
    this.phase = "resolveWrong";

    // Second wind: 50% chance to dodge
    if (this.state.modifiers.includes("second_wind") && Math.random() < 0.5) {
      const dodge = this.add
        .text(HERO_X, HERO_Y - 100, "DEFLECTED", {
          fontFamily: "system-ui, sans-serif",
          fontSize: "20px",
          color: "#a78bfa",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setAlpha(0);
      this.layerEffects.add(dodge);
      this.tweens.add({
        targets: dodge,
        alpha: 1,
        y: HERO_Y - 130,
        duration: 220,
        yoyo: true,
        hold: 300,
        onComplete: () => dodge.destroy(),
      });
      this.time.delayedCall(800, () => {
        this.saveState();
        this.startFeedback();
      });
      return;
    }

    // Boss claw lunge
    this.tweens.add({
      targets: this.bossContainer,
      x: BOSS_X - 60,
      duration: 200,
      yoyo: true,
      ease: "Quad.easeOut",
    });
    this.cameras.main.shake(220, 0.012);
    this.cameras.main.flash(180, 200, 30, 30);

    const dmg = this.computeIncomingDamage();
    this.state.heroHp = Math.max(0, this.state.heroHp - dmg);
    this.flashHero();
    this.floatDamage(HERO_X, HERO_Y - 80, dmg, "#fca5a5", "-");
    this.refreshHud();

    const banner = this.add
      .text(GAME_WIDTH / 2, 100, this.isTreasure ? "RELIC LOST" : "HIT!", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "30px",
        color: "#ef4444",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.layerEffects.add(banner);
    this.tweens.add({
      targets: banner,
      alpha: 1,
      y: 90,
      duration: 200,
      yoyo: true,
      hold: 350,
      onComplete: () => banner.destroy(),
    });

    this.time.delayedCall(900, () => {
      this.saveState();
      if (this.state.heroHp <= 0) {
        this.startGameOver();
        return;
      }
      this.startFeedback();
    });
  }

  private computeIncomingDamage(): number {
    const q = this.state.questionsAnswered;
    let base = 6 + Math.floor(q * 0.45);
    // Phase multiplier (boss rage at low HP)
    const pct = this.bossHpPct();
    if (pct <= 0.33) base = Math.round(base * 1.35);
    else if (pct <= 0.66) base = Math.round(base * 1.15);
    if (this.state.modifiers.includes("iron_stance")) base = Math.round(base * 0.7);
    return Math.max(1, base);
  }

  // ----------------------- FX helpers -----------------------

  private flashBoss() {
    const orig = this.bossBody.fillColor;
    this.bossBody.setFillStyle(0xffffff, 1);
    this.time.delayedCall(80, () => this.bossBody.setFillStyle(orig, 1));
  }

  private flashHero() {
    this.tweens.add({
      targets: this.heroContainer,
      alpha: 0.3,
      duration: 80,
      yoyo: true,
      repeat: 2,
    });
  }

  private floatDamage(x: number, y: number, amount: number, color: string, sign: "-" | "+" = "-") {
    const txt = this.add
      .text(x, y, `${sign}${amount}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "26px",
        color,
        fontStyle: "bold",
        stroke: "#0b0512",
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this.layerEffects.add(txt);
    this.tweens.add({
      targets: txt,
      y: y - 60,
      alpha: 0,
      duration: 700,
      ease: "Quad.easeOut",
      onComplete: () => txt.destroy(),
    });
  }

  // ----------------------- Phase: treasure offer -----------------------

  private startTreasureOffer() {
    const pool = ALL_MODIFIER_KEYS.filter((k) => !this.state.modifiers.includes(k));
    if (pool.length === 0) {
      this.startFeedback();
      return;
    }

    this.phase = "treasureOffer";
    this.clearPanel();

    // Sample up to 3 unique
    Phaser.Utils.Array.Shuffle(pool);
    const choices = pool.slice(0, Math.min(3, pool.length));

    const panel = this.add.container(0, 0);
    const dim = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05060f, 0.7)
      .setOrigin(0.5);
    panel.add(dim);

    const banner = this.add
      .rectangle(GAME_WIDTH / 2, 110, 720, 64, 0x0a0512, 0.95)
      .setStrokeStyle(2, 0x7af0ff, 0.9);
    const bannerTxt = this.add
      .text(GAME_WIDTH / 2, 110, "Choose a relic", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "26px",
        color: "#7af0ff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    panel.add([banner, bannerTxt]);

    const cardW = 300;
    const cardH = 240;
    const gap = 24;
    const totalW = cardW * choices.length + gap * (choices.length - 1);
    const startX = (GAME_WIDTH - totalW) / 2;
    const y = GAME_HEIGHT / 2 + 20;

    choices.forEach((key, i) => {
      const x = startX + i * (cardW + gap) + cardW / 2;
      panel.add(this.makeRelicCard(x, y, cardW, cardH, key));
    });

    this.layerPanel.add(panel);
    this.panel = panel;
  }

  private makeRelicCard(
    x: number,
    y: number,
    w: number,
    h: number,
    key: ModifierKey,
  ): Phaser.GameObjects.Container {
    const def = MODIFIERS[key];
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, 0x0e0820, 0.98).setStrokeStyle(3, def.color);
    const icon = this.add
      .text(0, -h / 2 + 50, def.icon, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "48px",
        color: "#ffffff",
      })
      .setOrigin(0.5);
    const name = this.add
      .text(0, -h / 2 + 110, def.name, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "22px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const desc = this.add
      .text(0, 14, def.description, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#cbd5f5",
        align: "center",
        wordWrap: { width: w - 30 },
        lineSpacing: 4,
      })
      .setOrigin(0.5);
    const claim = this.add
      .text(0, h / 2 - 22, "CLAIM ▶", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#fde68a",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    c.add([bg, icon, name, desc, claim]);

    const hit = this.add.zone(0, 0, w, h).setOrigin(0.5);
    hit.setInteractive({ useHandCursor: true });
    c.add(hit);
    hit.on("pointerover", () => bg.setFillStyle(0x1a1430, 1));
    hit.on("pointerout", () => bg.setFillStyle(0x0e0820, 0.98));
    hit.on("pointerdown", () => {
      hit.disableInteractive();
      this.claimModifier(key);
    });
    return c;
  }

  private claimModifier(key: ModifierKey) {
    this.state.modifiers.push(key);
    if (key === "bulwark") {
      this.state.heroMaxHp += 30;
      this.state.heroHp = this.state.heroMaxHp;
    }
    this.saveState();
    this.refreshHud();
    this.startFeedback();
  }

  // ----------------------- Phase: feedback -----------------------

  private startFeedback() {
    this.phase = "feedback";
    this.clearPanel();

    const result = this.answerResult ?? { correct: false, correct_index: -1, explanation: "" };

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    const bg = this.add
      .rectangle(0, 0, 720, 340, 0x0a0512, 0.97)
      .setStrokeStyle(2, result.correct ? 0x4ade80 : 0xef4444);
    const title = this.add
      .text(0, -134, result.correct ? "Strike Landed" : "Wound Taken", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "26px",
        color: result.correct ? "#86efac" : "#fca5a5",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const ansLine = result.correct
      ? "Answer: CORRECT"
      : result.correct_index >= 0
        ? `Answer: WRONG  ·  Correct was: ${this.question.options[result.correct_index]}`
        : "Answer: WRONG";
    const ansText = this.add
      .text(0, -84, ansLine, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: result.correct ? "#86efac" : "#fca5a5",
        fontStyle: "bold",
        align: "center",
        wordWrap: { width: 660 },
        lineSpacing: 3,
      })
      .setOrigin(0.5);

    const explanation = this.add
      .text(0, -8, result.explanation || "—", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#cbd5f5",
        align: "center",
        wordWrap: { width: 660 },
        lineSpacing: 4,
      })
      .setOrigin(0.5);

    const stats = this.add
      .text(
        0,
        94,
        `Hero ${this.state.heroHp}/${this.state.heroMaxHp}   ·   Boss ${this.state.bossHp}/${this.state.bossMaxHp}   ·   Relics: ${this.state.modifiers.length}`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          color: "#94a3b8",
        },
      )
      .setOrigin(0.5);

    const btnBg = this.add.rectangle(0, 138, 220, 44, 0x3b3fff, 1).setStrokeStyle(1, 0x7af0ff);
    const btnText = this.add
      .text(0, 138, "Continue ▶", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const btnHit = this.add.zone(0, 138, 220, 44).setOrigin(0.5);
    btnHit.setInteractive({ useHandCursor: true });
    btnHit.on("pointerover", () => btnBg.setFillStyle(0x4f46e5));
    btnHit.on("pointerout", () => btnBg.setFillStyle(0x3b3fff));
    btnHit.on("pointerdown", () => {
      this.state.questionsAnswered += 1;
      this.saveState();
      this.onComplete();
    });

    panel.add([bg, title, ansText, explanation, stats, btnBg, btnText, btnHit]);
    this.layerPanel.add(panel);
    this.panel = panel;

    this.input.keyboard?.once("keydown-SPACE", () => {
      this.state.questionsAnswered += 1;
      this.saveState();
      this.onComplete();
    });
  }

  // ----------------------- Phase: victory -----------------------

  private startVictory() {
    this.phase = "victory";
    this.clearPanel();

    // Boss collapse
    this.tweens.add({
      targets: this.bossContainer,
      alpha: 0,
      scaleX: 0.6,
      scaleY: 0.4,
      angle: 18,
      y: BOSS_Y + 60,
      duration: 700,
      ease: "Quad.easeIn",
    });
    this.cameras.main.flash(400, 250, 250, 200);

    this.time.delayedCall(700, () => {
      const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
      const bg = this.add
        .rectangle(0, 0, 600, 280, 0x0a0512, 0.98)
        .setStrokeStyle(2, 0xfacc15);
      const title = this.add
        .text(0, -100, "WARDEN FELLED", {
          fontFamily: "system-ui, sans-serif",
          fontSize: "30px",
          color: "#fde68a",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      const sub = this.add
        .text(0, -50, "The boss lies still. You have triumphed.", {
          fontFamily: "system-ui, sans-serif",
          fontSize: "14px",
          color: "#fef3c7",
          align: "center",
        })
        .setOrigin(0.5);
      const stats = this.add
        .text(
          0,
          10,
          `Hero ${this.state.heroHp}/${this.state.heroMaxHp}   ·   Relics: ${this.state.modifiers.length}\nQuestions answered: ${this.state.questionsAnswered}`,
          {
            fontFamily: "system-ui, sans-serif",
            fontSize: "13px",
            color: "#cbd5f5",
            align: "center",
            lineSpacing: 4,
          },
        )
        .setOrigin(0.5);
      const btnBg = this.add.rectangle(0, 90, 240, 42, 0xfacc15, 1).setStrokeStyle(1, 0xfde68a);
      const btnText = this.add
        .text(0, 90, "End Run ▶", {
          fontFamily: "system-ui, sans-serif",
          fontSize: "14px",
          color: "#1c1408",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      const btnHit = this.add.zone(0, 90, 240, 42).setOrigin(0.5);
      btnHit.setInteractive({ useHandCursor: true });
      btnHit.on("pointerdown", () => {
        this.registry.remove(REGISTRY_KEY);
        this.abortRun();
      });
      panel.add([bg, title, sub, stats, btnBg, btnText, btnHit]);
      this.layerPanel.add(panel);
      this.panel = panel;

      this.input.keyboard?.once("keydown-SPACE", () => {
        this.registry.remove(REGISTRY_KEY);
        this.abortRun();
      });
    });
  }

  // ----------------------- Phase: game over -----------------------

  private startGameOver() {
    this.phase = "gameOver";
    this.clearPanel();

    // Hero collapse
    this.tweens.add({
      targets: this.heroContainer,
      alpha: 0.25,
      angle: -25,
      y: HERO_Y + 30,
      duration: 500,
      ease: "Quad.easeIn",
    });

    this.time.delayedCall(500, () => {
      const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
      const bg = this.add
        .rectangle(0, 0, 560, 240, 0x0a0512, 0.98)
        .setStrokeStyle(2, 0xef4444);
      const title = this.add
        .text(0, -82, "HERO HAS FALLEN", {
          fontFamily: "system-ui, sans-serif",
          fontSize: "26px",
          color: "#ef4444",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      const sub = this.add
        .text(
          0,
          -42,
          `The Warden stands victorious. Run ended on attack ${this.state.questionsAnswered + 1}.`,
          {
            fontFamily: "system-ui, sans-serif",
            fontSize: "13px",
            color: "#fca5a5",
            align: "center",
            wordWrap: { width: 520 },
          },
        )
        .setOrigin(0.5);
      const stats = this.add
        .text(
          0,
          4,
          `Boss remaining: ${this.state.bossHp}/${this.state.bossMaxHp}   ·   Relics: ${this.state.modifiers.length}`,
          {
            fontFamily: "system-ui, sans-serif",
            fontSize: "11px",
            color: "#94a3b8",
          },
        )
        .setOrigin(0.5);
      const btnBg = this.add.rectangle(0, 70, 220, 40, 0xef4444, 1).setStrokeStyle(1, 0xfecaca);
      const btnText = this.add
        .text(0, 70, "End Run ▶", {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          color: "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      const btnHit = this.add.zone(0, 70, 220, 40).setOrigin(0.5);
      btnHit.setInteractive({ useHandCursor: true });
      btnHit.on("pointerover", () => btnBg.setFillStyle(0xdc2626));
      btnHit.on("pointerout", () => btnBg.setFillStyle(0xef4444));
      btnHit.on("pointerdown", () => {
        this.registry.remove(REGISTRY_KEY);
        this.abortRun();
      });
      panel.add([bg, title, sub, stats, btnBg, btnText, btnHit]);
      this.layerPanel.add(panel);
      this.panel = panel;

      this.input.keyboard?.once("keydown-SPACE", () => {
        this.registry.remove(REGISTRY_KEY);
        this.abortRun();
      });
    });
  }

  // ----------------------- Utility -----------------------

  private clearPanel() {
    if (this.panel) {
      this.panel.destroy();
      this.panel = null;
    }
  }
}

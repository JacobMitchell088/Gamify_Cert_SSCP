import Phaser from "phaser";

import type { AnswerResult, Question } from "../types";
import { GAME_HEIGHT, GAME_WIDTH, makeDevAnswerBadge, type SceneData } from "./sceneContract";

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
const HERO_Y = 515;
const BOSS_X = 960;
const BOSS_Y = 540;

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
  private heroSprite!: Phaser.GameObjects.Sprite;
  private bossContainer!: Phaser.GameObjects.Container;
  private bossSprite!: Phaser.GameObjects.Sprite;

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

  preload() {
    // Cell pitch derived from the source sheets via empty-column detection:
    //   hood  source = 1344×1463 = 12 cols × 11 rows of 112×133
    //   golem source = 1000×1000 = 10 cols × 10 rows of 100×100
    // Earlier 96×100 / 125×100 guesses caused the character to drift right
    // across frames and snap back — each sliced frame was capturing part of
    // the next cell instead of one whole cell.
    if (!this.textures.exists("hood_idle")) {
      this.load.spritesheet("hood_idle", "/sprites/hood_idle.png", {
        frameWidth: 112,
        frameHeight: 133,
      });
    }
    if (!this.textures.exists("hood_attack")) {
      this.load.spritesheet("hood_attack", "/sprites/hood_attack.png", {
        frameWidth: 112,
        frameHeight: 133,
      });
    }
    if (!this.textures.exists("golem_idle")) {
      this.load.spritesheet("golem_idle", "/sprites/golem_idle.png", {
        frameWidth: 100,
        frameHeight: 100,
      });
    }
    if (!this.textures.exists("golem_attack")) {
      this.load.spritesheet("golem_attack", "/sprites/golem_attack.png", {
        frameWidth: 100,
        frameHeight: 100,
      });
    }
    if (!this.textures.exists("rpg_sky")) {
      this.load.image("rpg_sky", "/sprites/sky.png");
    }
    if (!this.textures.exists("rpg_moon")) {
      this.load.image("rpg_moon", "/sprites/moon.png");
    }
    if (!this.textures.exists("rpg_stars")) {
      this.load.image("rpg_stars", "/sprites/stars.png");
    }
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

      const isFirstAttack = this.state.questionsAnswered === 0;

      this.ensureAnimations();
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

      if (isFirstAttack) {
        this.startEntrance();
      } else {
        this.startTelegraph();
      }
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

  // ----------------------- Animations -----------------------

  private ensureAnimations() {
    // Hood idle (sheet row 0) and slash (sheet row 5) are both 12 frames.
    // Golem idle (row 1) and arm-extend shoot (row 2) are both 8 frames.
    if (!this.anims.exists("hood_idle")) {
      this.anims.create({
        key: "hood_idle",
        frames: this.anims.generateFrameNumbers("hood_idle", { start: 0, end: 11 }),
        frameRate: 8,
        repeat: -1,
      });
    }
    if (!this.anims.exists("hood_attack")) {
      this.anims.create({
        key: "hood_attack",
        frames: this.anims.generateFrameNumbers("hood_attack", { start: 0, end: 11 }),
        frameRate: 18,
        repeat: 0,
      });
    }
    if (!this.anims.exists("golem_idle")) {
      this.anims.create({
        key: "golem_idle",
        frames: this.anims.generateFrameNumbers("golem_idle", { start: 0, end: 7 }),
        frameRate: 6,
        repeat: -1,
      });
    }
    if (!this.anims.exists("golem_attack")) {
      this.anims.create({
        key: "golem_attack",
        frames: this.anims.generateFrameNumbers("golem_attack", { start: 0, end: 7 }),
        frameRate: 12,
        repeat: 0,
      });
    }
  }

  // ----------------------- Backdrop -----------------------

  private drawBackdrop() {
    // Sky covers the whole canvas (source is 480×270, scaled up). Pixel-art look stays sharp
    // because Phaser is configured antialias:true; here we kill smoothing on this texture only.
    const skyTex = this.textures.get("rpg_sky");
    skyTex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const sky = this.add
      .image(0, 0, "rpg_sky")
      .setOrigin(0, 0)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    this.layerWorld.add(sky);

    // Tiled stars near the top for parallax. Stars.png is small so we tile it.
    this.textures.get("rpg_stars").setFilter(Phaser.Textures.FilterMode.NEAREST);
    const starsTile = this.add
      .tileSprite(0, 0, GAME_WIDTH, 360, "rpg_stars")
      .setOrigin(0, 0)
      .setAlpha(0.85);
    this.layerWorld.add(starsTile);
    // Slow drift to sell parallax.
    this.tweens.add({
      targets: starsTile,
      tilePositionX: { from: 0, to: -200 },
      duration: 60000,
      repeat: -1,
    });

    // Moon as a single accent in the upper-right.
    this.textures.get("rpg_moon").setFilter(Phaser.Textures.FilterMode.NEAREST);
    const moon = this.add
      .image(GAME_WIDTH - 140, 120, "rpg_moon")
      .setScale(2.2)
      .setAlpha(0.95);
    this.layerWorld.add(moon);
    this.tweens.add({
      targets: moon,
      alpha: 0.7,
      yoyo: true,
      repeat: -1,
      duration: 4000,
      ease: "Sine.easeInOut",
    });

    // Dark arena floor strip across the bottom (the sprites are anchored to it).
    const floor = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 120, GAME_WIDTH, 240, 0x06030a, 0.78)
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

    // Pillars (kept; they frame the arena under the new sky).
    for (const x of [140, GAME_WIDTH - 140]) {
      const pillar = this.add.rectangle(x, GAME_HEIGHT - 320, 36, 360, 0x1c1430, 1).setOrigin(0.5, 0);
      const cap = this.add.rectangle(x, GAME_HEIGHT - 320, 56, 16, 0x2a1f48, 1).setOrigin(0.5, 0.5);
      this.layerWorld.add([pillar, cap]);
    }
  }

  // ----------------------- Boss -----------------------

  private drawBoss() {
    const c = this.add.container(BOSS_X, BOSS_Y);

    // Shadow under boss, anchored at the character's foot line (~+60 in container space).
    const shadow = this.add.ellipse(0, 60, 240, 38, 0x000000, 0.5);

    // Flip horizontally so the arm-extension attack faces the hero (left).
    this.textures.get("golem_idle").setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get("golem_attack").setFilter(Phaser.Textures.FilterMode.NEAREST);
    const sprite = this.add
      .sprite(0, 0, "golem_idle")
      .setScale(3)
      .setFlipX(true)
      .setOrigin(0.5, 0.5);
    this.bossSprite = sprite;
    this.bossSprite.play("golem_idle");

    // Return to idle after attack animation completes.
    this.bossSprite.on(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      (anim: Phaser.Animations.Animation) => {
        if (anim.key === "golem_attack") this.bossSprite.play("golem_idle");
      },
    );

    c.add([shadow, sprite]);
    this.layerWorld.add(c);
    this.bossContainer = c;

    // Golem idle has no built-in bob, so we float the sprite up/down here.
    // Shadow scales inversely — shrinks when the golem rises (further from ground).
    this.tweens.add({
      targets: sprite,
      y: -16,
      yoyo: true,
      repeat: -1,
      duration: 1600,
      ease: "Sine.easeInOut",
    });
    this.tweens.add({
      targets: shadow,
      scaleX: 0.7,
      scaleY: 0.7,
      yoyo: true,
      repeat: -1,
      duration: 1600,
      ease: "Sine.easeInOut",
    });
  }

  /** Trigger the boss attack animation. */
  private playBossAttack() {
    if (!this.bossSprite) return;
    this.bossSprite.play("golem_attack");
  }

  private bossPhaseColor(): number {
    // Sprite tint: full-bright at high HP, increasingly bloody-red at low HP.
    // Phaser tints multiply per-channel, so anything below 0xff dims that channel.
    const pct = this.state.bossHp / this.state.bossMaxHp;
    if (pct <= 0.33) return 0xff8888;
    if (pct <= 0.66) return 0xffbbbb;
    return 0xffffff;
  }

  // ----------------------- Hero -----------------------

  private drawHero() {
    const c = this.add.container(HERO_X, HERO_Y);
    // Shadow anchored at the character's foot line (~+85 in container space at scale 2.8).
    const shadow = this.add.ellipse(0, 85, 110, 20, 0x000000, 0.5);

    // Source sheet has the hood facing left; flip so it faces the boss on the right.
    this.textures.get("hood_idle").setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get("hood_attack").setFilter(Phaser.Textures.FilterMode.NEAREST);
    const sprite = this.add
      .sprite(0, 0, "hood_idle")
      .setScale(2.8)
      .setFlipX(true)
      .setOrigin(0.5, 0.5);
    this.heroSprite = sprite;
    this.heroSprite.play("hood_idle");

    this.heroSprite.on(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      (anim: Phaser.Animations.Animation) => {
        if (anim.key === "hood_attack") this.heroSprite.play("hood_idle");
      },
    );

    c.add([shadow, sprite]);
    this.layerWorld.add(c);
    this.heroContainer = c;

    // Drive the shadow scale directly from the idle animation's frame events
    // so it can't drift against the sprite. The hood's idle bob (per user
    // observation):
    //   Frame 1      : on ground (full shadow)
    //   Frames 2–5   : jumping up, peak at 5    (shadow shrinks → 0.85)
    //   Frames 6–7   : coming down, lands at 7  (shadow grows → 1.0)
    //   Frames 8–12  : grounded                 (shadow held at 1.0)
    const SHADOW_MIN = 0.85;
    const SHADOW_MAX = 1;
    const scaleForFrame = (idx: number): number => {
      if (idx <= 1) return SHADOW_MAX;
      if (idx <= 5) {
        const t = (idx - 1) / 4; // 0.25 → 1.0
        return SHADOW_MAX - (SHADOW_MAX - SHADOW_MIN) * t;
      }
      if (idx <= 7) {
        const t = (idx - 5) / 2; // 0.5 → 1.0
        return SHADOW_MIN + (SHADOW_MAX - SHADOW_MIN) * t;
      }
      return SHADOW_MAX;
    };
    this.heroSprite.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      (anim: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame) => {
        if (anim.key !== "hood_idle") return;
        const s = scaleForFrame(frame.index);
        shadow.setScale(s);
      },
    );
  }

  /** Trigger the hero attack animation. */
  private playHeroAttack() {
    if (!this.heroSprite) return;
    this.heroSprite.play("hood_attack");
  }

  // ----------------------- HUD -----------------------

  private drawHud() {
    // Two HP bars side by side along the top so they never overlap.
    // Hero on the left, boss on the right, status text centered between them.
    const barY = 20;
    const barH = 28;
    const heroBarX = 20;
    const heroBarW = 480;
    const bossBarW = 480;
    const bossBarX = GAME_WIDTH - 20 - bossBarW;

    // Hero block (top-left)
    const heroBarBg = this.add
      .rectangle(heroBarX, barY, heroBarW, barH, 0x1e0a1a, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x475569);
    this.heroHpBar = this.add
      .rectangle(
        heroBarX + 2,
        barY + 2,
        (heroBarW - 4) * this.heroHpPct(),
        barH - 4,
        0x4ade80,
        1,
      )
      .setOrigin(0, 0);
    const heroLabel = this.add
      .text(heroBarX + 10, barY + barH / 2, "HERO", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#cbd5f5",
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5);
    this.heroHpText = this.add
      .text(
        heroBarX + heroBarW - 10,
        barY + barH / 2,
        `${this.state.heroHp} / ${this.state.heroMaxHp}`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "12px",
          color: "#f1f5f9",
          fontStyle: "bold",
        },
      )
      .setOrigin(1, 0.5);

    // Boss block (top-right)
    const bossBarBg = this.add
      .rectangle(bossBarX, barY, bossBarW, barH, 0x140820, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0xe11d48);
    this.bossHpBar = this.add
      .rectangle(
        bossBarX + 2,
        barY + 2,
        (bossBarW - 4) * this.bossHpPct(),
        barH - 4,
        0xe11d48,
        1,
      )
      .setOrigin(0, 0);
    const bossLabel = this.add
      .text(bossBarX + 10, barY + barH / 2, "THE WARDEN", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#fda4af",
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5);
    this.bossHpText = this.add
      .text(
        bossBarX + bossBarW - 10,
        barY + barH / 2,
        `${this.state.bossHp} / ${this.state.bossMaxHp}`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "12px",
          color: "#fee2e2",
          fontStyle: "bold",
        },
      )
      .setOrigin(1, 0.5);

    // Status (run progress + streak) sits in the center gap between the bars.
    this.statusText = this.add
      .text(GAME_WIDTH / 2, barY + barH / 2, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#cbd5f5",
        align: "center",
      })
      .setOrigin(0.5, 0.5);

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
    // Both bars share the same inner width (480 - 4 = 476).
    const innerW = 476;
    this.heroHpBar.width = innerW * this.heroHpPct();
    this.heroHpBar.fillColor =
      this.heroHpPct() > 0.5 ? 0x4ade80 : this.heroHpPct() > 0.2 ? 0xfacc15 : 0xef4444;
    this.heroHpText.setText(`${Math.max(0, this.state.heroHp)} / ${this.state.heroMaxHp}`);

    this.bossHpBar.width = innerW * this.bossHpPct();
    this.bossHpText.setText(`${Math.max(0, this.state.bossHp)} / ${this.state.bossMaxHp}`);
    // Boss sprite gets a colored tint as HP drops (cool→hot to signal rage phases).
    if (this.bossSprite) this.bossSprite.setTint(this.bossPhaseColor());

    this.statusText.setText(
      `Attack ${this.state.questionsAnswered + 1}   ·   Streak ${this.state.streak}`,
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

  // ----------------------- Phase: entrance (first attack only) -----------------------

  private startEntrance() {
    // Slide both characters in from off-screen so the run opens with a "fight begins" beat.
    // Only runs on questionsAnswered===0 (re-init mid-run skips this and goes straight to telegraph).
    const heroStartX = -240;
    const bossStartX = GAME_WIDTH + 240;
    this.heroContainer.x = heroStartX;
    this.bossContainer.x = bossStartX;

    const slideDur = 760;
    this.tweens.add({
      targets: this.heroContainer,
      x: HERO_X,
      duration: slideDur,
      ease: "Cubic.easeOut",
    });
    this.tweens.add({
      targets: this.bossContainer,
      x: BOSS_X,
      duration: slideDur,
      ease: "Cubic.easeOut",
    });

    // READY banner punches in after the slide, lingers, then fades.
    const ready = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, "READY", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "56px",
        color: "#fde68a",
        fontStyle: "bold",
        stroke: "#0b0512",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setScale(0.7);
    this.layerEffects.add(ready);

    this.tweens.add({
      targets: ready,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 280,
      delay: slideDur - 60,
      ease: "Back.easeOut",
    });
    this.time.delayedCall(slideDur + 700, () => {
      this.tweens.add({
        targets: ready,
        alpha: 0,
        scaleX: 1.25,
        scaleY: 1.25,
        duration: 320,
        ease: "Sine.easeIn",
        onComplete: () => ready.destroy(),
      });
    });

    // Slight pause after READY fades, then hand off to the normal telegraph.
    this.time.delayedCall(slideDur + 1180, () => {
      this.startTelegraph();
    });
  }

  // ----------------------- Phase: telegraph -----------------------

  private startTelegraph() {
    this.phase = "telegraph";

    // Slow, weighty wind-up: bigger scale punch + a longer red sprite tint.
    this.tweens.add({
      targets: this.bossContainer,
      scaleX: 1.12,
      scaleY: 1.12,
      duration: 480,
      yoyo: true,
      ease: "Quad.easeOut",
    });
    if (this.bossSprite) {
      this.bossSprite.setTint(0xff5555);
      this.time.delayedCall(700, () => this.bossSprite.setTint(this.bossPhaseColor()));
    }

    // Big center-screen sigil. Fades in fast, lingers into the question, then fades.
    const sigilText = this.isTreasure ? "✦ RELIC CHAMBER ✦" : "ATTACK INCOMING";
    const sigil = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, sigilText, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "44px",
        color: this.isTreasure ? "#7af0ff" : "#fca5a5",
        fontStyle: "bold",
        stroke: "#0b0512",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setScale(0.8);
    this.layerEffects.add(sigil);

    // Punch in.
    this.tweens.add({
      targets: sigil,
      alpha: 1,
      scaleX: 1.0,
      scaleY: 1.0,
      duration: 280,
      ease: "Back.easeOut",
    });

    // Hold the sigil onscreen, then launch the question while it's still visible.
    this.time.delayedCall(1100, () => {
      this.startQuestion();
    });

    // Sigil lingers ~1.4s into the question reading, then fades out and dies.
    this.time.delayedCall(1500, () => {
      this.tweens.add({
        targets: sigil,
        alpha: 0,
        y: GAME_HEIGHT / 2 - 60,
        duration: 700,
        ease: "Sine.easeIn",
        onComplete: () => sigil.destroy(),
      });
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

    // ---------- Pre-measure option cards so they grow to fit the longest answer ----------
    // Floor strip starts at y=600 and runs to GAME_HEIGHT (720), so cards must fit
    // inside a 120 px tall band — keep maxCardH and bottom margin tight to that.
    const cardW = 215;
    const optionFontPx = 13;
    const optionWrapW = cardW - 24;
    const optionPadTop = 24;
    const optionPadBottom = 10;
    const minCardH = 96;
    const maxCardH = 116;
    let tallestOption = 0;
    const measureProbes: Phaser.GameObjects.Text[] = [];
    for (const opt of this.question.options) {
      const probe = this.add
        .text(0, 0, opt, {
          fontFamily: "system-ui, sans-serif",
          fontSize: `${optionFontPx}px`,
          color: "#f1f5f9",
          align: "center",
          wordWrap: { width: optionWrapW },
          lineSpacing: 2,
        })
        .setVisible(false);
      measureProbes.push(probe);
      if (probe.height > tallestOption) tallestOption = probe.height;
    }
    for (const p of measureProbes) p.destroy();
    const cardH = Phaser.Math.Clamp(
      tallestOption + optionPadTop + optionPadBottom,
      minCardH,
      maxCardH,
    );
    const optionBottomMargin = 4;
    const optionY = GAME_HEIGHT - cardH / 2 - optionBottomMargin;
    const optionTopY = optionY - cardH / 2;

    // Band starts just below the HUD bars + modifier badges (which end ~y=82).
    // Anchor the question panel to the TOP of the band so the sprites stay visible.
    const bandTop = 92;
    const bandBottom = optionTopY - 12;
    const maxBoxH = Math.max(minCardH, bandBottom - bandTop);
    const computedBoxH = padTop + labelH + labelGap + stemH + padBottom;
    const stemBoxH = Phaser.Math.Clamp(computedBoxH, 96, maxBoxH);

    const boxTop = bandTop;
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
    const gap = 14;
    const totalW = cardW * 4 + gap * 3;
    const startX = (GAME_WIDTH - totalW) / 2;

    this.question.options.forEach((opt, i) => {
      const x = startX + i * (cardW + gap) + cardW / 2;
      panel.add(this.makeOptionCard(x, optionY, cardW, cardH, opt, i));
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
    const stripe = this.add.rectangle(-w / 2 + 6, 0, 4, h - 14, accent, 0.9);
    const letter = this.add
      .text(-w / 2 + 18, -h / 2 + 8, labels[idx], {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#cbd5f5",
        fontStyle: "bold",
      })
      .setOrigin(0, 0);
    const body = this.add
      .text(0, 8, text, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#f1f5f9",
        align: "center",
        wordWrap: { width: w - 24 },
        lineSpacing: 2,
      })
      .setOrigin(0.5);
    c.add([bg, stripe, letter, body]);
    const devBadge = makeDevAnswerBadge(this, this.question, idx, w, h);
    if (devBadge) c.add(devBadge);

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

    // Hero plays slash animation and lunges forward — a beat slower for impact.
    this.playHeroAttack();
    const lunge = this.tweens.add({
      targets: this.heroContainer,
      x: HERO_X + 100,
      duration: 240,
      yoyo: true,
      ease: "Quad.easeOut",
    });
    void lunge;

    const dmg = this.computeCounterDamage();
    const strikes = this.state.modifiers.includes("riposte") ? 2 : 1;
    let totalDealt = 0;
    for (let i = 0; i < strikes; i++) {
      this.time.delayedCall(320 + i * 380, () => {
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
      this.time.delayedCall(380, () => {
        this.floatDamage(HERO_X, HERO_Y - 80, heal, "#86efac", "+");
        this.refreshHud();
      });
    }

    // Banner — held longer so the player can read it.
    const banner = this.add
      .text(GAME_WIDTH / 2, 220, this.isTreasure ? "RELIC SECURED" : "PARRY!", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "36px",
        color: this.isTreasure ? "#7af0ff" : "#4ade80",
        fontStyle: "bold",
        stroke: "#0b0512",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.layerEffects.add(banner);
    this.tweens.add({
      targets: banner,
      alpha: 1,
      y: 200,
      duration: 240,
      yoyo: true,
      hold: 700,
      onComplete: () => banner.destroy(),
    });

    const settleAfter = 320 + strikes * 380 + 500;
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

    // Boss plays the arm-extension attack and lunges toward the hero. Slower beats
    // so the hit lands properly — wind-up, strike, recoil.
    this.playBossAttack();
    this.tweens.add({
      targets: this.bossContainer,
      x: BOSS_X - 80,
      duration: 320,
      yoyo: true,
      ease: "Quad.easeOut",
    });
    this.cameras.main.shake(360, 0.014);
    this.cameras.main.flash(260, 200, 30, 30);

    const dmg = this.computeIncomingDamage();
    this.state.heroHp = Math.max(0, this.state.heroHp - dmg);
    this.flashHero();
    this.floatDamage(HERO_X, HERO_Y - 80, dmg, "#fca5a5", "-");
    this.refreshHud();

    const banner = this.add
      .text(GAME_WIDTH / 2, 220, this.isTreasure ? "RELIC LOST" : "HIT!", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "36px",
        color: "#ef4444",
        fontStyle: "bold",
        stroke: "#0b0512",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.layerEffects.add(banner);
    this.tweens.add({
      targets: banner,
      alpha: 1,
      y: 200,
      duration: 240,
      yoyo: true,
      hold: 700,
      onComplete: () => banner.destroy(),
    });

    this.time.delayedCall(1500, () => {
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
    if (!this.bossSprite) return;
    this.bossSprite.setTint(0xffffff);
    this.time.delayedCall(80, () => {
      if (this.bossSprite) this.bossSprite.setTint(this.bossPhaseColor());
    });
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
    const accent = result.correct ? 0x4ade80 : 0xef4444;
    const titleColor = result.correct ? "#86efac" : "#fca5a5";

    // Build each text element first so we can read its measured .height,
    // then compute the bg rectangle and y-positions to fit everything.
    const title = this.add
      .text(0, 0, result.correct ? "Strike Landed" : "Wound Taken", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "26px",
        color: titleColor,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const ansLine = result.correct
      ? "Answer: CORRECT"
      : result.correct_index >= 0
        ? `Answer: WRONG  ·  Correct was: ${this.question.options[result.correct_index]}`
        : "Answer: WRONG";
    const ansText = this.add
      .text(0, 0, ansLine, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: titleColor,
        fontStyle: "bold",
        align: "center",
        wordWrap: { width: 660 },
        lineSpacing: 3,
      })
      .setOrigin(0.5);

    const explanation = this.add
      .text(0, 0, result.explanation || "—", {
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
        0,
        `Hero ${this.state.heroHp}/${this.state.heroMaxHp}   ·   Boss ${this.state.bossHp}/${this.state.bossMaxHp}   ·   Relics: ${this.state.modifiers.length}`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          color: "#94a3b8",
        },
      )
      .setOrigin(0.5);

    // Layout constants — gaps between sections, padding at top/bottom.
    const padTop = 24;
    const padBottom = 24;
    const gapTitleAns = 18;
    const gapAnsExp = 18;
    const gapExpStats = 22;
    const gapStatsBtn = 18;
    const btnH = 44;
    const panelW = 720;
    const minPanelH = 280;
    const maxPanelH = GAME_HEIGHT - 60;

    const contentH =
      padTop +
      title.height +
      gapTitleAns +
      ansText.height +
      gapAnsExp +
      explanation.height +
      gapExpStats +
      stats.height +
      gapStatsBtn +
      btnH +
      padBottom;
    const panelH = Phaser.Math.Clamp(contentH, minPanelH, maxPanelH);

    const bg = this.add
      .rectangle(0, 0, panelW, panelH, 0x0a0512, 0.97)
      .setStrokeStyle(2, accent);

    // Walk down from the top of the bg, placing each element by its center.
    let y = -panelH / 2 + padTop;
    title.setY(y + title.height / 2);
    y += title.height + gapTitleAns;
    ansText.setY(y + ansText.height / 2);
    y += ansText.height + gapAnsExp;
    explanation.setY(y + explanation.height / 2);
    y += explanation.height + gapExpStats;
    stats.setY(y + stats.height / 2);
    y += stats.height + gapStatsBtn;
    const btnY = y + btnH / 2;

    const btnBg = this.add.rectangle(0, btnY, 220, btnH, 0x3b3fff, 1).setStrokeStyle(1, 0x7af0ff);
    const btnText = this.add
      .text(0, btnY, "Continue ▶", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const btnHit = this.add.zone(0, btnY, 220, btnH).setOrigin(0.5);
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

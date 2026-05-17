import Phaser from "phaser";

import type { AnswerResult, Question } from "../types";
import { GAME_HEIGHT, GAME_WIDTH, makeDevAnswerBadge, type SceneData } from "./sceneContract";

// ----------------------- Path & map -----------------------

const PATH_POINTS: [number, number][] = [
  [-40, 150],
  [310, 150],
  [310, 310],
  [640, 310],
  [640, 470],
  [990, 470],
  [990, 230],
  [1320, 230],
];
const CORE_X = 1240;
const CORE_Y = 230;
const PATH_BUFFER = 36;
const TOWER_MIN_SPACING = 36;
const PLACEMENT_BOUNDS = { minX: 24, maxX: GAME_WIDTH - 24, minY: 80, maxY: GAME_HEIGHT - 30 };

// ----------------------- Towers -----------------------

type TowerType = "aoe" | "sniper" | "triple";

interface TowerDef {
  name: string;
  short: string;
  description: string;
  color: number;
  damages: number[];
  ranges: number[];
  fireRates: number[];
}

const TOWER_DEFS: Record<TowerType, TowerDef> = {
  aoe: {
    name: "Pulse Coil",
    short: "AOE",
    description: "Hits every creep in range each pulse. Short range, steady DPS.",
    color: 0xf97316,
    damages: [14, 25, 39],
    ranges: [85, 95, 110],
    fireRates: [850, 750, 650],
  },
  sniper: {
    name: "Rail Cannon",
    short: "SNIPE",
    description: "One precise shot at the furthest creep. Long range, huge hit.",
    color: 0x38bdf8,
    damages: [42, 75, 130],
    ranges: [230, 250, 280],
    fireRates: [1100, 950, 850],
  },
  triple: {
    name: "Triburst",
    short: "TRI",
    description: "Three projectiles per volley in a spread. Medium range, fast fire.",
    color: 0x4ade80,
    damages: [12, 20, 32],
    ranges: [140, 155, 175],
    fireRates: [600, 520, 450],
  },
};

const TOWER_TYPES: TowerType[] = ["aoe", "sniper", "triple"];
const WEAK_FACTOR = 0.45;

interface TowerState {
  id: number;
  x: number;
  y: number;
  type: TowerType;
  tier: 1 | 2 | 3;
  weak: boolean;
}

// ----------------------- Creeps -----------------------

type CreepType = "scout" | "brute" | "stalker" | "bat";

interface CreepDef {
  name: string;
  baseHp: number;
  baseSpeed: number;
  radius: number;
  color: number;
  innerColor: number;
  damageOnLeak: number;
  /** sprite key suffix; full key is `td_${spriteKey}` */
  spriteKey: string;
  /** Render scale on the 24×24 spritesheet frames. */
  scale: number;
  /** stalker only: lunge speed multiplier */
  lunge?: { every: number; duration: number; mult: number };
  /** bat only: periodic AOE heal of nearby creeps. */
  heal?: { every: number; radius: number; amount: number };
}

const CREEP_DEFS: Record<CreepType, CreepDef> = {
  scout: {
    name: "Scout",
    baseHp: 40,
    baseSpeed: 0.115,
    radius: 10,
    color: 0xfca5a5,
    innerColor: 0xfee2e2,
    damageOnLeak: 8,
    spriteKey: "scout",
    scale: 1.5,
  },
  brute: {
    name: "Brute",
    baseHp: 160,
    baseSpeed: 0.055,
    radius: 20,
    color: 0xb91c1c,
    innerColor: 0xfecaca,
    damageOnLeak: 22,
    spriteKey: "brute",
    scale: 2.3,
  },
  stalker: {
    name: "Stalker",
    baseHp: 85,
    baseSpeed: 0.08,
    radius: 14,
    color: 0xa855f7,
    innerColor: 0xe9d5ff,
    damageOnLeak: 14,
    spriteKey: "stalker",
    scale: 1.9,
    lunge: { every: 1900, duration: 420, mult: 2.4 },
  },
  bat: {
    name: "Bat (Medic)",
    baseHp: 55,
    baseSpeed: 0.115,
    radius: 9,
    color: 0x86efac,
    innerColor: 0xd1fae5,
    damageOnLeak: 10,
    spriteKey: "bat",
    scale: 1.4,
    heal: { every: 1800, radius: 70, amount: 6 },
  },
};

interface PersistentState {
  runId: number;
  questionsAnswered: number;
  coreHp: number;
  towers: TowerState[];
  nextTowerId: number;
  /** Permanent escalation counter — every wrong answer bumps future wave size + spawn rate. */
  wrongAnswers: number;
}

const REGISTRY_KEY = "td_state_v5";

/** Permanent penalty applied to every future wave per wrong answer. */
const WRONG_EXTRA_ENEMIES_PER = 2;
const WRONG_SPAWN_INTERVAL_DELTA_MS = 12;

// ----------------------- Wave config -----------------------

function buildWaveQueue(qIndex: number, wrongCount: number): CreepType[] {
  // Easier opening (Q0 starts at 3) but ramps up faster than the old curve.
  const base = 3 + Math.floor(qIndex * 1.35);
  const wrongBonus = wrongCount * WRONG_EXTRA_ENEMIES_PER;
  const total = Math.min(36, base + wrongBonus);
  // Bats join the menagerie a bit earlier than brutes; they're support, not bruisers.
  const pBat = qIndex < 4 ? 0 : Math.min(0.18, (qIndex - 3) * 0.028);
  const pBrute = qIndex < 3 ? 0 : Math.min(0.32, (qIndex - 2) * 0.052);
  const pStalker = qIndex < 5 ? 0 : Math.min(0.32, (qIndex - 4) * 0.052);
  const list: CreepType[] = [];
  for (let i = 0; i < total; i++) {
    const r = Math.random();
    if (r < pBat) list.push("bat");
    else if (r < pBat + pBrute) list.push("brute");
    else if (r < pBat + pBrute + pStalker) list.push("stalker");
    else list.push("scout");
  }
  return list;
}

function waveScaling(qIndex: number, wrongCount: number) {
  // Spawn interval shrinks faster than before: Q0=700ms (same), Q10=480ms, Q20=260ms,
  // floor at 200ms. Wrong answers shave further on top of that, forever.
  const interval = 700 - qIndex * 22 - wrongCount * WRONG_SPAWN_INTERVAL_DELTA_MS;
  return {
    hpMult: 1 + qIndex * 0.105,
    speedMult: 1 + qIndex * 0.016,
    spawnInterval: Math.max(200, interval),
  };
}

interface Creep {
  type: CreepType;
  sprite: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hp: number;
  maxHp: number;
  progress: number;
  baseSpeed: number;
  currentSpeed: number;
  // Lunge state (stalker)
  nextLungeAt: number;
  lungeEndsAt: number;
  // Heal pulse state (bat)
  nextHealAt: number;
  alive: boolean;
}

interface TowerVisual {
  state: TowerState;
  container: Phaser.GameObjects.Container;
  rangeCircle: Phaser.GameObjects.Arc;
  hitZone: Phaser.GameObjects.Zone;
  label: Phaser.GameObjects.Text;
  nextFireAt: number;
  glow?: Phaser.GameObjects.Arc;
  pulseTween: Phaser.Tweens.Tween | null;
}

type Phase =
  | "answering"
  | "choosing"
  | "upgradeSelect"
  | "placing"
  | "wave"
  | "feedback"
  | "gameOver";

// ----------------------- Scene -----------------------

export class TowerDefenseScene extends Phaser.Scene {
  private state!: PersistentState;

  private question!: Question;
  private recordAnswer!: (idx: number) => Promise<AnswerResult>;
  private onComplete!: () => void;
  private abortRun!: () => void;
  private answerResult: AnswerResult | null = null;
  private phase: Phase = "answering";

  private path!: Phaser.Curves.Path;
  private pathGraphics!: Phaser.GameObjects.Graphics;
  private towerVisuals: TowerVisual[] = [];
  private creeps: Creep[] = [];
  private waveQueue: CreepType[] = [];
  private layerWorld!: Phaser.GameObjects.Container;
  private layerEffects!: Phaser.GameObjects.Container;
  private layerUi!: Phaser.GameObjects.Container;

  private hpText!: Phaser.GameObjects.Text;
  private hpBar!: Phaser.GameObjects.Rectangle;
  private hpBarBg!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;

  private panel: Phaser.GameObjects.Container | null = null;

  private placementType: TowerType = "aoe";
  private placementWeak = false;
  private placementPreview: Phaser.GameObjects.Container | null = null;
  private placementArmedAt = 0;

  private nextSpawnAt = 0;
  private waveStartCoreHp = 100;
  private waveCreepsLeaked = 0;
  private waveEnding = false;

  private pathSegments: Array<[Phaser.Math.Vector2, Phaser.Math.Vector2]> = [];

  constructor() {
    super({ key: "TowerDefenseScene" });
  }

  preload() {
    for (const key of ["scout", "brute", "stalker", "bat"] as const) {
      const texKey = `td_${key}`;
      if (this.textures.exists(texKey)) continue;
      this.load.spritesheet(texKey, `/sprites/td/${key}.png`, {
        frameWidth: 24,
        frameHeight: 24,
      });
    }
  }

  init(data: SceneData) {
    // Phaser auto-boots the first scene at game start with no data. Skip wiring
    // until GameHost explicitly restarts us with a real SceneData payload.
    if (!data || !data.question) return;
    this.question = data.question;
    this.recordAnswer = data.recordAnswer;
    this.onComplete = data.onComplete;
    this.abortRun = data.abortRun;
    this.answerResult = null;
    this.phase = "answering";
    this.towerVisuals = [];
    this.creeps = [];
    this.waveQueue = [];
    this.panel = null;
    this.placementPreview = null;
  }

  create() {
    if (!this.question) return;
    this.cameras.main.setBackgroundColor("#070a18");
    this.loadOrInitState();
    this.ensureCreepAnimations();

    this.layerWorld = this.add.container(0, 0);
    this.layerEffects = this.add.container(0, 0);
    this.layerUi = this.add.container(0, 0);

    this.buildPath();
    this.drawBackdrop();
    this.drawCore();
    this.drawHud();
    this.redrawTowers();

    this.startAnswering();
  }

  private ensureCreepAnimations() {
    for (const key of ["scout", "brute", "stalker", "bat"] as const) {
      const texKey = `td_${key}`;
      const animKey = `${texKey}_walk`;
      const tex = this.textures.get(texKey);
      // Pixel-art creeps shouldn't get bilinear smoothing.
      if (tex && tex.key !== "__MISSING") tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
      if (this.anims.exists(animKey)) continue;
      this.anims.create({
        key: animKey,
        frames: this.anims.generateFrameNumbers(texKey, { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  update(time: number, delta: number) {
    if (this.phase === "placing") this.updatePlacementPreview();
    if (this.phase === "wave") this.tickWave(time, delta);
  }

  // ----------------------- Persistence -----------------------

  private loadOrInitState() {
    const existing = this.registry.get(REGISTRY_KEY) as PersistentState | undefined;
    if (existing) {
      // Defensive: an older in-memory shape might be missing wrongAnswers.
      if (existing.wrongAnswers === undefined) existing.wrongAnswers = 0;
      this.state = existing;
      return;
    }
    this.state = {
      runId: 0,
      questionsAnswered: 0,
      coreHp: 100,
      towers: [],
      nextTowerId: 1,
      wrongAnswers: 0,
    };
    this.registry.set(REGISTRY_KEY, this.state);
  }

  private saveState() {
    this.registry.set(REGISTRY_KEY, this.state);
  }

  // ----------------------- World drawing -----------------------

  private buildPath() {
    this.path = new Phaser.Curves.Path(PATH_POINTS[0][0], PATH_POINTS[0][1]);
    for (let i = 1; i < PATH_POINTS.length; i++) {
      this.path.lineTo(PATH_POINTS[i][0], PATH_POINTS[i][1]);
    }
    this.pathSegments = [];
    for (let i = 0; i < PATH_POINTS.length - 1; i++) {
      this.pathSegments.push([
        new Phaser.Math.Vector2(PATH_POINTS[i][0], PATH_POINTS[i][1]),
        new Phaser.Math.Vector2(PATH_POINTS[i + 1][0], PATH_POINTS[i + 1][1]),
      ]);
    }
  }

  private drawBackdrop() {
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x141a30, 0.6);
    for (let x = 0; x < GAME_WIDTH; x += 40) grid.lineBetween(x, 0, x, GAME_HEIGHT);
    for (let y = 0; y < GAME_HEIGHT; y += 40) grid.lineBetween(0, y, GAME_WIDTH, y);
    this.layerWorld.add(grid);

    this.pathGraphics = this.add.graphics();
    this.pathGraphics.lineStyle(38, 0x1a2240, 1);
    this.pathGraphics.beginPath();
    this.pathGraphics.moveTo(PATH_POINTS[0][0], PATH_POINTS[0][1]);
    for (let i = 1; i < PATH_POINTS.length; i++) {
      this.pathGraphics.lineTo(PATH_POINTS[i][0], PATH_POINTS[i][1]);
    }
    this.pathGraphics.strokePath();
    this.pathGraphics.lineStyle(2, 0x3b3fff, 0.5);
    this.pathGraphics.beginPath();
    this.pathGraphics.moveTo(PATH_POINTS[0][0], PATH_POINTS[0][1]);
    for (let i = 1; i < PATH_POINTS.length; i++) {
      this.pathGraphics.lineTo(PATH_POINTS[i][0], PATH_POINTS[i][1]);
    }
    this.pathGraphics.strokePath();
    this.layerWorld.add(this.pathGraphics);
  }

  private drawCore() {
    const coreContainer = this.add.container(CORE_X, CORE_Y);
    const ring = this.add.circle(0, 0, 28, 0x1e293b, 1).setStrokeStyle(2, 0x60a5fa);
    const inner = this.add.circle(0, 0, 14, 0x60a5fa, 0.8);
    const label = this.add
      .text(0, 38, "CORE", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#94a3b8",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    coreContainer.add([ring, inner, label]);
    this.layerWorld.add(coreContainer);

    this.tweens.add({
      targets: inner,
      alpha: 0.4,
      yoyo: true,
      repeat: -1,
      duration: 900,
      ease: "Sine.easeInOut",
    });
  }

  private drawHud() {
    const hudBg = this.add
      .rectangle(8, 8, 240, 48, 0x0a0d1f, 0.85)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x1e293b);
    const hpLabel = this.add
      .text(20, 14, "CORE INTEGRITY", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "10px",
        color: "#64748b",
        fontStyle: "bold",
      })
      .setOrigin(0, 0);
    this.hpBarBg = this.add.rectangle(20, 32, 216, 14, 0x1e293b, 1).setOrigin(0, 0);
    this.hpBar = this.add.rectangle(20, 32, 216, 14, 0x4ade80, 1).setOrigin(0, 0);
    this.hpText = this.add
      .text(128, 39, "100 / 100", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "10px",
        color: "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(GAME_WIDTH - 12, 18, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#cbd5f5",
        align: "right",
      })
      .setOrigin(1, 0);

    this.layerUi.add([hudBg, hpLabel, this.hpBarBg, this.hpBar, this.hpText, this.statusText]);
    this.updateHud();
  }

  private updateHud() {
    const hp = Math.max(0, this.state.coreHp);
    const pct = Math.max(0, hp / 100);
    this.hpBar.width = 216 * pct;
    this.hpBar.fillColor = pct > 0.5 ? 0x4ade80 : pct > 0.2 ? 0xfacc15 : 0xef4444;
    this.hpText.setText(`${hp} / 100`);
    this.statusText.setText(
      `Q ${this.state.questionsAnswered + 1}/30   Towers: ${this.state.towers.length}`,
    );
  }

  // ----------------------- Tower visuals -----------------------

  private redrawTowers() {
    for (const v of this.towerVisuals) {
      v.container.destroy();
      v.hitZone.destroy();
    }
    this.towerVisuals = [];
    for (const t of this.state.towers) this.spawnTowerVisual(t);
  }

  private spawnTowerVisual(state: TowerState): TowerVisual {
    const def = TOWER_DEFS[state.type];
    const range = this.computeRange(state);
    const damage = this.computeDamage(state);

    const container = this.add.container(state.x, state.y);

    const rangeCircle = this.add
      .circle(0, 0, range, def.color, 0.08)
      .setStrokeStyle(1, def.color, 0.6)
      .setAlpha(0);

    let glow: Phaser.GameObjects.Arc | undefined;
    if (state.tier >= 2) {
      glow = this.add.circle(0, 0, state.tier === 3 ? 30 : 24, def.color, 0.18);
    }

    let starShape: Phaser.GameObjects.Polygon | undefined;
    if (state.tier === 3) {
      const pts: number[] = [];
      const spikes = 8;
      const outer = 26;
      const inner = 14;
      // Phaser.GameObjects.Polygon.updateData() pushes vertex coords raw
      // without subtracting bounds.x/bounds.y, so negative coords leave the
      // displayOrigin math off — the star ends up rendered to the upper-left
      // of the container origin by (outer, outer). Pre-translate every vertex
      // by (+outer, +outer) so all points land in [0, 2*outer] × [0, 2*outer]
      // and Phaser's bbox-center / displayOrigin alignment works out.
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        pts.push(Math.cos(a) * r + outer, Math.sin(a) * r + outer);
      }
      starShape = this.add.polygon(0, 0, pts, def.color, 0.35);
      starShape.setStrokeStyle(1, def.color, 0.7);
    }

    const baseColor = state.weak ? 0x64748b : def.color;
    const bodyAlpha = state.weak ? 0.45 : 1;
    const bodyRadius = state.tier === 1 ? 12 : state.tier === 2 ? 15 : 18;
    let body: Phaser.GameObjects.Shape;
    if (state.type === "aoe") {
      body = this.add.circle(0, 0, bodyRadius, baseColor, bodyAlpha);
    } else if (state.type === "sniper") {
      body = this.add.rectangle(0, 0, bodyRadius * 1.6, bodyRadius * 1.6, baseColor, bodyAlpha);
      body.setRotation(Math.PI / 4);
    } else {
      // Phaser.GameObjects.Triangle computes its size as Math.max(x1,x2,x3) ×
      // Math.max(y1,y2,y3) — it assumes vertex coords are in [0, W] × [0, H].
      // Negative coords break that math and skew the displayOrigin so the
      // shape renders well off-center from the container origin. Build the
      // triangle inside a positive 2r × 2r local box so the computed width
      // and height are correct and displayOrigin lands on the true bbox
      // center — that's what puts the visual center on the cursor.
      const d = 2 * bodyRadius;
      body = this.add.triangle(
        0,
        0,
        bodyRadius, // apex (top-center)
        0,
        d, // base right (bottom-right)
        d,
        0, // base left (bottom-left)
        d,
        baseColor,
        bodyAlpha,
      );
    }
    body.setStrokeStyle(2, state.weak ? 0x475569 : 0xffffff, 0.9);

    let innerRing: Phaser.GameObjects.Arc | undefined;
    if (state.tier >= 2) {
      innerRing = this.add
        .circle(0, 0, bodyRadius - 4, 0xffffff, 0)
        .setStrokeStyle(1.5, 0xffffff, 0.85);
    }

    const tierBadge = this.add
      .text(bodyRadius + 6, -bodyRadius - 4, `T${state.tier}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "10px",
        color: state.weak ? "#94a3b8" : "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5);

    const label = this.add
      .text(0, -bodyRadius - 16, `${def.short} · ${damage}${state.type === "triple" ? "×3" : ""}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "10px",
        color: state.weak ? "#94a3b8" : "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const parts: Phaser.GameObjects.GameObject[] = [rangeCircle];
    if (glow) parts.push(glow);
    if (starShape) parts.push(starShape);
    parts.push(body);
    if (innerRing) parts.push(innerRing);
    parts.push(tierBadge, label);
    container.add(parts);

    this.layerWorld.add(container);

    // Hover/click hit area: a Zone centered exactly on the tower's world position.
    // Using a Zone (instead of setInteractive on the container) sidesteps Phaser's
    // container-bounds quirk where Geom.Circle hit areas anchor to the size box's
    // top-left instead of the container's transform origin.
    const hitR = bodyRadius + 10;
    const hitZone = this.add.zone(state.x, state.y, hitR * 2, hitR * 2).setOrigin(0.5);
    hitZone.setInteractive({ useHandCursor: true });
    this.layerWorld.add(hitZone);

    hitZone.on("pointerover", () => {
      this.tweens.killTweensOf(rangeCircle);
      this.tweens.add({ targets: rangeCircle, alpha: 1, duration: 120 });
    });
    hitZone.on("pointerout", () => {
      this.tweens.killTweensOf(rangeCircle);
      this.tweens.add({ targets: rangeCircle, alpha: 0, duration: 180 });
    });
    hitZone.on("pointerdown", () => {
      if (this.phase === "upgradeSelect" && state.tier < 3) {
        this.commitUpgrade(state.id);
      }
    });

    const visual: TowerVisual = {
      state,
      container,
      rangeCircle,
      hitZone,
      label,
      nextFireAt: 0,
      glow,
      pulseTween: null,
    };
    this.towerVisuals.push(visual);
    return visual;
  }

  private computeDamage(s: TowerState): number {
    const base = TOWER_DEFS[s.type].damages[s.tier - 1];
    return Math.max(1, Math.round(base * (s.weak ? WEAK_FACTOR : 1)));
  }

  private computeRange(s: TowerState): number {
    return TOWER_DEFS[s.type].ranges[s.tier - 1];
  }

  private computeFireRate(s: TowerState): number {
    const base = TOWER_DEFS[s.type].fireRates[s.tier - 1];
    return s.weak ? base * 1.4 : base;
  }

  // ----------------------- Phase: answering -----------------------

  private startAnswering() {
    this.phase = "answering";
    this.clearPanel();

    const panel = this.add.container(0, 0);

    // Dim the play field a touch so the question stands out, but towers stay visible.
    const dim = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05060f, 0.45)
      .setOrigin(0.5);
    panel.add(dim);

    // Dynamic-height stem card. Build the text first, then size the box around it
    // with consistent padding so longer questions never crowd the "QUESTION" label.
    const stemBoxW = 720;
    const padTop = 12;
    const padBottom = 22;
    const labelGap = 14;
    const labelH = 14; // 12px font, comfortable line box

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
    // All four cards must stay the same size (per design), so we size every card
    // to the tallest wrapped option text. This is computed BEFORE we place the
    // stem card so the stem band can reclaim any unused vertical space.
    const cardW = 210;
    const optionFontPx = 14;
    const optionWrapW = cardW - 28;
    const optionPadTop = 30; // letter row + breathing room
    const optionPadBottom = 14;
    const minCardH = 120;
    const maxCardH = 200;
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
          lineSpacing: 3,
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
    const optionBottomMargin = 18;
    const optionY = GAME_HEIGHT - cardH / 2 - optionBottomMargin;
    const optionTopY = optionY - cardH / 2;

    // Available vertical space sits between the HUD (~56) and the option row top.
    const bandTop = 64;
    const bandBottom = optionTopY - 12;
    const maxBoxH = Math.max(minCardH, bandBottom - bandTop);
    const minBoxH = 96;
    const computedBoxH = padTop + labelH + labelGap + stemH + padBottom;
    const stemBoxH = Phaser.Math.Clamp(computedBoxH, minBoxH, maxBoxH);

    const boxTop = Phaser.Math.Clamp(
      (bandTop + bandBottom) / 2 - stemBoxH / 2,
      bandTop,
      bandBottom - stemBoxH,
    );
    const stemBoxY = boxTop + stemBoxH / 2;

    const stemBg = this.add
      .rectangle(GAME_WIDTH / 2, stemBoxY, stemBoxW, stemBoxH, 0x0a0d1f, 0.96)
      .setStrokeStyle(2, 0x3b3fff, 0.7);
    const stemLabel = this.add
      .text(GAME_WIDTH / 2, boxTop + padTop + labelH / 2, "QUESTION", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#7af0ff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    // Anchor stem at top-of-text just under the label + gap.
    stem.setPosition(GAME_WIDTH / 2, boxTop + padTop + labelH + labelGap);
    stem.setOrigin(0.5, 0);

    panel.add([stemBg, stemLabel, stem]);

    const gap = 14;
    const totalW = cardW * 4 + gap * 3;
    const startX = (GAME_WIDTH - totalW) / 2;

    this.question.options.forEach((opt, i) => {
      const x = startX + i * (cardW + gap) + cardW / 2;
      const card = this.makeOptionCard(x, optionY, cardW, cardH, opt, i);
      panel.add(card);
    });

    this.layerUi.add(panel);
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
    const devBadge = makeDevAnswerBadge(this, this.question, idx, w, h);
    if (devBadge) c.add(devBadge);

    // Use a Zone on top as the click target — guaranteed reliable hit area.
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
    let result: AnswerResult;
    try {
      result = await this.recordAnswer(idx);
    } catch {
      result = { correct: false, correct_index: -1, explanation: "Network error." };
    }
    this.answerResult = result;

    if (result.correct) {
      this.startChoosing();
    } else {
      // Permanent escalation: every wrong answer makes ALL future waves carry
      // more enemies and spill them out faster. Bump the counter BEFORE the
      // wave queue is built so the very next wave already feels the penalty.
      this.state.wrongAnswers += 1;
      this.saveState();
      const type = TOWER_TYPES[Phaser.Math.Between(0, 2)];
      this.startPlacement(type, true);
    }
  }

  // ----------------------- Phase: choosing -----------------------

  private startChoosing() {
    this.phase = "choosing";
    this.clearPanel();

    const panel = this.add.container(0, 0);

    const header = this.add
      .rectangle(GAME_WIDTH / 2, 34, GAME_WIDTH - 280, 50, 0x0a0d1f, 0.92)
      .setStrokeStyle(1, 0x4ade80, 0.6);
    const headerText = this.add
      .text(GAME_WIDTH / 2, 34, "CORRECT  ·  Choose your reward", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "17px",
        color: "#4ade80",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    panel.add([header, headerText]);

    const canUpgrade = this.state.towers.some((t) => t.tier < 3);
    const cards = canUpgrade ? 4 : 3;
    const cardW = canUpgrade ? 210 : 250;
    const cardH = 150;
    const gap = 14;
    const totalW = cardW * cards + gap * (cards - 1);
    const startX = (GAME_WIDTH - totalW) / 2;
    const y = GAME_HEIGHT - cardH / 2 - 18;

    TOWER_TYPES.forEach((type, i) => {
      const x = startX + i * (cardW + gap) + cardW / 2;
      panel.add(this.makeRewardCard(x, y, cardW, cardH, type));
    });

    if (canUpgrade) {
      const x = startX + 3 * (cardW + gap) + cardW / 2;
      panel.add(this.makeUpgradeCard(x, y, cardW, cardH));
    }

    this.layerUi.add(panel);
    this.panel = panel;
  }

  private makeRewardCard(
    x: number,
    y: number,
    w: number,
    h: number,
    type: TowerType,
  ): Phaser.GameObjects.Container {
    const def = TOWER_DEFS[type];
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, 0x0e1430, 0.97).setStrokeStyle(2, def.color);
    const title = this.add
      .text(0, -h / 2 + 18, def.name, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "17px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(0, -h / 2 + 38, def.short + " · Tier 1", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#94a3b8",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const desc = this.add
      .text(0, 4, def.description, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#cbd5f5",
        align: "center",
        wordWrap: { width: w - 22 },
        lineSpacing: 3,
      })
      .setOrigin(0.5);
    const stats = this.add
      .text(
        0,
        h / 2 - 18,
        `DMG ${def.damages[0]}${type === "triple" ? "×3" : ""}   RNG ${def.ranges[0]}   ${(1000 / def.fireRates[0]).toFixed(1)}/s`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "12px",
          color: "#fde68a",
          fontStyle: "bold",
        },
      )
      .setOrigin(0.5);
    c.add([bg, title, subtitle, desc, stats]);

    const hit = this.add.zone(0, 0, w, h).setOrigin(0.5);
    hit.setInteractive({ useHandCursor: true });
    c.add(hit);
    hit.on("pointerover", () => bg.setFillStyle(0x172040, 1));
    hit.on("pointerout", () => bg.setFillStyle(0x0e1430, 0.97));
    hit.on("pointerdown", () => this.startPlacement(type, false));
    return c;
  }

  private makeUpgradeCard(
    x: number,
    y: number,
    w: number,
    h: number,
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, 0x0e1430, 0.97).setStrokeStyle(2, 0xfacc15);
    const title = this.add
      .text(0, -h / 2 + 18, "Upgrade Tower", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "17px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(0, -h / 2 + 38, "Pick a tower to level up", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#fde68a",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const desc = this.add
      .text(
        0,
        4,
        "Boost an existing tower to the next tier. More damage, more range, faster fire.",
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          color: "#cbd5f5",
          align: "center",
          wordWrap: { width: w - 22 },
          lineSpacing: 3,
        },
      )
      .setOrigin(0.5);
    const upgradable = this.state.towers.filter((t) => t.tier < 3).length;
    const stats = this.add
      .text(0, h / 2 - 18, `${upgradable} tower(s) upgradable`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#fde68a",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    c.add([bg, title, subtitle, desc, stats]);

    const hit = this.add.zone(0, 0, w, h).setOrigin(0.5);
    hit.setInteractive({ useHandCursor: true });
    c.add(hit);
    hit.on("pointerover", () => bg.setFillStyle(0x172040, 1));
    hit.on("pointerout", () => bg.setFillStyle(0x0e1430, 0.97));
    hit.on("pointerdown", () => this.startUpgradeSelect());
    return c;
  }

  // ----------------------- Phase: upgrade select -----------------------

  private startUpgradeSelect() {
    if (this.state.towers.every((t) => t.tier >= 3)) {
      this.startChoosing();
      return;
    }
    this.phase = "upgradeSelect";
    this.clearPanel();

    const panel = this.add.container(0, 0);
    const banner = this.add
      .rectangle(GAME_WIDTH / 2, 34, GAME_WIDTH - 280, 50, 0x0a0d1f, 0.92)
      .setStrokeStyle(1, 0xfacc15, 0.7);
    const text = this.add
      .text(GAME_WIDTH / 2, 34, "Click a pulsing tower to upgrade  ·  (or hit Back)", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: "#fde68a",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    panel.add([banner, text]);

    const backBg = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 30, 220, 34, 0x1e293b, 1)
      .setStrokeStyle(1, 0x475569);
    const backText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 30, "← Back to reward picker", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#cbd5f5",
      })
      .setOrigin(0.5);
    const backHit = this.add.zone(GAME_WIDTH / 2, GAME_HEIGHT - 30, 220, 34).setOrigin(0.5);
    backHit.setInteractive({ useHandCursor: true });
    backHit.on("pointerdown", () => this.startChoosing());
    panel.add([backBg, backText, backHit]);

    this.layerUi.add(panel);
    this.panel = panel;

    // Pulse eligible towers (tier < 3) — click is handled by the existing pointerdown
    // wired in spawnTowerVisual, gated by this.phase.
    for (const v of this.towerVisuals) {
      if (v.state.tier >= 3) continue;
      v.pulseTween = this.tweens.add({
        targets: v.container,
        scale: { from: 1, to: 1.12 },
        yoyo: true,
        repeat: -1,
        duration: 600,
        ease: "Sine.easeInOut",
      });
      v.glow?.setAlpha(0.45);
    }
  }

  private commitUpgrade(towerId: number) {
    const tower = this.state.towers.find((t) => t.id === towerId);
    if (!tower || tower.tier >= 3) return;
    tower.tier = (tower.tier + 1) as 1 | 2 | 3;
    this.saveState();
    this.redrawTowers();
    this.startWave();
  }

  // ----------------------- Phase: placement -----------------------

  private startPlacement(type: TowerType, weak: boolean) {
    this.phase = "placing";
    this.placementType = type;
    this.placementWeak = weak;
    this.clearPanel();

    const panel = this.add.container(0, 0);
    const def = TOWER_DEFS[type];
    const headColor = weak ? 0x94a3b8 : def.color;
    const banner = this.add
      .rectangle(GAME_WIDTH / 2, 34, GAME_WIDTH - 280, 50, 0x0a0d1f, 0.92)
      .setStrokeStyle(1, headColor, 0.7);
    const escalation =
      this.state.wrongAnswers > 0
        ? `  ·  +${this.state.wrongAnswers * WRONG_EXTRA_ENEMIES_PER} enemies every wave (from ${this.state.wrongAnswers} wrong)`
        : "";
    const title = weak
      ? `WRONG ANSWER  ·  Place a weak ${def.name}${escalation}`
      : `Place your ${def.name} (Tier 1)`;
    const text = this.add
      .text(GAME_WIDTH / 2, 34, title, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: weak ? "#cbd5f5" : "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    panel.add([banner, text]);

    const hint = this.add
      .text(
        GAME_WIDTH / 2,
        GAME_HEIGHT - 24,
        "Click anywhere off the path to build  ·  ring shows range",
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          color: "#94a3b8",
        },
      )
      .setOrigin(0.5);
    panel.add(hint);

    this.layerUi.add(panel);
    this.panel = panel;

    const previewState: TowerState = {
      id: -1,
      x: 0,
      y: 0,
      type,
      tier: 1,
      weak,
    };
    const preview = this.makePlacementPreview(previewState);
    preview.setVisible(false);
    this.placementPreview = preview;
    this.layerEffects.add(preview);

    // Arm the placement click after a short delay so the same pointer event that
    // selected the reward card can't also place the tower under the cursor.
    this.placementArmedAt = this.time.now + 180;
    this.input.on("pointerdown", this.onPlacementClick, this);
  }

  private makePlacementPreview(state: TowerState): Phaser.GameObjects.Container {
    const def = TOWER_DEFS[state.type];
    const c = this.add.container(0, 0);
    const range = this.add
      .circle(0, 0, this.computeRange(state), def.color, 0.08)
      .setStrokeStyle(2, def.color, 0.5);

    // Match the actual placed tower's tier-1 shape so the preview can't drift
    // from the final body. Triangle gets the same centroid correction as the
    // real Triburst in spawnTowerVisual.
    const r = 12;
    const bodyAlpha = state.weak ? 0.45 : 0.85;
    let body: Phaser.GameObjects.Shape;
    if (state.type === "aoe") {
      body = this.add.circle(0, 0, r, def.color, bodyAlpha);
    } else if (state.type === "sniper") {
      body = this.add.rectangle(0, 0, r * 1.6, r * 1.6, def.color, bodyAlpha);
      body.setRotation(Math.PI / 4);
    } else {
      // See spawnTowerVisual for why this uses positive-coord vertices.
      const d = 2 * r;
      body = this.add.triangle(0, 0, r, 0, d, d, 0, d, def.color, bodyAlpha);
    }
    body.setStrokeStyle(2, 0xffffff, 0.8);

    const label = this.add
      .text(0, -26, `${def.short} T1${state.weak ? " (weak)" : ""}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "10px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    c.add([range, body, label]);
    c.setData("range", range);
    c.setData("body", body);
    c.setData("label", label);
    return c;
  }

  private updatePlacementPreview() {
    if (!this.placementPreview) return;
    const p = this.input.activePointer;
    const x = p.worldX;
    const y = p.worldY;
    this.placementPreview.setVisible(true);
    this.placementPreview.x = x;
    this.placementPreview.y = y;
    const valid = this.isValidPlacement(x, y);
    const range = this.placementPreview.getData("range") as Phaser.GameObjects.Arc;
    const body = this.placementPreview.getData("body") as Phaser.GameObjects.Shape;
    if (valid) {
      range.setStrokeStyle(2, TOWER_DEFS[this.placementType].color, 0.6);
      body.setStrokeStyle(2, 0xffffff, 1);
    } else {
      range.setStrokeStyle(2, 0xef4444, 0.7);
      body.setStrokeStyle(2, 0xef4444, 1);
    }
  }

  private onPlacementClick = (pointer: Phaser.Input.Pointer) => {
    if (this.phase !== "placing") return;
    // Swallow stray clicks from the same pointer cycle that initiated placement.
    if (this.time.now < this.placementArmedAt) return;
    const x = Math.round(pointer.worldX);
    const y = Math.round(pointer.worldY);
    if (!this.isValidPlacement(x, y)) {
      this.cameras.main.shake(80, 0.003);
      return;
    }
    this.input.off("pointerdown", this.onPlacementClick, this);
    this.placementPreview?.destroy();
    this.placementPreview = null;

    const newTower: TowerState = {
      id: this.state.nextTowerId++,
      x,
      y,
      type: this.placementType,
      tier: 1,
      weak: this.placementWeak,
    };
    this.state.towers.push(newTower);
    this.saveState();
    this.spawnTowerVisual(newTower);
    this.updateHud();
    this.startWave();
  };

  private isValidPlacement(x: number, y: number): boolean {
    if (x < PLACEMENT_BOUNDS.minX || x > PLACEMENT_BOUNDS.maxX) return false;
    if (y < PLACEMENT_BOUNDS.minY || y > PLACEMENT_BOUNDS.maxY) return false;
    for (const [a, b] of this.pathSegments) {
      const d = distancePointToSegment(x, y, a.x, a.y, b.x, b.y);
      if (d < PATH_BUFFER) return false;
    }
    for (const t of this.state.towers) {
      if (Math.hypot(t.x - x, t.y - y) < TOWER_MIN_SPACING) return false;
    }
    if (Math.hypot(CORE_X - x, CORE_Y - y) < 50) return false;
    return true;
  }

  // ----------------------- Phase: wave -----------------------

  private startWave() {
    this.phase = "wave";
    this.clearPanel();

    const qIndex = this.state.questionsAnswered;
    this.waveQueue = buildWaveQueue(qIndex, this.state.wrongAnswers);
    this.nextSpawnAt = this.time.now + 250;
    this.creeps = [];
    this.waveStartCoreHp = this.state.coreHp;
    this.waveCreepsLeaked = 0;
    this.waveEnding = false;

    for (const v of this.towerVisuals) {
      v.nextFireAt = this.time.now + 200;
    }

    const counts = { scout: 0, brute: 0, stalker: 0, bat: 0 };
    for (const t of this.waveQueue) counts[t]++;
    const escalationSuffix =
      this.state.wrongAnswers > 0
        ? `  ·  +${this.state.wrongAnswers * WRONG_EXTRA_ENEMIES_PER} from wrong answers`
        : "";
    const summary = `Wave ${qIndex + 1}  ·  ${this.waveQueue.length} hostiles  ·  ` +
      [
        counts.scout ? `${counts.scout} scout` : "",
        counts.brute ? `${counts.brute} brute` : "",
        counts.stalker ? `${counts.stalker} stalker` : "",
        counts.bat ? `${counts.bat} bat` : "",
      ].filter(Boolean).join(" · ") + escalationSuffix;
    const banner = this.add
      .text(GAME_WIDTH / 2, 34, summary, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#fca5a5",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const wrap = this.add.container(0, 0, [banner]);
    this.layerUi.add(wrap);
    this.panel = wrap;
  }

  private tickWave(time: number, delta: number) {
    const scaling = waveScaling(this.state.questionsAnswered, this.state.wrongAnswers);

    if (this.waveQueue.length > 0 && time >= this.nextSpawnAt) {
      const type = this.waveQueue.shift()!;
      this.spawnCreep(type, scaling);
      this.nextSpawnAt = time + scaling.spawnInterval;
    }

    const dtSec = delta / 1000;
    for (const c of this.creeps) {
      if (!c.alive) continue;
      const def = CREEP_DEFS[c.type];
      // Lunge logic (stalker)
      if (def.lunge) {
        if (time >= c.lungeEndsAt && c.currentSpeed !== c.baseSpeed) {
          c.currentSpeed = c.baseSpeed;
        }
        if (time >= c.nextLungeAt) {
          c.currentSpeed = c.baseSpeed * def.lunge.mult;
          c.lungeEndsAt = time + def.lunge.duration;
          c.nextLungeAt = time + def.lunge.every;
          // brief yellow tint
          c.body.setTint(0xfde68a);
          this.time.delayedCall(140, () => {
            if (c.alive) c.body.clearTint();
          });
        }
      }
      // Heal pulse (bat)
      if (def.heal && time >= c.nextHealAt) {
        const heal = def.heal;
        for (const other of this.creeps) {
          if (!other.alive || other.hp >= other.maxHp) continue;
          const d = Math.hypot(other.sprite.x - c.sprite.x, other.sprite.y - c.sprite.y);
          if (d <= heal.radius) {
            other.hp = Math.min(other.maxHp, other.hp + heal.amount);
          }
        }
        this.healPulse(c.sprite.x, c.sprite.y, heal.radius);
        c.nextHealAt = time + heal.every;
      }
      c.progress += c.currentSpeed * dtSec;
      if (c.progress >= 1) {
        c.alive = false;
        c.sprite.destroy();
        this.state.coreHp -= def.damageOnLeak;
        this.waveCreepsLeaked += 1;
        this.cameras.main.shake(120, 0.005);
        this.updateHud();
        if (this.state.coreHp <= 0) {
          this.state.coreHp = 0;
          this.saveState();
          this.startGameOver();
          return;
        }
        continue;
      }
      const pt = this.path.getPoint(c.progress);
      if (pt) {
        c.sprite.x = pt.x;
        c.sprite.y = pt.y;
      }
      const ratio = Math.max(0, c.hp / c.maxHp);
      const barW = def.radius * 2 + 4;
      c.hpBar.width = barW * ratio;
      c.hpBar.x = -barW / 2;
    }

    for (const v of this.towerVisuals) {
      if (time < v.nextFireAt) continue;
      const fired = this.fireTower(v);
      if (fired) v.nextFireAt = time + this.computeFireRate(v.state);
    }

    this.creeps = this.creeps.filter((c) => c.alive);

    const aliveOrToSpawn = this.creeps.length + this.waveQueue.length;
    if (aliveOrToSpawn === 0 && !this.waveEnding) {
      // Let lingering FX (explosions, shots) finish before transitioning.
      this.waveEnding = true;
      this.time.delayedCall(1000, () => this.endWave());
    }
  }

  private spawnCreep(type: CreepType, scaling: { hpMult: number; speedMult: number }) {
    const def = CREEP_DEFS[type];
    const c = this.add.container(PATH_POINTS[0][0], PATH_POINTS[0][1]);
    const body = this.add.sprite(0, 0, `td_${def.spriteKey}`, 0).setScale(def.scale);
    body.play(`td_${def.spriteKey}_walk`);
    const barW = def.radius * 2 + 4;
    const barY = -def.radius - 8;
    const hpBarBg = this.add.rectangle(0, barY, barW, 3, 0x1e293b, 1).setOrigin(0.5);
    const hpBar = this.add.rectangle(-barW / 2, barY, barW, 3, 0x4ade80, 1).setOrigin(0, 0.5);
    c.add([body, hpBarBg, hpBar]);
    this.layerWorld.add(c);

    const hp = Math.round(def.baseHp * scaling.hpMult);
    const speed = def.baseSpeed * scaling.speedMult;

    this.creeps.push({
      type,
      sprite: c,
      body,
      hpBar,
      hpBarBg,
      hp,
      maxHp: hp,
      progress: 0,
      baseSpeed: speed,
      currentSpeed: speed,
      nextLungeAt: this.time.now + (def.lunge ? def.lunge.every : 0),
      lungeEndsAt: 0,
      nextHealAt: this.time.now + (def.heal ? def.heal.every : 0),
      alive: true,
    });
  }

  private fireTower(v: TowerVisual): boolean {
    const inRange = this.creepsInRange(v);
    if (inRange.length === 0) return false;

    const dmg = this.computeDamage(v.state);
    const color = v.state.weak ? 0x94a3b8 : TOWER_DEFS[v.state.type].color;

    if (v.state.type === "aoe") {
      this.pulseRing(v.container.x, v.container.y, this.computeRange(v.state), color);
      for (const c of inRange) this.damageCreep(c, dmg);
      return true;
    }

    if (v.state.type === "sniper") {
      inRange.sort((a, b) => b.progress - a.progress);
      const target = inRange[0];
      this.beamShot(v.container.x, v.container.y, target.sprite.x, target.sprite.y, color);
      this.damageCreep(target, dmg);
      return true;
    }

    inRange.sort((a, b) => b.progress - a.progress);
    const t = inRange[0];
    const angle = Phaser.Math.Angle.Between(v.container.x, v.container.y, t.sprite.x, t.sprite.y);
    const spread = 0.18;
    for (const off of [-spread, 0, spread]) {
      const a = angle + off;
      const tx = v.container.x + Math.cos(a) * 60;
      const ty = v.container.y + Math.sin(a) * 60;
      this.smallShot(v.container.x, v.container.y, tx, ty, color);
    }
    for (let i = 0; i < 3; i++) this.damageCreep(t, dmg);
    return true;
  }

  private creepsInRange(v: TowerVisual): Creep[] {
    const range = this.computeRange(v.state);
    const result: Creep[] = [];
    for (const c of this.creeps) {
      if (!c.alive) continue;
      const d = Math.hypot(c.sprite.x - v.container.x, c.sprite.y - v.container.y);
      if (d <= range) result.push(c);
    }
    return result;
  }

  private damageCreep(c: Creep, dmg: number) {
    c.hp -= dmg;
    // White flash via tintFill so the sprite reads as "hit" regardless of base color.
    c.body.setTintFill(0xffffff);
    this.time.delayedCall(70, () => {
      if (c.alive) c.body.clearTint();
    });
    if (c.hp <= 0) {
      c.alive = false;
      this.fxBurst(c.sprite.x, c.sprite.y);
      c.sprite.destroy();
    }
  }

  private pulseRing(x: number, y: number, radius: number, color: number) {
    const ring = this.add.circle(x, y, 6, color, 0).setStrokeStyle(3, color, 1);
    this.layerEffects.add(ring);
    this.tweens.add({
      targets: ring,
      radius,
      alpha: 0,
      duration: 280,
      ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  private beamShot(x1: number, y1: number, x2: number, y2: number, color: number) {
    const line = this.add.line(0, 0, x1, y1, x2, y2, color, 1).setOrigin(0, 0).setLineWidth(2);
    this.layerEffects.add(line);
    this.tweens.add({
      targets: line,
      alpha: 0,
      duration: 200,
      onComplete: () => line.destroy(),
    });
  }

  private smallShot(x1: number, y1: number, x2: number, y2: number, color: number) {
    const proj = this.add.circle(x1, y1, 3, color, 1);
    this.layerEffects.add(proj);
    this.tweens.add({
      targets: proj,
      x: x2,
      y: y2,
      alpha: 0,
      duration: 180,
      onComplete: () => proj.destroy(),
    });
  }

  private healPulse(x: number, y: number, radius: number) {
    // Expanding green ring + a brief plus glyph on the heal source.
    const ring = this.add.circle(x, y, 6, 0x86efac, 0).setStrokeStyle(2, 0x86efac, 0.9);
    this.layerEffects.add(ring);
    this.tweens.add({
      targets: ring,
      radius,
      alpha: 0,
      duration: 540,
      ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });
    const glyph = this.add
      .text(x, y - 18, "+", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#86efac",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.layerEffects.add(glyph);
    this.tweens.add({
      targets: glyph,
      y: y - 34,
      alpha: 0,
      duration: 480,
      onComplete: () => glyph.destroy(),
    });
  }

  private fxBurst(x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const p = this.add.circle(x, y, 2, 0xfde68a, 1);
      this.layerEffects.add(p);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(a) * 18,
        y: y + Math.sin(a) * 18,
        alpha: 0,
        duration: 280,
        onComplete: () => p.destroy(),
      });
    }
  }

  private endWave() {
    this.state.questionsAnswered += 1;
    this.saveState();
    this.startFeedback();
  }

  // ----------------------- Phase: feedback -----------------------

  private startFeedback() {
    this.phase = "feedback";
    this.clearPanel();

    const result = this.answerResult ?? { correct: false, correct_index: -1, explanation: "" };
    const hpLost = Math.max(0, this.waveStartCoreHp - this.state.coreHp);
    const held = this.waveCreepsLeaked === 0;
    const title = held ? "DEFENSE HELD" : `BREACH · ${this.waveCreepsLeaked} got through`;
    const titleColor = held ? "#4ade80" : "#ef4444";

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    const accent = held ? 0x4ade80 : 0xef4444;

    // Build each text element first so we can read its measured .height,
    // then size the bg and place rows so nothing overlaps.
    const titleText = this.add
      .text(0, 0, title, {
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
        color: result.correct ? "#86efac" : "#fca5a5",
        fontStyle: "bold",
        align: "center",
        wordWrap: { width: 640 },
        lineSpacing: 3,
      })
      .setOrigin(0.5);

    const escalationLine = !result.correct
      ? `⚠ Permanent: every future wave now spawns +${WRONG_EXTRA_ENEMIES_PER} more enemies (total +${this.state.wrongAnswers * WRONG_EXTRA_ENEMIES_PER} from ${this.state.wrongAnswers} wrong).`
      : null;
    const escalationText = escalationLine
      ? this.add
          .text(0, 0, escalationLine, {
            fontFamily: "system-ui, sans-serif",
            fontSize: "13px",
            color: "#fbbf24",
            align: "center",
            wordWrap: { width: 620 },
            lineSpacing: 3,
          })
          .setOrigin(0.5)
      : null;

    const explanation = this.add
      .text(0, 0, result.explanation || "—", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#cbd5f5",
        align: "center",
        wordWrap: { width: 620 },
        lineSpacing: 4,
      })
      .setOrigin(0.5);

    const stats = this.add
      .text(
        0,
        0,
        `Core HP: ${Math.max(0, this.state.coreHp)} / 100   (-${hpLost})    Towers: ${this.state.towers.length}`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          color: "#94a3b8",
        },
      )
      .setOrigin(0.5);

    const hint = this.add
      .text(0, 0, "(or press SPACE)", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#64748b",
      })
      .setOrigin(0.5);

    const padTop = 22;
    const padBottom = 18;
    const gapTitleAns = 16;
    const gapAnsEsc = 12;
    const gapAnsExp = 16;
    const gapExpStats = 22;
    const gapStatsBtn = 18;
    const gapBtnHint = 8;
    const btnH = 44;
    const panelW = 680;
    const minPanelH = 260;
    const maxPanelH = GAME_HEIGHT - 60;

    const escalationBlockH = escalationText
      ? gapAnsEsc + escalationText.height
      : 0;
    const contentH =
      padTop +
      titleText.height +
      gapTitleAns +
      ansText.height +
      escalationBlockH +
      gapAnsExp +
      explanation.height +
      gapExpStats +
      stats.height +
      gapStatsBtn +
      btnH +
      gapBtnHint +
      hint.height +
      padBottom;
    const panelH = Phaser.Math.Clamp(contentH, minPanelH, maxPanelH);

    const bg = this.add
      .rectangle(0, 0, panelW, panelH, 0x0a0d1f, 0.97)
      .setStrokeStyle(2, accent);

    let y = -panelH / 2 + padTop;
    titleText.setY(y + titleText.height / 2);
    y += titleText.height + gapTitleAns;
    ansText.setY(y + ansText.height / 2);
    y += ansText.height;
    if (escalationText) {
      y += gapAnsEsc;
      escalationText.setY(y + escalationText.height / 2);
      y += escalationText.height;
    }
    y += gapAnsExp;
    explanation.setY(y + explanation.height / 2);
    y += explanation.height + gapExpStats;
    stats.setY(y + stats.height / 2);
    y += stats.height + gapStatsBtn;
    const btnY = y + btnH / 2;
    y += btnH + gapBtnHint;
    hint.setY(y + hint.height / 2);

    const btnBg = this.add
      .rectangle(0, btnY, 220, btnH, 0x3b3fff, 1)
      .setStrokeStyle(1, 0x7af0ff);
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
    btnHit.on("pointerdown", () => this.onComplete());

    const panelChildren: Phaser.GameObjects.GameObject[] = [bg, titleText, ansText];
    if (escalationText) panelChildren.push(escalationText);
    panelChildren.push(explanation, stats, btnBg, btnText, btnHit, hint);
    panel.add(panelChildren);
    this.layerUi.add(panel);
    this.panel = panel;

    this.input.keyboard?.once("keydown-SPACE", () => this.onComplete());
  }

  // ----------------------- Phase: game over -----------------------

  private startGameOver() {
    this.phase = "gameOver";
    // Sweep remaining creeps and queue
    for (const c of this.creeps) c.sprite.destroy();
    this.creeps = [];
    this.waveQueue = [];
    this.clearPanel();

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    const bg = this.add
      .rectangle(0, 0, 560, 240, 0x0a0d1f, 0.98)
      .setStrokeStyle(2, 0xef4444);
    const titleText = this.add
      .text(0, -82, "CORE DESTROYED", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "26px",
        color: "#ef4444",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(
        0,
        -42,
        `The defense fell on wave ${this.state.questionsAnswered + 1}. Run ends here.`,
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
        `Questions answered: ${this.state.questionsAnswered}   ·   Towers built: ${this.state.towers.length}`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "11px",
          color: "#94a3b8",
        },
      )
      .setOrigin(0.5);

    const btnBg = this.add
      .rectangle(0, 70, 220, 40, 0xef4444, 1)
      .setStrokeStyle(1, 0xfecaca);
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

    panel.add([bg, titleText, subtitle, stats, btnBg, btnText, btnHit]);
    this.layerUi.add(panel);
    this.panel = panel;

    this.input.keyboard?.once("keydown-SPACE", () => {
      this.registry.remove(REGISTRY_KEY);
      this.abortRun();
    });
  }

  // ----------------------- Utility -----------------------

  private clearPanel() {
    if (this.panel) {
      this.panel.destroy();
      this.panel = null;
    }
    // Stop any upgrade-select pulse tweens but KEEP tower hover handlers intact.
    for (const v of this.towerVisuals) {
      if (v.pulseTween) {
        v.pulseTween.stop();
        v.pulseTween = null;
      }
      v.container.setScale(1);
    }
  }
}

// ----------------------- Geometry helpers -----------------------

function distancePointToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

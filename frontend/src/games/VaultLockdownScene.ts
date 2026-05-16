import Phaser from "phaser";

import type { AnswerResult, Question } from "../types";
import { GAME_HEIGHT, GAME_WIDTH, type SceneData } from "./sceneContract";

// ----------------------- Board geometry -----------------------

const VAULT_X = GAME_WIDTH / 2;
const VAULT_Y = 380;
const VAULT_RADIUS = 46;

const PATH_COUNT = 6;
const RING_COUNT = 3;
// Ring 0 = outermost spawn position, ring 2 = innermost guard ring.
// Position 3 (one step past ring 2) means the attacker has touched the vault.
const RING_RADII = [260, 180, 100];
const PATH_ANGLES_DEG = [-90, -30, 30, 90, 150, 210];
const PATH_NAMES = [
  "Phishing",
  "Malware",
  "DDoS",
  "Insider",
  "Supply Chain",
  "Zero-Day",
];
const PATH_COLORS = [
  0xf472b6, // pink
  0xf97316, // orange
  0xfacc15, // yellow
  0x4ade80, // green
  0x60a5fa, // blue
  0xa78bfa, // violet
];

const MAX_LOCKS_PER_PATH = 3;

// ----------------------- Types -----------------------

interface PathState {
  position: number; // 0..3, 3 = breach
  locks: number;
}

interface PersistentState {
  questionsAnswered: number;
  paths: PathState[];
}

const REGISTRY_KEY = "vault_state_v1";

interface PathVisual {
  index: number;
  angleRad: number;
  color: number;
  laneGfx: Phaser.GameObjects.Graphics;
  ringNodes: Phaser.GameObjects.Arc[];
  attackerSprite: Phaser.GameObjects.Container;
  attackerCore: Phaser.GameObjects.Arc;
  lockIcons: Phaser.GameObjects.Container[];
  hitZone: Phaser.GameObjects.Zone;
  hoverGlow: Phaser.GameObjects.Graphics;
  nameLabel: Phaser.GameObjects.Text;
}

type Phase = "answering" | "placing" | "attacking" | "feedback" | "gameOver";

// ----------------------- Scene -----------------------

export class VaultLockdownScene extends Phaser.Scene {
  private state!: PersistentState;

  private question!: Question;
  private recordAnswer!: (idx: number) => Promise<AnswerResult>;
  private onComplete!: () => void;
  private abortRun!: () => void;
  private answerResult: AnswerResult | null = null;
  private phase: Phase = "answering";

  private paths: PathVisual[] = [];
  private layerWorld!: Phaser.GameObjects.Container;
  private layerEffects!: Phaser.GameObjects.Container;
  private layerUi!: Phaser.GameObjects.Container;

  private vaultCore!: Phaser.GameObjects.Arc;
  private vaultRing!: Phaser.GameObjects.Arc;

  private hudStatus!: Phaser.GameObjects.Text;
  private hudThreat!: Phaser.GameObjects.Text;

  private panel: Phaser.GameObjects.Container | null = null;

  private attackQueue: number[] = []; // advances to resolve, by path index (-1 = pick random)
  private attackInProgress = false;
  private pendingAdvances = 0;
  private threatLog: string[] = [];

  constructor() {
    super({ key: "VaultLockdownScene" });
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
    this.paths = [];
    this.panel = null;
    this.attackQueue = [];
    this.attackInProgress = false;
    this.pendingAdvances = 0;
    this.threatLog = [];
  }

  create() {
    if (!this.question) return;
    this.cameras.main.setBackgroundColor("#05070f");
    this.loadOrInitState();

    this.layerWorld = this.add.container(0, 0);
    this.layerEffects = this.add.container(0, 0);
    this.layerUi = this.add.container(0, 0);

    this.drawBackdrop();
    this.drawVault();
    this.drawPaths();
    this.drawHud();
    this.refreshBoard();

    this.startAnswering();
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
      paths: Array.from({ length: PATH_COUNT }, () => ({ position: 0, locks: 0 })),
    };
    this.registry.set(REGISTRY_KEY, this.state);
  }

  private saveState() {
    this.registry.set(REGISTRY_KEY, this.state);
  }

  // ----------------------- Drawing -----------------------

  private drawBackdrop() {
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x12182c, 0.55);
    for (let x = 0; x < GAME_WIDTH; x += 40) grid.lineBetween(x, 0, x, GAME_HEIGHT);
    for (let y = 0; y < GAME_HEIGHT; y += 40) grid.lineBetween(0, y, GAME_WIDTH, y);
    this.layerWorld.add(grid);

    // Concentric rings to ground the radial layout.
    const rings = this.add.graphics();
    for (let r = 0; r < RING_COUNT; r++) {
      const radius = RING_RADII[r];
      const alpha = 0.18 + r * 0.06;
      rings.lineStyle(1, 0x334155, alpha);
      rings.strokeCircle(VAULT_X, VAULT_Y, radius);
    }
    this.layerWorld.add(rings);
  }

  private drawVault() {
    const outerRing = this.add
      .circle(VAULT_X, VAULT_Y, VAULT_RADIUS + 10, 0x0e1430, 1)
      .setStrokeStyle(2, 0x7af0ff, 0.7);
    this.vaultRing = this.add
      .circle(VAULT_X, VAULT_Y, VAULT_RADIUS, 0x152043, 1)
      .setStrokeStyle(2, 0x60a5fa, 0.9);
    this.vaultCore = this.add.circle(VAULT_X, VAULT_Y, VAULT_RADIUS - 18, 0x60a5fa, 0.85);
    const label = this.add
      .text(VAULT_X, VAULT_Y, "VAULT", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.layerWorld.add([outerRing, this.vaultRing, this.vaultCore, label]);

    this.tweens.add({
      targets: this.vaultCore,
      alpha: 0.5,
      yoyo: true,
      repeat: -1,
      duration: 1100,
      ease: "Sine.easeInOut",
    });
  }

  private drawPaths() {
    for (let i = 0; i < PATH_COUNT; i++) {
      const angleRad = Phaser.Math.DegToRad(PATH_ANGLES_DEG[i]);
      const color = PATH_COLORS[i];

      const laneGfx = this.add.graphics();
      this.layerWorld.add(laneGfx);

      const hoverGlow = this.add.graphics();
      this.layerEffects.add(hoverGlow);

      const ringNodes: Phaser.GameObjects.Arc[] = [];
      for (let r = 0; r < RING_COUNT; r++) {
        const radius = RING_RADII[r];
        const nx = VAULT_X + Math.cos(angleRad) * radius;
        const ny = VAULT_Y + Math.sin(angleRad) * radius;
        const node = this.add
          .circle(nx, ny, 12, 0x1e293b, 1)
          .setStrokeStyle(2, color, 0.65);
        ringNodes.push(node);
        this.layerWorld.add(node);
      }

      // Attacker token starts at outermost (position 0 in state = ring 0).
      const startRadius = RING_RADII[0] + 28;
      const ax = VAULT_X + Math.cos(angleRad) * startRadius;
      const ay = VAULT_Y + Math.sin(angleRad) * startRadius;
      const attackerSprite = this.add.container(ax, ay);
      const attackerCore = this.add
        .circle(0, 0, 11, color, 1)
        .setStrokeStyle(2, 0xffffff, 0.85);
      const attackerInner = this.add.circle(0, 0, 5, 0xffffff, 0.85);
      attackerSprite.add([attackerCore, attackerInner]);
      this.layerWorld.add(attackerSprite);

      this.tweens.add({
        targets: attackerInner,
        alpha: 0.4,
        yoyo: true,
        repeat: -1,
        duration: 700,
        ease: "Sine.easeInOut",
      });

      // Outer label sits past the outermost ring, along the path angle.
      const labelRadius = RING_RADII[0] + 70;
      const lx = VAULT_X + Math.cos(angleRad) * labelRadius;
      const ly = VAULT_Y + Math.sin(angleRad) * labelRadius;
      const nameLabel = this.add
        .text(lx, ly, PATH_NAMES[i], {
          fontFamily: "system-ui, sans-serif",
          fontSize: "12px",
          color: "#cbd5f5",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      this.layerWorld.add(nameLabel);

      // Interactive zone covering the whole corridor from outermost node + buffer
      // toward the vault. Use a Zone so click works regardless of node positions.
      const hitLen = RING_RADII[0] + 60;
      const midRadius = hitLen / 2;
      const hx = VAULT_X + Math.cos(angleRad) * midRadius;
      const hy = VAULT_Y + Math.sin(angleRad) * midRadius;
      const hitZone = this.add.zone(hx, hy, hitLen, 80).setOrigin(0.5);
      hitZone.rotation = angleRad;
      hitZone.setInteractive({ useHandCursor: false });
      this.layerWorld.add(hitZone);

      hitZone.on("pointerover", () => {
        if (this.phase !== "placing") return;
        this.drawHoverGlow(hoverGlow, angleRad, color, 0.35);
      });
      hitZone.on("pointerout", () => {
        hoverGlow.clear();
      });
      hitZone.on("pointerdown", () => {
        if (this.phase !== "placing") return;
        this.commitLockPlacement(i);
      });

      this.paths.push({
        index: i,
        angleRad,
        color,
        laneGfx,
        ringNodes,
        attackerSprite,
        attackerCore,
        lockIcons: [],
        hitZone,
        hoverGlow,
        nameLabel,
      });
    }
  }

  private drawHoverGlow(g: Phaser.GameObjects.Graphics, angleRad: number, color: number, alpha: number) {
    g.clear();
    g.lineStyle(36, color, alpha);
    const outer = RING_RADII[0] + 32;
    const x1 = VAULT_X + Math.cos(angleRad) * (VAULT_RADIUS + 6);
    const y1 = VAULT_Y + Math.sin(angleRad) * (VAULT_RADIUS + 6);
    const x2 = VAULT_X + Math.cos(angleRad) * outer;
    const y2 = VAULT_Y + Math.sin(angleRad) * outer;
    g.lineBetween(x1, y1, x2, y2);
  }

  private drawHud() {
    const hudBg = this.add
      .rectangle(8, 8, 320, 48, 0x0a0d1f, 0.85)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x1e293b);
    const label = this.add
      .text(20, 14, "VAULT LOCKDOWN", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "10px",
        color: "#7af0ff",
        fontStyle: "bold",
      })
      .setOrigin(0, 0);
    this.hudStatus = this.add
      .text(20, 30, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#e2e8f0",
      })
      .setOrigin(0, 0);

    this.hudThreat = this.add
      .text(GAME_WIDTH - 12, 14, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#cbd5f5",
        align: "right",
      })
      .setOrigin(1, 0);

    this.layerUi.add([hudBg, label, this.hudStatus, this.hudThreat]);
    this.updateHud();
  }

  private updateHud() {
    const q = this.state.questionsAnswered + 1;
    const totalLocks = this.state.paths.reduce((s, p) => s + p.locks, 0);
    const worst = this.state.paths.reduce((m, p) => Math.max(m, p.position), 0);
    const closestSteps = Math.max(0, RING_COUNT - worst);
    this.hudStatus.setText(`Q ${q}/30   Locks: ${totalLocks}   Closest threat: ${closestSteps} step${closestSteps === 1 ? "" : "s"}`);
    const tail = this.threatLog.slice(-3).join("   ");
    this.hudThreat.setText(tail);
  }

  // ----------------------- Refresh path visuals from state -----------------------

  private refreshBoard() {
    for (const p of this.paths) {
      const s = this.state.paths[p.index];
      // Ring node colors: filled with color where attacker has reached.
      for (let r = 0; r < RING_COUNT; r++) {
        const reached = s.position > r;
        const node = p.ringNodes[r];
        if (reached) {
          node.setFillStyle(p.color, 0.8);
          node.setStrokeStyle(2, 0xffffff, 0.85);
        } else {
          node.setFillStyle(0x1e293b, 1);
          node.setStrokeStyle(2, p.color, 0.65);
        }
      }

      // Attacker token position.
      const radius = s.position < RING_COUNT
        ? RING_RADII[0] + 28 - s.position * 60
        : VAULT_RADIUS + 4;
      const targetX = VAULT_X + Math.cos(p.angleRad) * radius;
      const targetY = VAULT_Y + Math.sin(p.angleRad) * radius;
      p.attackerSprite.x = targetX;
      p.attackerSprite.y = targetY;

      // Lock icons: redraw to match s.locks. Place locks between the vault and
      // the attacker's current position so they read as "blockers in the way".
      for (const ic of p.lockIcons) ic.destroy();
      p.lockIcons = [];
      for (let k = 0; k < s.locks; k++) {
        // Stack locks at ring index (RING_COUNT - 1 - k) but clamp to >= s.position
        // so a lock visibly sits inward of where the attacker currently is.
        const ringIdx = Math.max(s.position, RING_COUNT - 1 - k);
        const lockRadius = RING_RADII[Math.min(RING_COUNT - 1, ringIdx)];
        const lx = VAULT_X + Math.cos(p.angleRad) * lockRadius;
        const ly = VAULT_Y + Math.sin(p.angleRad) * lockRadius;
        p.lockIcons.push(this.makeLockIcon(lx, ly));
      }
    }
    this.updateHud();
  }

  private makeLockIcon(x: number, y: number): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    // Shackle.
    const shackle = this.add
      .arc(0, -4, 6, 200, 340, false)
      .setStrokeStyle(2.5, 0xfde68a, 1);
    // Body.
    const body = this.add
      .rectangle(0, 4, 14, 11, 0xfacc15, 1)
      .setStrokeStyle(1, 0x713f12, 1);
    const keyhole = this.add.circle(0, 4, 1.5, 0x713f12, 1);
    c.add([shackle, body, keyhole]);
    this.layerEffects.add(c);
    // Pop-in.
    c.setScale(0);
    this.tweens.add({
      targets: c,
      scale: 1,
      duration: 180,
      ease: "Back.easeOut",
    });
    return c;
  }

  // ----------------------- Phase: answering -----------------------

  private startAnswering() {
    this.phase = "answering";
    this.clearPanel();

    const panel = this.add.container(0, 0);

    // Dim the play field so the question reads cleanly without hiding the board.
    const dim = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05060f, 0.5)
      .setOrigin(0.5);
    panel.add(dim);

    const stemBoxW = 720;
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

    const cardW = 210;
    const optionFontPx = 14;
    const optionWrapW = cardW - 28;
    const optionPadTop = 30;
    const optionPadBottom = 14;
    const minCardH = 116;
    const maxCardH = 180;
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

    const bandTop = 64;
    const bandBottom = optionTopY - 12;
    const maxBoxH = Math.max(minCardH, bandBottom - bandTop);
    const minBoxH = 96;
    const computedBoxH = padTop + labelH + labelGap + stemH + padBottom;
    const stemBoxH = Phaser.Math.Clamp(computedBoxH, minBoxH, maxBoxH);
    // Pin the stem just under the HUD so the board stays visible below.
    const boxTop = bandTop;
    const stemBoxY = boxTop + stemBoxH / 2;

    const stemBg = this.add
      .rectangle(GAME_WIDTH / 2, stemBoxY, stemBoxW, stemBoxH, 0x0a0d1f, 0.96)
      .setStrokeStyle(2, 0x7af0ff, 0.7);
    const stemLabel = this.add
      .text(GAME_WIDTH / 2, boxTop + padTop + labelH / 2, "INTRUSION ALERT", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#7af0ff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

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
      this.pendingAdvances = 1;
      this.startPlacing();
    } else {
      this.pendingAdvances = 2;
      this.startAttack();
    }
  }

  // ----------------------- Phase: placing -----------------------

  private startPlacing() {
    this.phase = "placing";
    this.clearPanel();

    const panel = this.add.container(0, 0);
    const banner = this.add
      .rectangle(GAME_WIDTH / 2, 34, GAME_WIDTH - 280, 44, 0x0a0d1f, 0.92)
      .setStrokeStyle(1, 0x4ade80, 0.7);
    const text = this.add
      .text(GAME_WIDTH / 2, 34, "CORRECT  ·  Click a path to place a lock", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#4ade80",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    panel.add([banner, text]);

    const hint = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 18, "Locks absorb the next attacker advance on that path. Max 3 per path.", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#94a3b8",
      })
      .setOrigin(0.5);
    panel.add(hint);

    this.layerUi.add(panel);
    this.panel = panel;

    // Pulse each path's name label briefly to signal interactivity.
    for (const p of this.paths) {
      if (this.state.paths[p.index].position >= RING_COUNT) continue;
      this.tweens.add({
        targets: p.nameLabel,
        scale: { from: 1, to: 1.15 },
        yoyo: true,
        repeat: 2,
        duration: 320,
        ease: "Sine.easeInOut",
      });
    }
  }

  private commitLockPlacement(pathIdx: number) {
    const s = this.state.paths[pathIdx];
    if (s.position >= RING_COUNT) return;
    if (s.locks >= MAX_LOCKS_PER_PATH) {
      this.cameras.main.shake(60, 0.002);
      return;
    }
    s.locks += 1;
    this.saveState();
    this.refreshBoard();
    // Lock placed → resolve the attack.
    this.startAttack();
  }

  // ----------------------- Phase: attacking -----------------------

  private startAttack() {
    this.phase = "attacking";
    this.clearPanel();
    this.attackInProgress = false;

    // Pick `pendingAdvances` distinct random paths that aren't already breached.
    // Fall back to repeats if all non-breached paths are exhausted.
    const choices: number[] = [];
    const candidates = this.state.paths
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.position < RING_COUNT)
      .map(({ i }) => i);
    if (candidates.length === 0) {
      // Already lost — should not normally land here, but bail safely.
      this.startGameOver();
      return;
    }
    const shuffled = Phaser.Utils.Array.Shuffle(candidates.slice());
    for (let i = 0; i < this.pendingAdvances; i++) {
      choices.push(shuffled[i % shuffled.length]);
    }
    this.attackQueue = choices;

    const banner = this.add.container(0, 0);
    const bg = this.add
      .rectangle(GAME_WIDTH / 2, 34, GAME_WIDTH - 280, 44, 0x0a0d1f, 0.92)
      .setStrokeStyle(1, 0xef4444, 0.7);
    const label = this.add
      .text(GAME_WIDTH / 2, 34, `ATTACKERS MOVING (×${this.pendingAdvances})`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#fca5a5",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    banner.add([bg, label]);
    this.layerUi.add(banner);
    this.panel = banner;

    this.processNextAttack();
  }

  private processNextAttack() {
    if (this.attackInProgress) return;
    if (this.attackQueue.length === 0) {
      // All advances resolved.
      this.state.questionsAnswered += 1;
      this.saveState();
      this.startFeedback();
      return;
    }
    const pathIdx = this.attackQueue.shift()!;
    this.attackInProgress = true;
    this.resolveAdvance(pathIdx, () => {
      this.attackInProgress = false;
      this.time.delayedCall(220, () => this.processNextAttack());
    });
  }

  private resolveAdvance(pathIdx: number, done: () => void) {
    const s = this.state.paths[pathIdx];
    const visual = this.paths[pathIdx];
    if (s.position >= RING_COUNT) {
      done();
      return;
    }

    // Lock check: if any lock present, consume one and DON'T advance.
    if (s.locks > 0) {
      s.locks -= 1;
      this.saveState();
      this.threatLog.push(`${PATH_NAMES[pathIdx]} blocked`);
      // Shatter the most recently placed lock icon visually.
      const last = visual.lockIcons.pop();
      if (last) {
        this.tweens.add({
          targets: last,
          scale: 1.4,
          alpha: 0,
          duration: 240,
          ease: "Quad.easeOut",
          onComplete: () => last.destroy(),
        });
      }
      // Brief shield flash at the lock position.
      this.flashAt(visual.attackerSprite.x, visual.attackerSprite.y, 0xfacc15);
      this.refreshBoard();
      done();
      return;
    }

    // No lock — advance one step.
    s.position += 1;
    this.saveState();
    this.threatLog.push(`${PATH_NAMES[pathIdx]} +1`);

    const targetRadius = s.position < RING_COUNT
      ? RING_RADII[0] + 28 - s.position * 60
      : VAULT_RADIUS + 4;
    const tx = VAULT_X + Math.cos(visual.angleRad) * targetRadius;
    const ty = VAULT_Y + Math.sin(visual.angleRad) * targetRadius;

    // Slide animation with brief trail flash.
    this.flashAt(visual.attackerSprite.x, visual.attackerSprite.y, visual.color);
    this.tweens.add({
      targets: visual.attackerSprite,
      x: tx,
      y: ty,
      duration: 420,
      ease: "Cubic.easeIn",
      onComplete: () => {
        // Light up the reached ring node.
        const ringIdx = s.position - 1;
        if (ringIdx >= 0 && ringIdx < RING_COUNT) {
          const node = visual.ringNodes[ringIdx];
          node.setFillStyle(visual.color, 0.9);
          node.setStrokeStyle(2, 0xffffff, 0.95);
          this.flashAt(node.x, node.y, visual.color);
        }
        if (s.position >= RING_COUNT) {
          this.cameras.main.shake(280, 0.012);
          this.flashAt(VAULT_X, VAULT_Y, 0xef4444);
          this.updateHud();
          this.time.delayedCall(420, () => {
            this.attackQueue = []; // drop remaining advances; we've lost
            this.startGameOver();
          });
          return;
        }
        this.cameras.main.shake(80, 0.003);
        this.updateHud();
        done();
      },
    });
  }

  private flashAt(x: number, y: number, color: number) {
    const ring = this.add
      .circle(x, y, 6, color, 0)
      .setStrokeStyle(3, color, 1);
    this.layerEffects.add(ring);
    this.tweens.add({
      targets: ring,
      radius: 30,
      alpha: 0,
      duration: 260,
      ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  // ----------------------- Phase: feedback -----------------------

  private startFeedback() {
    this.phase = "feedback";
    this.clearPanel();

    const result = this.answerResult ?? { correct: false, correct_index: -1, explanation: "" };
    const title = result.correct ? "LOCK DEPLOYED" : "ATTACKERS GAIN GROUND";
    const titleColor = result.correct ? "#4ade80" : "#ef4444";
    const accent = result.correct ? 0x4ade80 : 0xef4444;

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);

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

    const totalLocks = this.state.paths.reduce((s, p) => s + p.locks, 0);
    const worst = this.state.paths.reduce((m, p) => Math.max(m, p.position), 0);
    const closest = Math.max(0, RING_COUNT - worst);
    const stats = this.add
      .text(
        0,
        0,
        `Locks on the board: ${totalLocks}    Closest threat: ${closest} step${closest === 1 ? "" : "s"} from vault`,
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
    const gapAnsExp = 16;
    const gapExpStats = 22;
    const gapStatsBtn = 18;
    const gapBtnHint = 8;
    const btnH = 44;
    const panelW = 680;
    const minPanelH = 260;
    const maxPanelH = GAME_HEIGHT - 60;

    const contentH =
      padTop +
      titleText.height +
      gapTitleAns +
      ansText.height +
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
    y += ansText.height + gapAnsExp;
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

    panel.add([bg, titleText, ansText, explanation, stats, btnBg, btnText, btnHit, hint]);
    this.layerUi.add(panel);
    this.panel = panel;

    this.input.keyboard?.once("keydown-SPACE", () => this.onComplete());
  }

  // ----------------------- Phase: game over -----------------------

  private startGameOver() {
    this.phase = "gameOver";
    this.clearPanel();

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    const bg = this.add
      .rectangle(0, 0, 560, 240, 0x0a0d1f, 0.98)
      .setStrokeStyle(2, 0xef4444);
    const titleText = this.add
      .text(0, -82, "VAULT BREACHED", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "26px",
        color: "#ef4444",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const breached = this.state.paths
      .map((p, i) => (p.position >= RING_COUNT ? PATH_NAMES[i] : null))
      .filter((s): s is string => !!s)
      .join(", ");
    const subtitle = this.add
      .text(
        0,
        -42,
        `${breached || "An attacker"} reached the vault on question ${this.state.questionsAnswered + 1}. Run ends here.`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          color: "#fca5a5",
          align: "center",
          wordWrap: { width: 520 },
        },
      )
      .setOrigin(0.5);
    const totalLocks = this.state.paths.reduce((s, p) => s + p.locks, 0);
    const stats = this.add
      .text(
        0,
        4,
        `Questions answered: ${this.state.questionsAnswered}   ·   Locks remaining: ${totalLocks}`,
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
    for (const p of this.paths) {
      p.hoverGlow.clear();
      this.tweens.killTweensOf(p.nameLabel);
      p.nameLabel.setScale(1);
    }
  }
}

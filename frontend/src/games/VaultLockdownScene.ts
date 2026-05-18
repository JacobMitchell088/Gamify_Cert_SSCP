import Phaser from "phaser";

import type { AnswerResult, Question } from "../types";
import { GAME_HEIGHT, GAME_WIDTH, makeDevAnswerBadge, type SceneData } from "./sceneContract";

// ----------------------- Board geometry -----------------------

const VAULT_X = GAME_WIDTH / 2;
const VAULT_Y = 380;
const VAULT_RADIUS = 46;
const NODE_RADIUS = 12;

const ATTACKER_COUNT = 6;
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

// Ring radii used when scattering intermediate nodes. Outer ring is where
// the 6 spawn nodes live; inner ring connects to the vault.
const RING_RADII = [275, 195, 110];
const MAX_LOCKS_PER_EDGE = 2;

// ----------------------- Graph types -----------------------

interface GraphNode {
  id: number;
  x: number;
  y: number;
  /** -1 = non-spawn intermediate, 0..5 = spawn for attacker N, -2 = vault */
  spawnFor: number;
}

interface GraphEdge {
  /** Stable id "min(a,b)-max(a,b)" used as a Map key for locks. */
  key: string;
  a: number; // node id
  b: number; // node id
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** node id of the vault. */
  vaultId: number;
  /** node id where attacker i spawns. */
  spawnNodeId: number[];
}

interface AttackerState {
  /** Index into PATH_NAMES / PATH_COLORS. */
  index: number;
  /** Current node id. Attackers always sit on a node. */
  nodeId: number;
  /** True once attacker has reached the vault. The run is then over. */
  breached: boolean;
}

interface PersistentState {
  questionsAnswered: number;
  graph: Graph;
  attackers: AttackerState[];
  /** edge.key -> remaining lock count */
  edgeLocks: Record<string, number>;
  /** attacker indices, in order, that will move on the next question.
   *  Length 2: index 0 moves on either correct or wrong; index 1 only moves
   *  on wrong. Pre-computed so the telegraph can show them before the
   *  player picks. */
  nextMovers: number[];
}

const REGISTRY_KEY = "vault_state_v2";

// ----------------------- Visuals state -----------------------

interface NodeVisual {
  node: GraphNode;
  circle: Phaser.GameObjects.Arc;
  label?: Phaser.GameObjects.Text;
}

interface EdgeVisual {
  edge: GraphEdge;
  line: Phaser.GameObjects.Line;
  hoverLine: Phaser.GameObjects.Line;
  hitZone: Phaser.GameObjects.Zone;
  lockIcon: Phaser.GameObjects.Container | null;
}

interface AttackerVisual {
  state: AttackerState;
  container: Phaser.GameObjects.Container;
  core: Phaser.GameObjects.Arc;
  inner: Phaser.GameObjects.Arc;
  pulseTween: Phaser.Tweens.Tween | null;
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

  private layerWorld!: Phaser.GameObjects.Container;
  private layerEffects!: Phaser.GameObjects.Container;
  private layerUi!: Phaser.GameObjects.Container;

  private vaultCore!: Phaser.GameObjects.Arc;
  private vaultRing!: Phaser.GameObjects.Arc;

  private nodeVisuals = new Map<number, NodeVisual>();
  private edgeVisuals = new Map<string, EdgeVisual>();
  private attackerVisuals: AttackerVisual[] = [];

  private hudStatus!: Phaser.GameObjects.Text;
  private hudThreat!: Phaser.GameObjects.Text;
  private telegraphText!: Phaser.GameObjects.Text;

  private panel: Phaser.GameObjects.Container | null = null;

  private pendingAdvances = 0;
  private attackQueue: number[] = [];
  private attackInProgress = false;
  private threatLog: string[] = [];

  constructor() {
    super({ key: "VaultLockdownScene" });
  }

  init(data: SceneData) {
    if (!data || !data.question) return;
    this.question = data.question;
    this.recordAnswer = data.recordAnswer;
    this.onComplete = data.onComplete;
    this.abortRun = data.abortRun;
    this.answerResult = null;
    this.phase = "answering";
    this.nodeVisuals = new Map();
    this.edgeVisuals = new Map();
    this.attackerVisuals = [];
    this.panel = null;
    this.attackQueue = [];
    this.attackInProgress = false;
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
    this.drawEdges();
    this.drawNodes();
    this.drawAttackers();
    this.drawHud();
    this.refreshLockIcons();

    this.startAnswering();
  }

  // ----------------------- Persistence -----------------------

  private loadOrInitState() {
    const existing = this.registry.get(REGISTRY_KEY) as PersistentState | undefined;
    if (existing) {
      this.state = existing;
      // Top up nextMovers if a stale state from a previous batch left it empty.
      if (!this.state.nextMovers || this.state.nextMovers.length === 0) {
        this.state.nextMovers = this.planNextMovers();
        this.saveState();
      }
      return;
    }
    const graph = generateGraph();
    const attackers: AttackerState[] = Array.from({ length: ATTACKER_COUNT }, (_, i) => ({
      index: i,
      nodeId: graph.spawnNodeId[i],
      breached: false,
    }));
    this.state = {
      questionsAnswered: 0,
      graph,
      attackers,
      edgeLocks: {},
      nextMovers: [],
    };
    this.state.nextMovers = this.planNextMovers();
    this.registry.set(REGISTRY_KEY, this.state);
  }

  private saveState() {
    this.registry.set(REGISTRY_KEY, this.state);
  }

  // ----------------------- Graph queries -----------------------

  private neighbors(nodeId: number): number[] {
    const out: number[] = [];
    for (const e of this.state.graph.edges) {
      if (e.a === nodeId) out.push(e.b);
      else if (e.b === nodeId) out.push(e.a);
    }
    return out;
  }

  private edgeKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  private edgeLocks(a: number, b: number): number {
    return this.state.edgeLocks[this.edgeKey(a, b)] ?? 0;
  }

  /** BFS shortest path from `start` to `goal`, treating edges with >0 locks
   *  as impassable. Returns the node sequence including endpoints, or null. */
  private shortestPath(start: number, goal: number, avoidLocked: boolean): number[] | null {
    if (start === goal) return [start];
    const prev = new Map<number, number>();
    const visited = new Set<number>([start]);
    const queue: number[] = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of this.neighbors(cur)) {
        if (visited.has(nb)) continue;
        if (avoidLocked && this.edgeLocks(cur, nb) > 0) continue;
        visited.add(nb);
        prev.set(nb, cur);
        if (nb === goal) {
          const path: number[] = [goal];
          let p = goal;
          while (prev.has(p)) {
            p = prev.get(p)!;
            path.unshift(p);
          }
          return path;
        }
        queue.push(nb);
      }
    }
    return null;
  }

  /** Distance from a node to the vault avoiding locked edges if possible,
   *  falling back to a lock-busting path. Used both for the "who moves next"
   *  ranking and for routing each step. */
  private distanceToVault(nodeId: number): number {
    const goal = this.state.graph.vaultId;
    let path = this.shortestPath(nodeId, goal, true);
    if (!path) path = this.shortestPath(nodeId, goal, false);
    if (!path) return Infinity;
    return path.length - 1;
  }

  /** Returns the next node an attacker would step to on its way to the vault. */
  private nextStepFor(attackerIdx: number): { nextNode: number; viaLock: boolean } | null {
    const a = this.state.attackers[attackerIdx];
    if (a.breached) return null;
    if (a.nodeId === this.state.graph.vaultId) return null;
    // Prefer the shortest unlocked path.
    let path = this.shortestPath(a.nodeId, this.state.graph.vaultId, true);
    let viaLock = false;
    if (!path || path.length < 2) {
      // Every route is locked; take the absolute shortest, knowing the next
      // edge will burn a lock instead of advancing.
      path = this.shortestPath(a.nodeId, this.state.graph.vaultId, false);
      viaLock = true;
    }
    if (!path || path.length < 2) return null;
    return { nextNode: path[1], viaLock };
  }

  // ----------------------- Telegraph planning -----------------------

  /** Decide which attackers will move on this question. Always returns 2
   *  attacker indices (the first moves on correct OR wrong, the second only
   *  on wrong). Picks the closest-to-vault attackers first to keep stakes high. */
  private planNextMovers(): number[] {
    const alive = this.state.attackers
      .map((a, i) => ({ i, a, d: this.distanceToVault(a.nodeId) }))
      .filter(({ a }) => !a.breached);
    if (alive.length === 0) return [];
    // Sort by closest to vault; tiebreak randomly so it's not always the same one.
    alive.sort((x, y) => x.d - y.d || Math.random() - 0.5);
    // Top 2 (or duplicate first if only one alive).
    const out = [alive[0].i];
    if (alive.length >= 2) out.push(alive[1].i);
    else out.push(alive[0].i);
    return out;
  }

  // ----------------------- World drawing -----------------------

  private drawBackdrop() {
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x12182c, 0.55);
    for (let x = 0; x < GAME_WIDTH; x += 40) grid.lineBetween(x, 0, x, GAME_HEIGHT);
    for (let y = 0; y < GAME_HEIGHT; y += 40) grid.lineBetween(0, y, GAME_WIDTH, y);
    this.layerWorld.add(grid);

    const rings = this.add.graphics();
    for (let r = 0; r < RING_RADII.length; r++) {
      const radius = RING_RADII[r];
      const alpha = 0.14 + r * 0.05;
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

  private drawEdges() {
    for (const e of this.state.graph.edges) {
      const a = this.state.graph.nodes[e.a];
      const b = this.state.graph.nodes[e.b];

      const line = this.add.line(0, 0, a.x, a.y, b.x, b.y, 0x334155, 1).setOrigin(0, 0);
      line.setLineWidth(3);
      this.layerWorld.add(line);

      const hoverLine = this.add
        .line(0, 0, a.x, a.y, b.x, b.y, 0xfacc15, 0)
        .setOrigin(0, 0);
      hoverLine.setLineWidth(7);
      this.layerEffects.add(hoverLine);

      // Hit zone: rectangle stretched along the segment, rotated.
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const hit = this.add.zone(cx, cy, len, 26).setOrigin(0.5);
      hit.rotation = angle;
      hit.setInteractive({ useHandCursor: false });
      this.layerWorld.add(hit);

      const visual: EdgeVisual = {
        edge: e,
        line,
        hoverLine,
        hitZone: hit,
        lockIcon: null,
      };
      this.edgeVisuals.set(e.key, visual);

      hit.on("pointerover", () => {
        if (this.phase !== "placing") return;
        if ((this.state.edgeLocks[e.key] ?? 0) >= MAX_LOCKS_PER_EDGE) {
          hoverLine.fillColor = 0xef4444;
          hoverLine.strokeColor = 0xef4444;
          hoverLine.setAlpha(0.4);
        } else {
          hoverLine.fillColor = 0xfacc15;
          hoverLine.strokeColor = 0xfacc15;
          hoverLine.setAlpha(0.4);
        }
      });
      hit.on("pointerout", () => hoverLine.setAlpha(0));
      hit.on("pointerdown", () => {
        if (this.phase !== "placing") return;
        this.commitLockPlacement(e.key);
      });
    }
  }

  private drawNodes() {
    for (const n of this.state.graph.nodes) {
      if (n.id === this.state.graph.vaultId) continue; // vault is drawn separately
      const color = n.spawnFor >= 0 ? PATH_COLORS[n.spawnFor] : 0x60a5fa;
      const radius = n.spawnFor >= 0 ? NODE_RADIUS + 2 : NODE_RADIUS;
      const circle = this.add
        .circle(n.x, n.y, radius, 0x1e293b, 1)
        .setStrokeStyle(2, color, n.spawnFor >= 0 ? 0.85 : 0.5);
      this.layerWorld.add(circle);

      let label: Phaser.GameObjects.Text | undefined;
      if (n.spawnFor >= 0) {
        // Label sits just outside the node, away from the vault.
        const ang = Math.atan2(n.y - VAULT_Y, n.x - VAULT_X);
        const lx = n.x + Math.cos(ang) * 30;
        const ly = n.y + Math.sin(ang) * 30;
        label = this.add
          .text(lx, ly, PATH_NAMES[n.spawnFor], {
            fontFamily: "system-ui, sans-serif",
            fontSize: "11px",
            color: "#cbd5f5",
            fontStyle: "bold",
          })
          .setOrigin(0.5);
        this.layerWorld.add(label);
      }
      this.nodeVisuals.set(n.id, { node: n, circle, label });
    }
  }

  private drawAttackers() {
    // Group attackers by node so multiple-on-one-node get small radial offsets.
    const byNode = new Map<number, number[]>();
    for (const a of this.state.attackers) {
      if (a.breached) continue;
      const arr = byNode.get(a.nodeId) ?? [];
      arr.push(a.index);
      byNode.set(a.nodeId, arr);
    }
    for (const a of this.state.attackers) {
      if (a.breached) continue;
      const node = this.state.graph.nodes[a.nodeId];
      const group = byNode.get(a.nodeId)!;
      const slot = group.indexOf(a.index);
      const total = group.length;
      const [ox, oy] = this.attackerSlotOffset(slot, total);
      const color = PATH_COLORS[a.index];
      const container = this.add.container(node.x + ox, node.y + oy);
      const core = this.add
        .circle(0, 0, 9, color, 1)
        .setStrokeStyle(2, 0xffffff, 0.9);
      const inner = this.add.circle(0, 0, 4, 0xffffff, 0.9);
      container.add([core, inner]);
      this.layerWorld.add(container);

      this.tweens.add({
        targets: inner,
        alpha: 0.4,
        yoyo: true,
        repeat: -1,
        duration: 700,
        ease: "Sine.easeInOut",
      });

      this.attackerVisuals.push({
        state: a,
        container,
        core,
        inner,
        pulseTween: null,
      });
    }
  }

  /** Position offset for the Nth attacker stacked on a single node. */
  private attackerSlotOffset(slot: number, total: number): [number, number] {
    if (total <= 1) return [0, 0];
    const r = 10;
    const angle = (slot / total) * Math.PI * 2;
    return [Math.cos(angle) * r, Math.sin(angle) * r];
  }

  private refreshAttackerPositions(animate: boolean) {
    // Rebuild grouping after any move.
    const byNode = new Map<number, number[]>();
    for (const v of this.attackerVisuals) {
      if (v.state.breached) continue;
      const arr = byNode.get(v.state.nodeId) ?? [];
      arr.push(v.state.index);
      byNode.set(v.state.nodeId, arr);
    }
    for (const v of this.attackerVisuals) {
      if (v.state.breached) continue;
      const node = this.state.graph.nodes[v.state.nodeId];
      const group = byNode.get(v.state.nodeId)!;
      const slot = group.indexOf(v.state.index);
      const total = group.length;
      const [ox, oy] = this.attackerSlotOffset(slot, total);
      const tx = node.x + ox;
      const ty = node.y + oy;
      if (animate) {
        this.tweens.add({
          targets: v.container,
          x: tx,
          y: ty,
          duration: 380,
          ease: "Cubic.easeInOut",
        });
      } else {
        v.container.x = tx;
        v.container.y = ty;
      }
    }
  }

  private refreshLockIcons() {
    for (const [key, ev] of this.edgeVisuals) {
      const count = this.state.edgeLocks[key] ?? 0;
      if (ev.lockIcon) {
        ev.lockIcon.destroy();
        ev.lockIcon = null;
      }
      if (count > 0) {
        const a = this.state.graph.nodes[ev.edge.a];
        const b = this.state.graph.nodes[ev.edge.b];
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        ev.lockIcon = this.makeLockIcon(cx, cy, count);
        ev.line.strokeColor = 0xfacc15;
      } else {
        ev.line.strokeColor = 0x334155;
      }
    }
  }

  private makeLockIcon(x: number, y: number, count: number): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const shackle = this.add
      .arc(0, -4, 6, 200, 340, false)
      .setStrokeStyle(2.5, 0xfde68a, 1);
    const body = this.add
      .rectangle(0, 4, 14, 11, 0xfacc15, 1)
      .setStrokeStyle(1, 0x713f12, 1);
    const keyhole = this.add.circle(0, 4, 1.5, 0x713f12, 1);
    c.add([shackle, body, keyhole]);
    if (count > 1) {
      const badge = this.add.circle(8, -8, 7, 0xef4444, 1).setStrokeStyle(1, 0xfecaca);
      const badgeText = this.add
        .text(8, -8, String(count), {
          fontFamily: "system-ui, sans-serif",
          fontSize: "9px",
          color: "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      c.add([badge, badgeText]);
    }
    this.layerEffects.add(c);
    c.setScale(0);
    this.tweens.add({ targets: c, scale: 1, duration: 180, ease: "Back.easeOut" });
    return c;
  }

  // ----------------------- HUD -----------------------

  private drawHud() {
    const hudBg = this.add
      .rectangle(8, 8, 360, 56, 0x0a0d1f, 0.85)
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
      .text(20, 28, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#e2e8f0",
      })
      .setOrigin(0, 0);
    this.telegraphText = this.add
      .text(20, 44, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#fca5a5",
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

    this.layerUi.add([hudBg, label, this.hudStatus, this.telegraphText, this.hudThreat]);
    this.updateHud();
  }

  private updateHud() {
    const q = this.state.questionsAnswered + 1;
    const totalLocks = Object.values(this.state.edgeLocks).reduce((a, b) => a + b, 0);
    const minD = this.state.attackers
      .filter((a) => !a.breached)
      .map((a) => this.distanceToVault(a.nodeId))
      .reduce((m, d) => Math.min(m, d), Infinity);
    const closestLabel = Number.isFinite(minD) ? `${minD} step${minD === 1 ? "" : "s"}` : "—";
    this.hudStatus.setText(`Q ${q}/30   Locks: ${totalLocks}   Closest threat: ${closestLabel}`);
    this.updateTelegraphText();
    const tail = this.threatLog.slice(-3).join("   ");
    this.hudThreat.setText(tail);
  }

  private updateTelegraphText() {
    const movers = this.state.nextMovers ?? [];
    if (movers.length < 2) {
      this.telegraphText.setText("");
      return;
    }
    const first = PATH_NAMES[movers[0]];
    const second = PATH_NAMES[movers[1]];
    this.telegraphText.setText(
      `Next move (always): ${first}   ·   Extra on WRONG: ${second}`,
    );
  }

  // ----------------------- Pulse telegraph -----------------------

  private startTelegraphPulse() {
    this.stopTelegraphPulse();
    const movers = this.state.nextMovers ?? [];
    for (let slot = 0; slot < movers.length; slot++) {
      const v = this.attackerVisuals.find((av) => av.state.index === movers[slot]);
      if (!v) continue;
      // The first mover (always-move) pulses harder than the second (wrong-only).
      const intensity = slot === 0 ? 1.55 : 1.3;
      v.pulseTween = this.tweens.add({
        targets: v.container,
        scale: { from: 1, to: intensity },
        yoyo: true,
        repeat: -1,
        duration: slot === 0 ? 420 : 540,
        ease: "Sine.easeInOut",
      });
      // Halo ring around the about-to-move attacker.
      const haloColor = slot === 0 ? 0xef4444 : 0xfacc15;
      const halo = this.add
        .circle(0, 0, 22, haloColor, 0)
        .setStrokeStyle(2, haloColor, 0.8);
      v.container.add(halo);
      this.tweens.add({
        targets: halo,
        scale: { from: 0.8, to: 1.4 },
        alpha: { from: 0.9, to: 0.2 },
        yoyo: true,
        repeat: -1,
        duration: 750,
        ease: "Sine.easeInOut",
      });
    }
  }

  private stopTelegraphPulse() {
    for (const v of this.attackerVisuals) {
      if (v.pulseTween) {
        v.pulseTween.stop();
        v.pulseTween = null;
      }
      v.container.setScale(1);
      // Destroy any halo children we appended (anything past the first 2).
      while (v.container.list.length > 2) {
        const obj = v.container.list[v.container.list.length - 1];
        this.tweens.killTweensOf(obj);
        v.container.remove(obj, true);
      }
    }
  }

  // ----------------------- Phase: answering -----------------------

  private startAnswering() {
    this.phase = "answering";
    this.clearPanel();
    this.startTelegraphPulse();

    const panel = this.add.container(0, 0);

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

    const bandTop = 78;
    const bandBottom = optionTopY - 12;
    const maxBoxH = Math.max(minCardH, bandBottom - bandTop);
    const minBoxH = 96;
    const computedBoxH = padTop + labelH + labelGap + stemH + padBottom;
    const stemBoxH = Phaser.Math.Clamp(computedBoxH, minBoxH, maxBoxH);
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

    // Per-question telegraph banner above the stem.
    const movers = this.state.nextMovers ?? [];
    if (movers.length >= 2) {
      const movesText = `If CORRECT: place a lock, then ${PATH_NAMES[movers[0]]} advances 1 step.   ` +
        `If WRONG: ${PATH_NAMES[movers[0]]} advances 1 step AND ${PATH_NAMES[movers[1]]} advances 1 step.`;
      const tg = this.add
        .text(GAME_WIDTH / 2, 70, movesText, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "11px",
          color: "#fde68a",
          align: "center",
          wordWrap: { width: GAME_WIDTH - 260 },
        })
        .setOrigin(0.5);
      panel.add(tg);
    }

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

    this.stopTelegraphPulse();
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
      .text(GAME_WIDTH / 2, 34, "CORRECT  ·  Click an edge to place a lock", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#4ade80",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    panel.add([banner, text]);

    const hint = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 18, `Locks absorb one attempt to traverse that edge. Attackers re-route around locked edges if they can. Max ${MAX_LOCKS_PER_EDGE} locks per edge.`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#94a3b8",
        align: "center",
        wordWrap: { width: GAME_WIDTH - 240 },
      })
      .setOrigin(0.5);
    panel.add(hint);

    this.layerUi.add(panel);
    this.panel = panel;
  }

  private commitLockPlacement(edgeKey: string) {
    const current = this.state.edgeLocks[edgeKey] ?? 0;
    if (current >= MAX_LOCKS_PER_EDGE) {
      this.cameras.main.shake(60, 0.002);
      return;
    }
    this.state.edgeLocks[edgeKey] = current + 1;
    this.saveState();
    this.refreshLockIcons();
    this.startAttack();
  }

  // ----------------------- Phase: attack -----------------------

  private startAttack() {
    this.phase = "attacking";
    this.clearPanel();
    this.attackInProgress = false;

    // Use the pre-planned movers so the player's pre-question telegraph
    // matches reality. First mover always moves; second moves only on wrong.
    const movers = (this.state.nextMovers ?? []).slice(0, this.pendingAdvances);
    // Filter out any that have since breached (shouldn't normally happen
    // but defends against state-skew when re-entering after game over).
    this.attackQueue = movers.filter((i) => !this.state.attackers[i].breached);
    if (this.attackQueue.length === 0) {
      this.advanceQuestion();
      return;
    }

    const banner = this.add.container(0, 0);
    const bg = this.add
      .rectangle(GAME_WIDTH / 2, 34, GAME_WIDTH - 280, 44, 0x0a0d1f, 0.92)
      .setStrokeStyle(1, 0xef4444, 0.7);
    const label = this.add
      .text(
        GAME_WIDTH / 2,
        34,
        `ATTACKERS MOVING (${this.attackQueue.map((i) => PATH_NAMES[i]).join(" · ")})`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "14px",
          color: "#fca5a5",
          fontStyle: "bold",
        },
      )
      .setOrigin(0.5);
    banner.add([bg, label]);
    this.layerUi.add(banner);
    this.panel = banner;

    this.processNextAttack();
  }

  private processNextAttack() {
    if (this.attackInProgress) return;
    if (this.attackQueue.length === 0) {
      this.advanceQuestion();
      return;
    }
    const attackerIdx = this.attackQueue.shift()!;
    this.attackInProgress = true;
    this.resolveAdvance(attackerIdx, () => {
      this.attackInProgress = false;
      this.time.delayedCall(220, () => this.processNextAttack());
    });
  }

  private advanceQuestion() {
    this.state.questionsAnswered += 1;
    // Re-plan movers for the NEXT question so the feedback panel and the
    // next answer phase agree on who's up.
    this.state.nextMovers = this.planNextMovers();
    this.saveState();
    this.updateHud();
    this.startFeedback();
  }

  private resolveAdvance(attackerIdx: number, done: () => void) {
    const attacker = this.state.attackers[attackerIdx];
    if (attacker.breached) {
      done();
      return;
    }
    const step = this.nextStepFor(attackerIdx);
    if (!step) {
      // Already at vault or no graph route; treat as breach if at vault.
      done();
      return;
    }

    const visual = this.attackerVisuals.find((v) => v.state.index === attackerIdx);

    // If the next edge is locked, consume one lock and don't advance.
    const locksOnEdge = this.edgeLocks(attacker.nodeId, step.nextNode);
    if (locksOnEdge > 0 && !step.viaLock) {
      const k = this.edgeKey(attacker.nodeId, step.nextNode);
      this.state.edgeLocks[k] = locksOnEdge - 1;
      this.saveState();
      this.threatLog.push(`${PATH_NAMES[attackerIdx]} blocked`);
      this.refreshLockIcons();
      if (visual) this.flashAt(visual.container.x, visual.container.y, 0xfacc15);
      this.updateHud();
      done();
      return;
    }

    // viaLock means every path to vault is locked; we still want forward
    // motion in the long run, so we burn a lock on this edge AND advance.
    // This is a "lock-busting" step — the player gets one free block per
    // lock, but they can't stop an attacker forever.
    if (step.viaLock && locksOnEdge > 0) {
      const k = this.edgeKey(attacker.nodeId, step.nextNode);
      this.state.edgeLocks[k] = locksOnEdge - 1;
      this.refreshLockIcons();
      if (visual) this.flashAt(visual.container.x, visual.container.y, 0xf87171);
    }

    attacker.nodeId = step.nextNode;
    this.threatLog.push(`${PATH_NAMES[attackerIdx]} +1`);
    this.saveState();

    // Animate the slide.
    const fromNode = this.state.graph.nodes[attacker.nodeId];
    if (visual) {
      // Find the actual stacking offset at the destination.
      const occupants = this.attackerVisuals
        .filter((v) => !v.state.breached && v.state.nodeId === step.nextNode)
        .map((v) => v.state.index);
      const slot = occupants.indexOf(attackerIdx);
      const [ox, oy] = this.attackerSlotOffset(slot, occupants.length);
      const tx = fromNode.x + ox;
      const ty = fromNode.y + oy;
      this.flashAt(visual.container.x, visual.container.y, PATH_COLORS[attackerIdx]);
      this.tweens.add({
        targets: visual.container,
        x: tx,
        y: ty,
        duration: 380,
        ease: "Cubic.easeInOut",
        onComplete: () => {
          // Re-pack any other attackers at the source/dest in case slots shifted.
          this.refreshAttackerPositions(true);
          if (step.nextNode === this.state.graph.vaultId) {
            attacker.breached = true;
            this.cameras.main.shake(280, 0.012);
            this.flashAt(VAULT_X, VAULT_Y, 0xef4444);
            this.saveState();
            this.updateHud();
            this.time.delayedCall(420, () => {
              this.attackQueue = [];
              this.startGameOver();
            });
            return;
          }
          this.cameras.main.shake(60, 0.0025);
          this.updateHud();
          done();
        },
      });
    } else {
      done();
    }
  }

  private flashAt(x: number, y: number, color: number) {
    const ring = this.add.circle(x, y, 6, color, 0).setStrokeStyle(3, color, 1);
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

    const totalLocks = Object.values(this.state.edgeLocks).reduce((a, b) => a + b, 0);
    const closest = this.state.attackers
      .filter((a) => !a.breached)
      .map((a) => this.distanceToVault(a.nodeId))
      .reduce((m, d) => Math.min(m, d), Infinity);
    const closestStr = Number.isFinite(closest) ? `${closest} step${closest === 1 ? "" : "s"}` : "—";
    const stats = this.add
      .text(
        0,
        0,
        `Locks on the board: ${totalLocks}    Closest threat: ${closestStr} from vault`,
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
    const breached = this.state.attackers
      .map((a) => (a.breached ? PATH_NAMES[a.index] : null))
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
    const totalLocks = Object.values(this.state.edgeLocks).reduce((a, b) => a + b, 0);
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
  }
}

// ----------------------- Random graph generation -----------------------

/** Build a fresh random graph: vault at center, 6 spawn nodes at randomized
 *  angles around the outer ring, plus a handful of intermediate nodes at
 *  mid + inner rings. Edges connect outer→mid, mid→inner, inner→vault, with
 *  occasional lateral edges so blocking one path forces a detour. Path
 *  lengths vary so some attackers are inherently closer to the vault. */
function generateGraph(): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeKeySet = new Set<string>();
  const addNode = (x: number, y: number, spawnFor: number): GraphNode => {
    const n: GraphNode = { id: nodes.length, x, y, spawnFor };
    nodes.push(n);
    return n;
  };
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeKeySet.has(k)) return;
    edgeKeySet.add(k);
    edges.push({ key: k, a, b });
  };

  // 1. Vault.
  const vault = addNode(VAULT_X, VAULT_Y, -2);

  // 2. Six spawn nodes around the outer ring with jitter.
  const baseAngles = [-90, -30, 30, 90, 150, 210];
  const spawnNodeId: number[] = [];
  const spawnAngles: number[] = [];
  for (let i = 0; i < ATTACKER_COUNT; i++) {
    const jitter = (Math.random() - 0.5) * 22; // ±11°
    const angDeg = baseAngles[i] + jitter;
    const ang = Phaser.Math.DegToRad(angDeg);
    const radius = RING_RADII[0] + (Math.random() - 0.5) * 30;
    const x = VAULT_X + Math.cos(ang) * radius;
    const y = VAULT_Y + Math.sin(ang) * radius;
    const n = addNode(x, y, i);
    spawnNodeId.push(n.id);
    spawnAngles.push(angDeg);
  }

  // 3. Mid ring: 4-5 nodes scattered at varying angles between spawns.
  const midCount = 4 + Math.floor(Math.random() * 2); // 4 or 5
  const midNodeIds: number[] = [];
  const midAngles: number[] = [];
  // Distribute roughly evenly with jitter, starting at a random offset.
  const midStart = Math.random() * 360;
  for (let i = 0; i < midCount; i++) {
    const baseAng = midStart + (360 / midCount) * i + (Math.random() - 0.5) * 30;
    const ang = Phaser.Math.DegToRad(baseAng);
    const radius = RING_RADII[1] + (Math.random() - 0.5) * 24;
    const x = VAULT_X + Math.cos(ang) * radius;
    const y = VAULT_Y + Math.sin(ang) * radius;
    const n = addNode(x, y, -1);
    midNodeIds.push(n.id);
    midAngles.push(baseAng);
  }

  // 4. Inner ring: 2-3 nodes close to the vault.
  const innerCount = 2 + Math.floor(Math.random() * 2); // 2 or 3
  const innerNodeIds: number[] = [];
  const innerAngles: number[] = [];
  const innerStart = Math.random() * 360;
  for (let i = 0; i < innerCount; i++) {
    const baseAng = innerStart + (360 / innerCount) * i + (Math.random() - 0.5) * 40;
    const ang = Phaser.Math.DegToRad(baseAng);
    const radius = RING_RADII[2] + (Math.random() - 0.5) * 18;
    const x = VAULT_X + Math.cos(ang) * radius;
    const y = VAULT_Y + Math.sin(ang) * radius;
    const n = addNode(x, y, -1);
    innerNodeIds.push(n.id);
    innerAngles.push(baseAng);
  }

  // Helpers for angular distance between two degree-angles.
  const angDist = (a: number, b: number) => {
    const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
    return d;
  };
  const nearestMid = (ang: number, k: number): number[] => {
    return midNodeIds
      .map((id, i) => ({ id, d: angDist(ang, midAngles[i]) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, k)
      .map((r) => r.id);
  };
  const nearestInner = (ang: number, k: number): number[] => {
    return innerNodeIds
      .map((id, i) => ({ id, d: angDist(ang, innerAngles[i]) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, k)
      .map((r) => r.id);
  };

  // 5. Connect each spawn to 1-2 nearest mid nodes. With 25% prob, give a
  //    spawn a direct "shortcut" to an inner node (skipping mid) — that's
  //    what makes some paths shorter than others.
  for (let i = 0; i < ATTACKER_COUNT; i++) {
    const spawnId = spawnNodeId[i];
    const ang = spawnAngles[i];
    const k = Math.random() < 0.45 ? 2 : 1;
    for (const midId of nearestMid(ang, k)) addEdge(spawnId, midId);
    if (Math.random() < 0.25) {
      const innerIds = nearestInner(ang, 1);
      if (innerIds.length) addEdge(spawnId, innerIds[0]);
    }
  }

  // 6. Connect each mid node to 1-2 nearest inner nodes.
  for (let i = 0; i < midNodeIds.length; i++) {
    const midId = midNodeIds[i];
    const k = Math.random() < 0.5 ? 2 : 1;
    for (const innerId of nearestInner(midAngles[i], k)) addEdge(midId, innerId);
  }

  // 7. Optional lateral edges within mid ring (creates detours).
  for (let i = 0; i < midNodeIds.length; i++) {
    if (Math.random() < 0.35) {
      const next = (i + 1) % midNodeIds.length;
      addEdge(midNodeIds[i], midNodeIds[next]);
    }
  }

  // 8. Every inner node connects to the vault.
  for (const innerId of innerNodeIds) addEdge(innerId, vault.id);

  // 9. Connectivity guarantee: every spawn must have a BFS path to the vault.
  //    If a spawn is isolated (rare but possible), wire it directly into the
  //    nearest inner node.
  const reachable = (start: number): boolean => {
    const seen = new Set<number>([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === vault.id) return true;
      for (const e of edges) {
        const nb = e.a === cur ? e.b : e.b === cur ? e.a : -1;
        if (nb === -1) continue;
        if (seen.has(nb)) continue;
        seen.add(nb);
        queue.push(nb);
      }
    }
    return false;
  };
  for (let i = 0; i < ATTACKER_COUNT; i++) {
    if (!reachable(spawnNodeId[i])) {
      const innerIds = nearestInner(spawnAngles[i], 1);
      if (innerIds.length) addEdge(spawnNodeId[i], innerIds[0]);
      else addEdge(spawnNodeId[i], vault.id);
    }
  }

  return {
    nodes,
    edges,
    vaultId: vault.id,
    spawnNodeId,
  };
}

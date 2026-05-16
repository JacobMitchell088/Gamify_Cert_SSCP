import Phaser from "phaser";

import type { AnswerResult, Question } from "../types";
import { GAME_HEIGHT, GAME_WIDTH, type SceneData } from "./sceneContract";

// ===================== Patch Tuesday Deckbuilder =====================
//
// Roguelike autobattler. Each SSCP question is one "Patch Tuesday" round:
//   - Pick an answer.
//   - An exploit rolls in from the right.
//   - Correct -> your field cards auto-strike, the exploit dies, you draft
//     1 of 3 reward cards (or skip).
//   - Wrong -> the exploit slams the leftmost slot; damage overflows to the
//     next slot, then to Infra HP.
// Field holds up to 3 cards. Cards persist across questions. Infra HP 0 =
// game over. Reaching the run's final batch end = victory.
//
// All state lives in the registry under REGISTRY_KEY so it survives the
// between-batch network fetch (see CLAUDE.md §10.4).

// ----------------------- Tunables -----------------------

const INFRA_MAX_HP = 100;
const FIELD_SLOTS = 3;
const DRAFT_CHOICES = 3;
const RARE_EVERY = 5; // every Nth correct answer the draft includes a rare

const REGISTRY_KEY = "patch_tuesday_state_v1";

// ----------------------- Card pool -----------------------

type CardRarity = "common" | "rare";

interface CardDef {
  key: string;
  name: string;
  hp: number;
  atk: number;
  domain: string; // short label
  color: number;
  rarity: CardRarity;
  flavor: string;
}

const CARD_POOL: CardDef[] = [
  { key: "firewall",   name: "Firewall",        hp: 4, atk: 1, domain: "NET",    color: 0x60a5fa, rarity: "common", flavor: "Blocks first wave." },
  { key: "ids",        name: "IDS",             hp: 2, atk: 3, domain: "RISK",   color: 0xf472b6, rarity: "common", flavor: "Spots intruders fast." },
  { key: "mfa",        name: "MFA Gate",        hp: 3, atk: 2, domain: "ACCESS", color: 0xfacc15, rarity: "common", flavor: "Two factors, no entry." },
  { key: "aes256",     name: "AES-256 Vault",   hp: 1, atk: 5, domain: "CRYPTO", color: 0xa78bfa, rarity: "common", flavor: "Glass cannon cipher." },
  { key: "siem",       name: "SIEM",            hp: 3, atk: 3, domain: "OPS",    color: 0x4ade80, rarity: "common", flavor: "Eyes on every log." },
  { key: "edr",        name: "EDR Agent",       hp: 4, atk: 2, domain: "SYS",    color: 0x34d399, rarity: "common", flavor: "Kills endpoint threats." },
  { key: "vlan",       name: "VLAN Mesh",       hp: 5, atk: 1, domain: "NET",    color: 0x60a5fa, rarity: "common", flavor: "Segment everything." },
  { key: "backup",     name: "Snapshot Vault",  hp: 6, atk: 0, domain: "IR",     color: 0xfb923c, rarity: "common", flavor: "Pure tank, zero teeth." },
  { key: "patches",    name: "Patch Cycle",     hp: 2, atk: 4, domain: "OPS",    color: 0x4ade80, rarity: "common", flavor: "Tuesday is your day." },
  { key: "ztrust",     name: "Zero-Trust",      hp: 3, atk: 3, domain: "ACCESS", color: 0xfacc15, rarity: "common", flavor: "Never trust, verify." },
  { key: "soc",        name: "SOC Analyst",     hp: 2, atk: 4, domain: "RISK",   color: 0xf472b6, rarity: "common", flavor: "Human in the loop." },
  { key: "waf",        name: "WAF Shield",      hp: 5, atk: 2, domain: "NET",    color: 0x60a5fa, rarity: "common", flavor: "Filters every request." },
  { key: "ir",         name: "IR Playbook",     hp: 3, atk: 3, domain: "IR",     color: 0xfb923c, rarity: "common", flavor: "Cool heads, fast hands." },
  // Rares
  { key: "honeypot",   name: "Honeypot",        hp: 1, atk: 7, domain: "RISK",   color: 0xfb7185, rarity: "rare",   flavor: "Bait once, strike hard." },
  { key: "pki",        name: "PKI Authority",   hp: 3, atk: 5, domain: "CRYPTO", color: 0xc084fc, rarity: "rare",   flavor: "Trust roots run deep." },
  { key: "soar",       name: "SOAR Orchestrator", hp: 4, atk: 4, domain: "OPS",  color: 0x86efac, rarity: "rare",   flavor: "Automate the parry." },
  { key: "ztna",       name: "ZTNA Broker",     hp: 5, atk: 3, domain: "ACCESS", color: 0xfde047, rarity: "rare",   flavor: "Gate every session." },
  { key: "deception",  name: "Deception Grid",  hp: 6, atk: 2, domain: "RISK",   color: 0xf472b6, rarity: "rare",   flavor: "Make them chase ghosts." },
];

const COMMONS = CARD_POOL.filter((c) => c.rarity === "common");
const RARES = CARD_POOL.filter((c) => c.rarity === "rare");

// ----------------------- Exploit pool -----------------------

interface ExploitDef {
  key: string;
  name: string;
  hp: number;
  atk: number;
  color: number;
}

// Three tiers — earlier waves draw from EARLY, mid from MID, late from LATE.
const EARLY_EXPLOITS: ExploitDef[] = [
  { key: "brute",     name: "Brute Force",     hp: 4,  atk: 4,  color: 0xef4444 },
  { key: "phish",     name: "Phishing Net",    hp: 5,  atk: 5,  color: 0xf97316 },
  { key: "sqli",      name: "SQL Injection",   hp: 6,  atk: 5,  color: 0xfb7185 },
  { key: "drive_by",  name: "Drive-By Download",hp: 4, atk: 6,  color: 0xe11d48 },
];
const MID_EXPLOITS: ExploitDef[] = [
  { key: "ransom",    name: "Ransomware",      hp: 8,  atk: 8,  color: 0xb91c1c },
  { key: "priv_esc",  name: "Privilege Escalation", hp: 9, atk: 7, color: 0xa21caf },
  { key: "creds",     name: "Credential Stuffing", hp: 7, atk: 9, color: 0xc026d3 },
  { key: "lateral",   name: "Lateral Movement",hp: 10, atk: 7,  color: 0x9333ea },
];
const LATE_EXPLOITS: ExploitDef[] = [
  { key: "zero_day",  name: "Zero-Day",        hp: 11, atk: 11, color: 0x7c3aed },
  { key: "apt",       name: "APT Campaign",    hp: 14, atk: 10, color: 0x6d28d9 },
  { key: "supply",    name: "Supply Chain",    hp: 12, atk: 12, color: 0x5b21b6 },
];

// ----------------------- Persistent state -----------------------

interface CardInstance {
  key: string;          // matches a CardDef.key
  hp: number;
  maxHp: number;
}

interface PersistentState {
  questionsAnswered: number;
  infraHp: number;
  infraMaxHp: number;
  field: (CardInstance | null)[]; // length FIELD_SLOTS
  correctAnswers: number;
  exploitsDefeated: number;
}

// ----------------------- Layout -----------------------

const FIELD_Y = 280;
const FIELD_CARD_W = 168;
const FIELD_CARD_H = 220;
const FIELD_GAP = 28;

const EXPLOIT_X = GAME_WIDTH - 180;
const EXPLOIT_Y = 165;

// ----------------------- Phases -----------------------

type Phase =
  | "question"
  | "resolveCorrect"
  | "resolveWrong"
  | "draft"
  | "feedback"
  | "gameOver";

// ----------------------- Scene -----------------------

export class PatchTuesdayScene extends Phaser.Scene {
  private state!: PersistentState;

  private question!: Question;
  private recordAnswer!: (idx: number) => Promise<AnswerResult>;
  private onComplete!: () => void;
  private abortRun!: () => void;
  private answerResult: AnswerResult | null = null;
  private phase: Phase = "question";

  private layerWorld!: Phaser.GameObjects.Container;
  private layerField!: Phaser.GameObjects.Container;
  private layerEffects!: Phaser.GameObjects.Container;
  private layerUi!: Phaser.GameObjects.Container;
  private layerPanel!: Phaser.GameObjects.Container;

  // HUD
  private infraBar!: Phaser.GameObjects.Rectangle;
  private infraText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private deckText!: Phaser.GameObjects.Text;

  // Field card visuals (built fresh each refresh)
  private fieldVisuals: Phaser.GameObjects.Container[] = [];
  private slotMarkers: Phaser.GameObjects.Rectangle[] = [];

  // Current exploit visual
  private exploitContainer: Phaser.GameObjects.Container | null = null;
  private currentExploit: ExploitDef | null = null;

  private panel: Phaser.GameObjects.Container | null = null;

  constructor() {
    super({ key: "PatchTuesdayScene" });
  }

  init(data: SceneData) {
    if (!data || !data.question) return;
    this.question = data.question;
    this.recordAnswer = data.recordAnswer;
    this.onComplete = data.onComplete;
    this.abortRun = data.abortRun;
    this.answerResult = null;
    this.phase = "question";
    this.fieldVisuals = [];
    this.slotMarkers = [];
    this.exploitContainer = null;
    this.currentExploit = null;
    this.panel = null;
  }

  create() {
    if (!this.question) return;
    this.cameras.main.setBackgroundColor("#04060f");
    this.loadOrInitState();

    this.layerWorld = this.add.container(0, 0);
    this.layerField = this.add.container(0, 0);
    this.layerEffects = this.add.container(0, 0);
    this.layerUi = this.add.container(0, 0);
    this.layerPanel = this.add.container(0, 0);

    this.drawBackdrop();
    this.drawHud();
    this.refreshField();
    this.spawnExploitForWave();

    this.startQuestion();
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
      infraHp: INFRA_MAX_HP,
      infraMaxHp: INFRA_MAX_HP,
      field: Array.from({ length: FIELD_SLOTS }, () => null),
      correctAnswers: 0,
      exploitsDefeated: 0,
    };
    this.registry.set(REGISTRY_KEY, this.state);
  }

  private saveState() {
    this.registry.set(REGISTRY_KEY, this.state);
  }

  // ----------------------- Backdrop -----------------------

  private drawBackdrop() {
    // Dark gradient sky with subtle circuit-board grid suggesting infra under siege.
    const bg = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x06091a, 1).setOrigin(0, 0);
    this.layerWorld.add(bg);

    // Horizon strip behind the field.
    const horizon = this.add
      .rectangle(0, FIELD_Y - FIELD_CARD_H / 2 - 14, GAME_WIDTH, 2, 0x6d28d9, 0.7)
      .setOrigin(0, 0);
    const horizonGlow = this.add
      .rectangle(0, FIELD_Y - FIELD_CARD_H / 2 - 30, GAME_WIDTH, 30, 0x6d28d9, 0.08)
      .setOrigin(0, 0);
    this.layerWorld.add([horizonGlow, horizon]);

    // Faint grid lines across the field strip.
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x1f2937, 0.6);
    const stripTop = FIELD_Y - FIELD_CARD_H / 2 - 12;
    const stripBot = FIELD_Y + FIELD_CARD_H / 2 + 8;
    for (let x = 0; x <= GAME_WIDTH; x += 40) {
      grid.lineBetween(x, stripTop, x, stripBot);
    }
    for (let y = stripTop; y <= stripBot; y += 32) {
      grid.lineBetween(0, y, GAME_WIDTH, y);
    }
    this.layerWorld.add(grid);

    // Slot markers (drawn behind cards).
    const totalFieldW = FIELD_CARD_W * FIELD_SLOTS + FIELD_GAP * (FIELD_SLOTS - 1);
    const startX = (GAME_WIDTH - 360 - totalFieldW) / 2; // shift left a bit to leave room for the exploit on the right
    for (let i = 0; i < FIELD_SLOTS; i++) {
      const x = startX + i * (FIELD_CARD_W + FIELD_GAP) + FIELD_CARD_W / 2;
      const marker = this.add
        .rectangle(x, FIELD_Y, FIELD_CARD_W + 6, FIELD_CARD_H + 6, 0x111827, 0.6)
        .setStrokeStyle(2, 0x334155, 0.7);
      this.layerWorld.add(marker);
      this.slotMarkers.push(marker);
    }

    // Title plate.
    const titlePlate = this.add
      .text(GAME_WIDTH / 2, 14, "PATCH TUESDAY", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#7af0ff",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0);
    this.layerWorld.add(titlePlate);
  }

  // ----------------------- HUD -----------------------

  private drawHud() {
    const barY = 38;
    const barH = 22;
    const barX = 24;
    const barW = 420;

    const bg = this.add
      .rectangle(barX, barY, barW, barH, 0x1b0f0f, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x475569);
    this.infraBar = this.add
      .rectangle(barX + 2, barY + 2, (barW - 4) * this.infraPct(), barH - 4, 0x4ade80, 1)
      .setOrigin(0, 0);
    const label = this.add
      .text(barX + 10, barY + barH / 2, "INFRA", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#cbd5f5",
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5);
    this.infraText = this.add
      .text(barX + barW - 10, barY + barH / 2, `${this.state.infraHp} / ${this.state.infraMaxHp}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#f1f5f9",
        fontStyle: "bold",
      })
      .setOrigin(1, 0.5);

    this.waveText = this.add
      .text(GAME_WIDTH / 2, barY + barH / 2, this.waveLabel(), {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#7af0ff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.deckText = this.add
      .text(GAME_WIDTH - 24, barY + barH / 2, this.deckLabel(), {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#cbd5f5",
        fontStyle: "bold",
      })
      .setOrigin(1, 0.5);

    this.layerUi.add([bg, this.infraBar, label, this.infraText, this.waveText, this.deckText]);
  }

  private updateHud() {
    const barX = 24;
    const barW = 420;
    this.infraBar.setSize((barW - 4) * this.infraPct(), 18);
    // Recolor as HP drops.
    const pct = this.infraPct();
    const color = pct > 0.6 ? 0x4ade80 : pct > 0.3 ? 0xfacc15 : 0xef4444;
    this.infraBar.setFillStyle(color, 1);
    this.infraText.setText(`${Math.max(0, this.state.infraHp)} / ${this.state.infraMaxHp}`);
    this.waveText.setText(this.waveLabel());
    this.deckText.setText(this.deckLabel());
    // Reposition fill since setSize keeps origin top-left.
    this.infraBar.setPosition(barX + 2, 40);
  }

  private infraPct(): number {
    return Math.max(0, Math.min(1, this.state.infraHp / this.state.infraMaxHp));
  }

  private waveLabel(): string {
    return `WAVE ${this.state.questionsAnswered + 1}`;
  }

  private deckLabel(): string {
    const live = this.state.field.filter((c) => c !== null).length;
    return `FIELD ${live}/${FIELD_SLOTS}  ·  DEFEATED ${this.state.exploitsDefeated}`;
  }

  // ----------------------- Field rendering -----------------------

  private slotX(idx: number): number {
    const totalFieldW = FIELD_CARD_W * FIELD_SLOTS + FIELD_GAP * (FIELD_SLOTS - 1);
    const startX = (GAME_WIDTH - 360 - totalFieldW) / 2;
    return startX + idx * (FIELD_CARD_W + FIELD_GAP) + FIELD_CARD_W / 2;
  }

  private refreshField() {
    for (const v of this.fieldVisuals) v.destroy();
    this.fieldVisuals = [];
    for (let i = 0; i < FIELD_SLOTS; i++) {
      const inst = this.state.field[i];
      const x = this.slotX(i);
      if (!inst) {
        // Draw an empty slot label.
        const empty = this.add.container(x, FIELD_Y);
        const txt = this.add
          .text(0, 0, "EMPTY SLOT", {
            fontFamily: "system-ui, sans-serif",
            fontSize: "11px",
            color: "#475569",
            fontStyle: "bold",
          })
          .setOrigin(0.5);
        empty.add(txt);
        this.layerField.add(empty);
        this.fieldVisuals.push(empty);
        continue;
      }
      const def = CARD_POOL.find((c) => c.key === inst.key);
      if (!def) continue;
      const c = this.makeFieldCard(x, FIELD_Y, def, inst);
      this.layerField.add(c);
      this.fieldVisuals.push(c);
    }
  }

  private makeFieldCard(x: number, y: number, def: CardDef, inst: CardInstance): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const w = FIELD_CARD_W;
    const h = FIELD_CARD_H;

    const bg = this.add
      .rectangle(0, 0, w, h, 0x0e1430, 0.96)
      .setStrokeStyle(3, def.color);
    const topStripe = this.add.rectangle(0, -h / 2 + 14, w - 12, 4, def.color, 0.95);
    const nameLabel = this.add
      .text(0, -h / 2 + 30, def.name, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#f1f5f9",
        fontStyle: "bold",
        align: "center",
        wordWrap: { width: w - 16 },
      })
      .setOrigin(0.5, 0);
    const domainLabel = this.add
      .text(0, -h / 2 + 56 + nameLabel.height, def.domain, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "10px",
        color: "#7af0ff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    if (def.rarity === "rare") {
      domainLabel.setText(`★ ${def.domain} ★`);
      domainLabel.setColor("#facc15");
    }
    // Stats: HP and ATK
    const statY = h / 2 - 38;
    const hpBox = this.add
      .rectangle(-w / 2 + 32, statY, 40, 28, 0x111827, 0.95)
      .setStrokeStyle(1, 0x4ade80);
    const hpLabel = this.add
      .text(-w / 2 + 32, statY - 10, "HP", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "9px",
        color: "#86efac",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const hpVal = this.add
      .text(-w / 2 + 32, statY + 5, `${inst.hp}/${inst.maxHp}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#f1f5f9",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const atkBox = this.add
      .rectangle(w / 2 - 32, statY, 40, 28, 0x111827, 0.95)
      .setStrokeStyle(1, 0xfb923c);
    const atkLabel = this.add
      .text(w / 2 - 32, statY - 10, "ATK", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "9px",
        color: "#fdba74",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const atkVal = this.add
      .text(w / 2 - 32, statY + 5, `${def.atk}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#f1f5f9",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const flavor = this.add
      .text(0, 6, def.flavor, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "10px",
        color: "#94a3b8",
        align: "center",
        wordWrap: { width: w - 22 },
        fontStyle: "italic",
      })
      .setOrigin(0.5);

    c.add([bg, topStripe, nameLabel, domainLabel, flavor, hpBox, hpLabel, hpVal, atkBox, atkLabel, atkVal]);

    // Damage tint when below half HP.
    if (inst.hp <= inst.maxHp / 2) {
      bg.setFillStyle(0x2a0d0d, 0.96);
    }

    return c;
  }

  // ----------------------- Exploit -----------------------

  private pickExploitDef(wave: number): ExploitDef {
    let pool = EARLY_EXPLOITS;
    if (wave >= 21) pool = LATE_EXPLOITS;
    else if (wave >= 11) pool = MID_EXPLOITS;
    // Deterministic-ish: rotate by wave + question id mod pool length so each fight differs.
    const idx = (wave + (this.question?.id ?? 0)) % pool.length;
    return pool[idx];
  }

  private spawnExploitForWave() {
    const wave = this.state.questionsAnswered + 1;
    const def = this.pickExploitDef(wave);
    this.currentExploit = def;
    this.drawExploit(def);
  }

  private drawExploit(def: ExploitDef) {
    if (this.exploitContainer) this.exploitContainer.destroy();
    const c = this.add.container(GAME_WIDTH + 200, EXPLOIT_Y);

    // Menacing red diamond + skull-ish text label.
    const glow = this.add.circle(0, 0, 80, def.color, 0.18);
    const ring = this.add.circle(0, 0, 56, def.color, 0).setStrokeStyle(3, def.color, 0.9);
    const core = this.add.rectangle(0, 0, 60, 60, def.color, 1).setAngle(45);
    const inner = this.add.rectangle(0, 0, 28, 28, 0x0b0b0b, 1).setAngle(45);

    const nameTxt = this.add
      .text(0, 56, def.name, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#fecaca",
        fontStyle: "bold",
        align: "center",
        wordWrap: { width: 180 },
      })
      .setOrigin(0.5);
    const statTxt = this.add
      .text(0, 56 + nameTxt.height + 4, `HP ${def.hp}   ATK ${def.atk}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#fca5a5",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    c.add([glow, ring, core, inner, nameTxt, statTxt]);
    this.layerEffects.add(c);
    this.exploitContainer = c;

    // Roll in.
    this.tweens.add({
      targets: c,
      x: EXPLOIT_X,
      duration: 500,
      ease: "Cubic.easeOut",
    });
    this.tweens.add({
      targets: ring,
      angle: 360,
      duration: 4000,
      repeat: -1,
    });
    this.tweens.add({
      targets: glow,
      alpha: 0.32,
      yoyo: true,
      repeat: -1,
      duration: 900,
      ease: "Sine.easeInOut",
    });
  }

  // ----------------------- Phase: question -----------------------

  private startQuestion() {
    this.phase = "question";
    this.clearPanel();

    const panel = this.add.container(0, 0);

    // Stem panel
    const stemBoxW = 980;
    const padTop = 14;
    const padBottom = 16;
    const labelGap = 12;
    const labelH = 14;

    const stem = this.add
      .text(0, 0, this.question.stem, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#f1f5f9",
        align: "center",
        wordWrap: { width: stemBoxW - 56 },
        lineSpacing: 4,
      })
      .setOrigin(0.5, 0);
    const stemH = stem.height;

    // Measure answer cards
    const cardW = 224;
    const optionFontPx = 13;
    const optionWrapW = cardW - 28;
    const optionPadTop = 28;
    const optionPadBottom = 14;
    const minCardH = 90;
    const maxCardH = 110;
    let tallest = 0;
    const probes: Phaser.GameObjects.Text[] = [];
    for (const opt of this.question.options) {
      const p = this.add
        .text(0, 0, opt, {
          fontFamily: "system-ui, sans-serif",
          fontSize: `${optionFontPx}px`,
          color: "#f1f5f9",
          align: "center",
          wordWrap: { width: optionWrapW },
          lineSpacing: 3,
        })
        .setVisible(false);
      probes.push(p);
      if (p.height > tallest) tallest = p.height;
    }
    for (const p of probes) p.destroy();
    const cardH = Phaser.Math.Clamp(tallest + optionPadTop + optionPadBottom, minCardH, maxCardH);

    const optionBottomMargin = 14;
    const optionY = GAME_HEIGHT - cardH / 2 - optionBottomMargin;
    const optionTopY = optionY - cardH / 2;

    const bandTop = FIELD_Y + FIELD_CARD_H / 2 + 24;
    const bandBottom = optionTopY - 12;
    const computedBoxH = padTop + labelH + labelGap + stemH + padBottom;
    const stemBoxH = Phaser.Math.Clamp(computedBoxH, 80, bandBottom - bandTop);
    const boxTop = bandTop;
    const stemBoxY = boxTop + stemBoxH / 2;

    const stemBg = this.add
      .rectangle(GAME_WIDTH / 2, stemBoxY, stemBoxW, stemBoxH, 0x0a0d1f, 0.96)
      .setStrokeStyle(2, 0x7af0ff, 0.7);
    const stemLabel = this.add
      .text(GAME_WIDTH / 2, boxTop + padTop + labelH / 2, "PATCH DECISION", {
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
      .text(-w / 2 + 22, -h / 2 + 10, labels[idx], {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: "#cbd5f5",
        fontStyle: "bold",
      })
      .setOrigin(0, 0);
    const body = this.add
      .text(0, 6, text, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
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
      this.state.correctAnswers += 1;
      this.startResolveCorrect();
    } else {
      this.startResolveWrong();
    }
  }

  // ----------------------- Phase: resolveCorrect (autobattle visualization) -----------------------

  private startResolveCorrect() {
    this.phase = "resolveCorrect";
    this.clearPanel();

    // Banner
    const panel = this.add.container(0, 0);
    const banner = this.add
      .rectangle(GAME_WIDTH / 2, 86, GAME_WIDTH - 280, 40, 0x0a2818, 0.94)
      .setStrokeStyle(1, 0x4ade80, 0.9);
    const txt = this.add
      .text(GAME_WIDTH / 2, 86, "DEFENSES HOLD  ·  FIELD STRIKES", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: "#4ade80",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    panel.add([banner, txt]);
    this.layerPanel.add(panel);
    this.panel = panel;

    // Each live card on the field zaps the exploit in order. Brief stagger.
    const liveSlots: number[] = [];
    for (let i = 0; i < FIELD_SLOTS; i++) {
      if (this.state.field[i]) liveSlots.push(i);
    }

    if (liveSlots.length === 0) {
      // No cards: a "first strike" anyway, since correct answer alone defeats the exploit narratively.
      this.time.delayedCall(380, () => this.finishExploitDeath());
      return;
    }

    let delay = 240;
    for (const slot of liveSlots) {
      const inst = this.state.field[slot]!;
      const def = CARD_POOL.find((c) => c.key === inst.key);
      const atk = def?.atk ?? 0;
      this.time.delayedCall(delay, () => {
        this.animateFieldStrike(slot, atk);
      });
      delay += 240;
    }
    this.time.delayedCall(delay + 320, () => this.finishExploitDeath());
  }

  private animateFieldStrike(slot: number, atk: number) {
    const sourceX = this.slotX(slot);
    const sourceY = FIELD_Y;
    const targetX = this.exploitContainer?.x ?? EXPLOIT_X;
    const targetY = this.exploitContainer?.y ?? EXPLOIT_Y;

    // Card jiggle.
    const v = this.fieldVisuals[slot];
    if (v) {
      this.tweens.add({
        targets: v,
        scale: { from: 1, to: 1.06 },
        yoyo: true,
        duration: 120,
        ease: "Quad.easeOut",
      });
    }

    // Projectile bolt: a glowing dash from card to exploit.
    const def = CARD_POOL.find((c) => c.key === this.state.field[slot]?.key);
    const color = def?.color ?? 0x7af0ff;
    const bolt = this.add.rectangle(sourceX, sourceY, 22, 6, color, 1);
    bolt.setBlendMode(Phaser.BlendModes.ADD);
    this.layerEffects.add(bolt);
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    bolt.setRotation(Math.atan2(dy, dx));

    this.tweens.add({
      targets: bolt,
      x: targetX,
      y: targetY,
      duration: 220,
      ease: "Cubic.easeIn",
      onComplete: () => {
        bolt.destroy();
        this.flashAt(targetX, targetY, color);
        if (this.exploitContainer) {
          this.tweens.add({
            targets: this.exploitContainer,
            x: { from: targetX + 8, to: targetX },
            duration: 90,
            yoyo: true,
          });
        }
        this.popDamageNumber(targetX, targetY - 36, `-${atk}`, "#86efac");
      },
    });
  }

  private finishExploitDeath() {
    // Tally and animate the exploit collapse.
    const exploit = this.currentExploit;
    if (exploit) this.state.exploitsDefeated += 1;
    this.state.questionsAnswered += 1;
    this.saveState();
    this.updateHud();

    if (this.exploitContainer) {
      const c = this.exploitContainer;
      this.tweens.add({
        targets: c,
        scale: 0.2,
        alpha: 0,
        angle: 180,
        duration: 380,
        ease: "Quad.easeIn",
        onComplete: () => c.destroy(),
      });
      this.exploitContainer = null;
    }

    // After the death animation, go to draft.
    this.time.delayedCall(440, () => this.startDraft());
  }

  // ----------------------- Phase: resolveWrong (exploit attack) -----------------------

  private startResolveWrong() {
    this.phase = "resolveWrong";
    this.clearPanel();

    const panel = this.add.container(0, 0);
    const banner = this.add
      .rectangle(GAME_WIDTH / 2, 86, GAME_WIDTH - 280, 40, 0x2a0d0d, 0.94)
      .setStrokeStyle(1, 0xef4444, 0.9);
    const txt = this.add
      .text(GAME_WIDTH / 2, 86, "BREACH  ·  EXPLOIT LANDS", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: "#fca5a5",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    panel.add([banner, txt]);
    this.layerPanel.add(panel);
    this.panel = panel;

    const exploit = this.currentExploit;
    if (!exploit) {
      this.time.delayedCall(300, () => this.finishWrongResolution());
      return;
    }

    // Lunge animation: exploit charges toward the field, then settles.
    let damageRemaining = exploit.atk;
    const targetCharge = this.slotX(0);
    if (this.exploitContainer) {
      this.tweens.add({
        targets: this.exploitContainer,
        x: targetCharge + 200,
        duration: 280,
        ease: "Cubic.easeIn",
      });
    }

    this.time.delayedCall(320, () => {
      // Distribute damage from leftmost slot rightward; overflow -> Infra HP.
      for (let i = 0; i < FIELD_SLOTS && damageRemaining > 0; i++) {
        const inst = this.state.field[i];
        if (!inst) continue;
        const dealt = Math.min(damageRemaining, inst.hp);
        inst.hp -= dealt;
        damageRemaining -= dealt;
        this.popDamageNumber(this.slotX(i), FIELD_Y - 100, `-${dealt}`, "#fca5a5");
        // Flash the card.
        const v = this.fieldVisuals[i];
        if (v) {
          this.tweens.add({
            targets: v,
            scale: { from: 1, to: 0.92 },
            yoyo: true,
            duration: 160,
          });
        }
        if (inst.hp <= 0) {
          this.state.field[i] = null;
        }
      }
      if (damageRemaining > 0) {
        this.state.infraHp = Math.max(0, this.state.infraHp - damageRemaining);
        this.popDamageNumber(120, 56, `-${damageRemaining}`, "#fca5a5");
        this.cameras.main.shake(220, 0.012);
      } else {
        this.cameras.main.shake(80, 0.004);
      }
      this.state.questionsAnswered += 1;
      this.saveState();
      this.refreshField();
      this.updateHud();

      // Drift the exploit off-screen as a "spent" attack.
      if (this.exploitContainer) {
        const c = this.exploitContainer;
        this.tweens.add({
          targets: c,
          x: -200,
          alpha: 0.2,
          duration: 460,
          ease: "Cubic.easeIn",
          onComplete: () => c.destroy(),
        });
        this.exploitContainer = null;
      }

      this.time.delayedCall(520, () => this.finishWrongResolution());
    });
  }

  private finishWrongResolution() {
    if (this.state.infraHp <= 0) {
      this.startGameOver();
      return;
    }
    this.startFeedback();
  }

  // ----------------------- Phase: draft -----------------------

  private rollDraft(): CardDef[] {
    const includeRare = this.state.correctAnswers > 0 && this.state.correctAnswers % RARE_EVERY === 0;
    const picks: CardDef[] = [];
    const usedKeys = new Set<string>();
    if (includeRare && RARES.length > 0) {
      const r = RARES[Math.floor(Math.random() * RARES.length)];
      picks.push(r);
      usedKeys.add(r.key);
    }
    while (picks.length < DRAFT_CHOICES) {
      const c = COMMONS[Math.floor(Math.random() * COMMONS.length)];
      if (usedKeys.has(c.key)) continue;
      usedKeys.add(c.key);
      picks.push(c);
    }
    return Phaser.Utils.Array.Shuffle(picks);
  }

  private startDraft() {
    this.phase = "draft";
    this.clearPanel();
    const choices = this.rollDraft();

    const panel = this.add.container(0, 0);
    const dim = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x04060f, 0.55)
      .setOrigin(0.5);
    panel.add(dim);

    const title = this.add
      .text(GAME_WIDTH / 2, 110, "DRAFT A PATCH", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "24px",
        color: "#7af0ff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(GAME_WIDTH / 2, 138, "Pick a card to deploy. It replaces the leftmost empty slot, or click a slot to overwrite.", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#cbd5f5",
        align: "center",
        wordWrap: { width: 760 },
      })
      .setOrigin(0.5);
    panel.add([title, sub]);

    // Three large card buttons centered horizontally.
    const cardW = 220;
    const cardH = 280;
    const gap = 28;
    const totalW = cardW * choices.length + gap * (choices.length - 1);
    const startX = (GAME_WIDTH - totalW) / 2;
    const cardY = GAME_HEIGHT / 2 + 10;

    choices.forEach((def, i) => {
      const x = startX + i * (cardW + gap) + cardW / 2;
      const card = this.makeDraftCard(x, cardY, cardW, cardH, def);
      panel.add(card);
    });

    // Skip button
    const skipY = GAME_HEIGHT - 50;
    const skipBg = this.add
      .rectangle(GAME_WIDTH / 2, skipY, 160, 36, 0x1f2937, 0.9)
      .setStrokeStyle(1, 0x64748b);
    const skipTxt = this.add
      .text(GAME_WIDTH / 2, skipY, "Skip Draft", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#cbd5f5",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const skipHit = this.add.zone(GAME_WIDTH / 2, skipY, 160, 36).setOrigin(0.5);
    skipHit.setInteractive({ useHandCursor: true });
    skipHit.on("pointerover", () => skipBg.setFillStyle(0x334155));
    skipHit.on("pointerout", () => skipBg.setFillStyle(0x1f2937));
    skipHit.on("pointerdown", () => this.startFeedback());
    panel.add([skipBg, skipTxt, skipHit]);

    this.layerPanel.add(panel);
    this.panel = panel;
  }

  private makeDraftCard(x: number, y: number, w: number, h: number, def: CardDef): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const isRare = def.rarity === "rare";
    const stroke = isRare ? 0xfacc15 : def.color;

    const bg = this.add
      .rectangle(0, 0, w, h, 0x0a0d1f, 0.97)
      .setStrokeStyle(isRare ? 4 : 3, stroke);
    const stripe = this.add.rectangle(0, -h / 2 + 18, w - 16, 6, def.color, 1);

    const rarityLabel = this.add
      .text(0, -h / 2 + 32, isRare ? "★ RARE ★" : def.domain, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: isRare ? "#facc15" : "#7af0ff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const name = this.add
      .text(0, -h / 2 + 58, def.name, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#f1f5f9",
        fontStyle: "bold",
        align: "center",
        wordWrap: { width: w - 22 },
      })
      .setOrigin(0.5, 0);

    const flavor = this.add
      .text(0, 0, def.flavor, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "#94a3b8",
        align: "center",
        wordWrap: { width: w - 30 },
        fontStyle: "italic",
      })
      .setOrigin(0.5);

    const statY = h / 2 - 56;
    const hpBox = this.add
      .rectangle(-w / 2 + 50, statY, 70, 44, 0x111827, 0.95)
      .setStrokeStyle(2, 0x4ade80);
    const hpLabel = this.add
      .text(-w / 2 + 50, statY - 12, "HP", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "10px",
        color: "#86efac",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const hpVal = this.add
      .text(-w / 2 + 50, statY + 8, `${def.hp}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#f1f5f9",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const atkBox = this.add
      .rectangle(w / 2 - 50, statY, 70, 44, 0x111827, 0.95)
      .setStrokeStyle(2, 0xfb923c);
    const atkLabel = this.add
      .text(w / 2 - 50, statY - 12, "ATK", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "10px",
        color: "#fdba74",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const atkVal = this.add
      .text(w / 2 - 50, statY + 8, `${def.atk}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#f1f5f9",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    c.add([bg, stripe, rarityLabel, name, flavor, hpBox, hpLabel, hpVal, atkBox, atkLabel, atkVal]);

    const hit = this.add.zone(0, 0, w, h).setOrigin(0.5);
    hit.setInteractive({ useHandCursor: true });
    c.add(hit);
    hit.on("pointerover", () => {
      bg.setFillStyle(0x172040, 0.97);
      this.tweens.add({ targets: c, scale: 1.04, duration: 110 });
    });
    hit.on("pointerout", () => {
      bg.setFillStyle(0x0a0d1f, 0.97);
      this.tweens.add({ targets: c, scale: 1, duration: 110 });
    });
    hit.on("pointerdown", () => {
      hit.disableInteractive();
      this.onDraftPicked(def);
    });
    return c;
  }

  private onDraftPicked(def: CardDef) {
    // Place into first empty slot; if all full, replace the lowest-HP card.
    let slot = this.state.field.findIndex((c) => c === null);
    if (slot < 0) {
      // Replace lowest HP card.
      let lowestIdx = 0;
      let lowestHp = Infinity;
      for (let i = 0; i < FIELD_SLOTS; i++) {
        const inst = this.state.field[i];
        if (inst && inst.hp < lowestHp) {
          lowestHp = inst.hp;
          lowestIdx = i;
        }
      }
      slot = lowestIdx;
    }
    const newInst: CardInstance = { key: def.key, hp: def.hp, maxHp: def.hp };
    this.state.field[slot] = newInst;
    this.saveState();
    this.refreshField();
    this.updateHud();

    // Brief drop-in animation on the slot.
    const v = this.fieldVisuals[slot];
    if (v) {
      v.setScale(0.6);
      this.tweens.add({
        targets: v,
        scale: 1,
        duration: 220,
        ease: "Back.easeOut",
      });
      this.flashAt(this.slotX(slot), FIELD_Y, def.color);
    }

    this.startFeedback();
  }

  // ----------------------- Phase: feedback -----------------------

  private startFeedback() {
    this.phase = "feedback";
    this.clearPanel();

    const result = this.answerResult ?? { correct: false, correct_index: -1, explanation: "" };
    const title = result.correct ? "PATCH APPLIED" : "EXPLOIT LANDED";
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

    const liveCards = this.state.field.filter((c) => c !== null).length;
    const stats = this.add
      .text(
        0,
        0,
        `Wave ${this.state.questionsAnswered}  ·  Field ${liveCards}/${FIELD_SLOTS}  ·  Exploits defeated ${this.state.exploitsDefeated}`,
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
    const gapTitleAns = 14;
    const gapAnsExp = 16;
    const gapExpStats = 20;
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
    this.layerPanel.add(panel);
    this.panel = panel;

    this.input.keyboard?.once("keydown-SPACE", () => {
      if (this.phase === "feedback") this.onComplete();
    });
  }

  // ----------------------- Phase: game over -----------------------

  private startGameOver() {
    this.phase = "gameOver";
    this.clearPanel();

    const panel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    const bg = this.add
      .rectangle(0, 0, 560, 260, 0x0a0d1f, 0.98)
      .setStrokeStyle(2, 0xef4444);
    const titleText = this.add
      .text(0, -92, "INFRA OFFLINE", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "28px",
        color: "#ef4444",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(
        0,
        -46,
        `Defenses collapsed on wave ${this.state.questionsAnswered + 1}. Restart to rebuild your patch deck.`,
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
        2,
        `Exploits defeated: ${this.state.exploitsDefeated}   ·   Correct answers: ${this.state.correctAnswers}`,
        {
          fontFamily: "system-ui, sans-serif",
          fontSize: "12px",
          color: "#94a3b8",
        },
      )
      .setOrigin(0.5);

    const btnBg = this.add
      .rectangle(0, 78, 220, 40, 0xef4444, 1)
      .setStrokeStyle(1, 0xfecaca);
    const btnText = this.add
      .text(0, 78, "End Run ▶", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const btnHit = this.add.zone(0, 78, 220, 40).setOrigin(0.5);
    btnHit.setInteractive({ useHandCursor: true });
    btnHit.on("pointerover", () => btnBg.setFillStyle(0xdc2626));
    btnHit.on("pointerout", () => btnBg.setFillStyle(0xef4444));
    btnHit.on("pointerdown", () => {
      this.registry.remove(REGISTRY_KEY);
      this.abortRun();
    });

    panel.add([bg, titleText, subtitle, stats, btnBg, btnText, btnHit]);
    this.layerPanel.add(panel);
    this.panel = panel;

    this.input.keyboard?.once("keydown-SPACE", () => {
      this.registry.remove(REGISTRY_KEY);
      this.abortRun();
    });
  }

  // ----------------------- Effects -----------------------

  private flashAt(x: number, y: number, color: number) {
    const ring = this.add.circle(x, y, 6, color, 0).setStrokeStyle(3, color, 1);
    this.layerEffects.add(ring);
    this.tweens.add({
      targets: ring,
      radius: 36,
      alpha: 0,
      duration: 280,
      ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  private popDamageNumber(x: number, y: number, txt: string, color: string) {
    const t = this.add
      .text(x, y, txt, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "22px",
        color,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.layerEffects.add(t);
    this.tweens.add({
      targets: t,
      y: y - 38,
      alpha: 0,
      duration: 720,
      ease: "Cubic.easeOut",
      onComplete: () => t.destroy(),
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

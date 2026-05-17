import { useRunStore } from "../store/runStore";

interface OverviewContent {
  title: string;
  tagline: string;
  accent: string;
  goal: string;
  rules: string[];
  tips?: string[];
}

const OVERVIEWS: Record<string, OverviewContent> = {
  tower_defense: {
    title: "Tower Defense: Exploit Wave",
    tagline: "Strategy · Build & defend",
    accent: "text-emerald-300 border-emerald-500",
    goal: "Hold your core alive for 30 questions while waves of exploits march down the lane.",
    rules: [
      "Read the question, then click the answer card you think is right.",
      "Correct answer → you earn a tower or upgrade and gain economy.",
      "Wrong answer → you get a weak placement and the wave gains ground.",
      "Towers auto-fire at incoming exploits between questions.",
      "If an exploit reaches the core, you lose HP. Lose all HP and the run ends.",
    ],
    tips: [
      "Streaks boost your score multiplier — don't break the chain.",
      "Tower placement persists across all 30 questions.",
    ],
  },
  rpg_boss: {
    title: "Hacker Boss Duel",
    tagline: "Roguelike · Parry the boss",
    accent: "text-rose-300 border-rose-500",
    goal: "Defeat the escalating boss before it drains your HP. Survive 30 questions and you win.",
    rules: [
      "Each question is a boss attack incoming — pick the correct answer to parry.",
      "Correct → you parry and counter-strike, damaging the boss.",
      "Wrong → the attack lands and you take damage.",
      "Every few fights you'll find a treasure chamber with relics (Sharp Edge, Vampire, Iron Stance, etc.).",
      "Boss phases unlock at 66% and 33% HP — expect heavier hits.",
    ],
    tips: [
      "Relics stack — combos like Streak Rage + Sharp Edge can carry runs.",
      "If your hero dies before Q30, the run ends early.",
    ],
  },
  vault_lockdown: {
    title: "Vault Lockdown",
    tagline: "Strategy · Hold the perimeter",
    accent: "text-cyan-300 border-cyan-500",
    goal: "Keep every attacker away from the central vault for 30 questions.",
    rules: [
      "Each run generates a fresh attack graph: spawn nodes, mid-ring relays, the vault at center.",
      "Two attackers are telegraphed before each question — they're the ones who will move.",
      "Correct answer → you place a lock on any edge you choose. Locks block movement.",
      "Wrong answer → both telegraphed attackers advance one step toward the vault.",
      "Each edge holds up to 2 locks. If every route is locked, an attacker will burn through one.",
    ],
    tips: [
      "Lock chokepoints near the vault — they protect more routes at once.",
      "If any attacker reaches the vault, the run ends.",
    ],
  },
  patch_tuesday: {
    title: "Patch Tuesday",
    tagline: "Roguelike · Deckbuilding autobattler",
    accent: "text-violet-300 border-violet-500",
    goal: "Build a deck of countermeasure cards strong enough to autobattle 30 waves of exploits.",
    rules: [
      "Each question = one wave. Pick the correct answer to draft a card from the offered choices.",
      "Wrong answer → no card, and the incoming exploit slams your infra for extra damage.",
      "Your cards (Firewall, IDS, AES-256, more) auto-battle the exploit each wave.",
      "Cards have stats, synergies, and sometimes special triggers — build around what you draft.",
      "Lose all infra HP and the run ends.",
    ],
    tips: [
      "Synergies matter — a focused deck beats a pile of random cards.",
      "Streaks compound your score, so don't punt early waves.",
    ],
  },
  asteroid_answer: {
    title: "Asteroid Answer Run",
    tagline: "Arcade · Pilot the right portal",
    accent: "text-amber-300 border-amber-500",
    goal: "Pilot your ship into the correct answer portal while dodging debris.",
    rules: [
      "Four portals approach — each shows one answer option.",
      "Steer with arrow keys / WASD into the correct portal.",
      "Correct portal → score. Wrong portal → take a hit.",
      "Asteroids in between will damage your shield if you graze them.",
    ],
  },
};

export function GameOverview() {
  const selectedGameKey = useRunStore((s) => s.selectedGameKey);
  const startRun = useRunStore((s) => s.startRun);
  const reset = useRunStore((s) => s.reset);

  const overview = OVERVIEWS[selectedGameKey];

  if (!overview) {
    void startRun();
    return null;
  }

  const onContinue = () => {
    void startRun();
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div
        className={`w-full max-w-2xl rounded-2xl border-2 bg-space-800 p-8 shadow-2xl ${overview.accent}`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
          {overview.tagline}
        </p>
        <h2 className="mt-1 text-4xl font-bold text-white">{overview.title}</h2>

        <div className="mt-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">
            Objective
          </h3>
          <p className="mt-1 text-slate-200">{overview.goal}</p>
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">
            How it works
          </h3>
          <ul className="mt-2 space-y-2 text-slate-200">
            {overview.rules.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-bold opacity-70">{i + 1}.</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        {overview.tips && overview.tips.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">
              Tips
            </h3>
            <ul className="mt-2 space-y-1 text-sm text-slate-300">
              {overview.tips.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="opacity-70">•</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={reset}
            className="rounded-xl border border-slate-600 px-5 py-2 text-sm text-slate-300 transition hover:bg-space-700"
          >
            ← Back
          </button>
          <button
            onClick={onContinue}
            className="rounded-xl bg-space-500 px-8 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-900/30 transition hover:scale-105 hover:bg-indigo-500"
          >
            Continue ▶
          </button>
        </div>
      </div>
    </div>
  );
}

import { readLocalProgress, useRunStore } from "../store/runStore";

interface GameOption {
  key: string;
  title: string;
  tagline: string;
  description: string;
  accent: string;
  available: boolean;
}

const GAMES: GameOption[] = [
  {
    key: "tower_defense",
    title: "Tower Defense",
    tagline: "Strategy · Build & defend",
    description:
      "Place towers between waves. Each correct answer earns a tower or upgrade; wrong answers give a weak placement. Hold the core for 30 waves.",
    accent: "border-emerald-500 text-emerald-300",
    available: true,
  },
  {
    key: "rpg_boss",
    title: "RPG Boss Fight",
    tagline: "Roguelike · Parry the boss",
    description:
      "Face a single escalating boss. Each attack is a question — correct = parry & counter, wrong = take damage. Discover relics that grant run-altering modifiers.",
    accent: "border-rose-500 text-rose-300",
    available: true,
  },
  {
    key: "vault_lockdown",
    title: "Vault Lockdown",
    tagline: "Strategy · Hold the perimeter",
    description:
      "Six threat paths close in on a central vault. Correct answer = place a lock on the path of your choice; wrong = attackers gain an extra step. Locks soak one hit each. Don't let any path reach the vault.",
    accent: "border-cyan-500 text-cyan-300",
    available: true,
  },
  {
    key: "patch_tuesday",
    title: "Patch Tuesday",
    tagline: "Roguelike · Deckbuilding autobattler",
    description:
      "Build a deck of countermeasure cards (Firewall, IDS, AES-256, more). Each correct answer drafts a new card; wrong answers let the exploit slam your field. Cards auto-battle the incoming exploit each wave. Hold the infra for 30 waves.",
    accent: "border-violet-500 text-violet-300",
    available: true,
  },
  {
    key: "asteroid_answer",
    title: "Asteroid Answer Run",
    tagline: "Arcade · Pilot the right portal",
    description:
      "Fly forward through space, steer your ship into the answer portal while dodging debris. Fast reaction, steady aim.",
    accent: "border-amber-500 text-amber-300",
    available: false,
  },
  {
    key: "crypto_memory",
    title: "Crypto Memory Grid",
    tagline: "Puzzle · Match term to definition",
    description:
      "Flip tiles to pair cryptography terms with their definitions. Mismatches cost time; clean memory wins runs.",
    accent: "border-sky-500 text-sky-300",
    available: false,
  },
];

export function Menu() {
  const setSelectedGame = useRunStore((s) => s.setSelectedGame);
  const selectedGameKey = useRunStore((s) => s.selectedGameKey);
  const progress = readLocalProgress();

  const onPlay = (key: string) => {
    setSelectedGame(key);
    useRunStore.setState({ phase: "overview", errorMessage: undefined });
  };

  return (
    <div className="flex h-full flex-col items-center gap-6 overflow-y-auto p-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight text-space-accent">
          SSCP Gauntlet
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-slate-300">
          Pick a game. SSCP practice questions drive every mechanic — answer right to
          win, answer wrong to bleed. Stay sharp.
        </p>
      </div>

      <div className="flex gap-6 rounded-2xl border border-slate-700 bg-space-800 px-6 py-3 text-sm text-slate-300">
        <span>
          Career XP:{" "}
          <span className="text-space-accent">{progress.totalXP.toLocaleString()}</span>
        </span>
        <span>
          Best streak: <span className="text-space-accent">{progress.bestStreak}</span>
        </span>
        <span>
          Runs: <span className="text-space-accent">{progress.runsCompleted}</span>
        </span>
      </div>

      <div className="grid w-full max-w-5xl grid-cols-1 gap-5 md:grid-cols-2">
        {GAMES.map((g) => (
          <GameCard
            key={g.key}
            game={g}
            selected={selectedGameKey === g.key}
            onSelect={() => setSelectedGame(g.key)}
            onPlay={() => onPlay(g.key)}
          />
        ))}
      </div>
    </div>
  );
}

interface GameCardProps {
  game: GameOption;
  selected: boolean;
  onSelect: () => void;
  onPlay: () => void;
}

function GameCard({ game, selected, onSelect, onPlay }: GameCardProps) {
  const ring = selected && game.available ? "ring-2 ring-space-accent" : "";
  const dimmed = game.available ? "" : "opacity-60";
  return (
    <div
      onClick={() => game.available && onSelect()}
      className={`flex flex-col gap-3 rounded-2xl border-2 bg-space-800 p-5 transition ${game.accent} ${ring} ${dimmed} ${game.available ? "cursor-pointer hover:bg-space-700" : "cursor-not-allowed"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-2xl font-bold text-white">{game.title}</h3>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
            {game.tagline}
          </p>
        </div>
        {!game.available && (
          <span className="rounded-full border border-slate-500 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            In Development
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed text-slate-300">{game.description}</p>
      <div className="mt-auto flex justify-end">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (game.available) onPlay();
          }}
          disabled={!game.available}
          className="rounded-xl bg-space-500 px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 transition hover:scale-105 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:opacity-50 disabled:hover:scale-100"
        >
          {game.available ? "▶ Play" : "Coming soon"}
        </button>
      </div>
    </div>
  );
}

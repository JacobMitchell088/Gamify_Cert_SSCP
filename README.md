# Gamify_Cert_SSCP

Gamified study site for the (ISC)² **SSCP** certification. React + Phaser frontend, FastAPI backend, free LLMs via OpenRouter for question generation. See [CLAUDE.md](./CLAUDE.md) for the full architecture and roadmap, and [GAMES.md](./GAMES.md) for the catalogue of mini-game concepts.

## Prototype status (current)

- ✅ Backend: FastAPI, SQLite question pool, seed-on-startup, `/run/*` endpoints.
- ✅ OpenRouter racer + APScheduler refill (no-ops without an API key — fine for local play).
- ✅ Frontend: Vite + React + Tailwind + Zustand + Phaser 3.
- ✅ Mini-game 1: **Asteroid Answer Run**.
- 🚧 Mini-game 2 (Crypto Memory Grid) — placeholder; rotation currently re-uses Asteroid.

## Prerequisites

- **Conda** (for the backend env).
- **Node 18+** (Node 20/22/24 all fine).

## Backend setup

```bash
cd backend
conda env create -f environment.yml
conda activate sscp-backend

# Optional: enable AI question generation
cp .env.example .env
# then edit .env and set OPENROUTER_API_KEY (free key from openrouter.ai)

# Run the API
uvicorn app.main:app --reload
```

The API serves on `http://localhost:8000`. Visit `/docs` for the OpenAPI UI.

On first start the seed JSON (14 starter questions) is loaded into a local SQLite at `backend/app/data/pool.db`. If `OPENROUTER_API_KEY` is set, a background job will start topping up the pool with AI-generated questions every 30s.

### One-time bulk seed generation (optional)

After you've configured an OpenRouter key, you can pre-fill the seed JSON with a larger batch:

```bash
cd backend
python -m scripts.generate_seed --per-domain 50
```

Then **spot-check** the additions in `app/data/seed_questions.json` before committing — LLMs hallucinate cert specifics.

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Hit **Play**.

Controls (Asteroid Answer Run): `← →` or `A / D` to steer between lanes, `SPACE` to commit your answer.

## Project layout

```
backend/    FastAPI app, SQLite pool, OpenRouter racer
frontend/   Vite + React + Phaser
CLAUDE.md   Architecture + roadmap (canonical doc)
```

## What's next

See the **Step-by-Step Build Plan** section in CLAUDE.md. Immediate next steps after testing this prototype:

1. Build mini-game #2 (Crypto Memory Grid).
2. Tune the Asteroid game (collision penalties, lives, sound).
3. Bulk-generate the seed via OpenRouter and spot-check.
4. Deploy: backend → Render free, frontend → Vercel.

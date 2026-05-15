"""One-off script: batch-generate SSCP questions via OpenRouter and APPEND to seed_questions.json.

Usage (from backend/):
    python -m scripts.generate_seed --per-domain 50

Requires OPENROUTER_API_KEY in env (or .env). Spot-check the output before committing.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.config import get_settings
from app.models import Domain
from app.services.openrouter import race_one_question
from app.services.validator import stem_hash, validate_question

SEED_PATH = Path(__file__).resolve().parent.parent / "app" / "data" / "seed_questions.json"


def _load_existing() -> tuple[list[dict], set[str]]:
    if not SEED_PATH.exists():
        return [], set()
    raw = json.loads(SEED_PATH.read_text())
    hashes = {stem_hash(q["stem"]) for q in raw}
    return raw, hashes


async def _gen_for_domain(domain: Domain, target: int, hashes: set[str]) -> list[dict]:
    out: list[dict] = []
    attempts = 0
    while len(out) < target and attempts < target * 3:
        attempts += 1
        raw = await race_one_question(domain)
        if raw is None:
            print(f"  [{domain.value}] miss ({attempts})", file=sys.stderr)
            continue
        raw.pop("_model", None)
        raw.setdefault("source", "openrouter:seed")
        q = validate_question(raw)
        if q is None:
            continue
        h = stem_hash(q.stem)
        if h in hashes:
            continue
        hashes.add(h)
        out.append(q.model_dump(mode="json"))
        print(f"  [{domain.value}] {len(out)}/{target}", file=sys.stderr)
    return out


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-domain", type=int, default=50)
    args = ap.parse_args()

    settings = get_settings()
    if not settings.openrouter_api_key:
        print("OPENROUTER_API_KEY not set", file=sys.stderr)
        sys.exit(1)
    if not settings.free_model_list:
        print("OPENROUTER_FREE_MODELS not set", file=sys.stderr)
        sys.exit(1)

    existing, hashes = _load_existing()
    print(f"existing seed size: {len(existing)}", file=sys.stderr)

    for domain in Domain:
        added = await _gen_for_domain(domain, args.per_domain, hashes)
        existing.extend(added)
        SEED_PATH.write_text(json.dumps(existing, indent=2) + "\n")
        print(f"wrote {len(existing)} total after {domain.value}", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())

import json
import logging
from pathlib import Path

from sqlmodel import Session, func, select

from ..models import Question, QuestionIn
from .validator import stem_hash

logger = logging.getLogger(__name__)

SEED_PATH = Path(__file__).resolve().parent.parent / "data" / "seed_questions.json"


def load_seed_if_empty(session: Session) -> int:
    """Load seed_questions.json into the DB if the pool is empty. Returns rows inserted.

    Idempotent: on every boot we COUNT the question table; if it already has
    rows we log and return 0 without touching anything. Safe to call repeatedly.
    """
    existing = session.exec(select(func.count()).select_from(Question)).one()
    if existing:
        logger.info("seed skip: pool already has %d questions", existing)
        return 0

    if not SEED_PATH.exists():
        logger.warning("seed file missing at %s", SEED_PATH)
        return 0

    raw = json.loads(SEED_PATH.read_text())
    logger.info("seeding empty pool from %s (%d candidates)", SEED_PATH.name, len(raw))
    inserted = 0
    for entry in raw:
        try:
            q = QuestionIn(**entry)
        except Exception as e:
            logger.warning("skipping invalid seed question: %s", e)
            continue
        h = stem_hash(q.stem)
        if session.exec(select(Question).where(Question.stem_hash == h)).first():
            continue
        session.add(
            Question(
                stem_hash=h,
                stem=q.stem,
                option_a=q.options[0],
                option_b=q.options[1],
                option_c=q.options[2],
                option_d=q.options[3],
                correct_index=q.correct_index,
                explanation=q.explanation,
                domain=q.domain.value,
                source=q.source,
            )
        )
        inserted += 1
    session.commit()
    logger.info("seeded %d questions", inserted)
    return inserted


def insert_question(session: Session, q: QuestionIn) -> bool:
    h = stem_hash(q.stem)
    if session.exec(select(Question).where(Question.stem_hash == h)).first():
        return False
    session.add(
        Question(
            stem_hash=h,
            stem=q.stem,
            option_a=q.options[0],
            option_b=q.options[1],
            option_c=q.options[2],
            option_d=q.options[3],
            correct_index=q.correct_index,
            explanation=q.explanation,
            domain=q.domain.value,
            source=q.source,
        )
    )
    session.commit()
    return True


def reserve_batch(session: Session, n: int) -> list[Question]:
    """Pick `n` questions, preferring lowest used_count, then random order within ties."""
    rows = session.exec(
        select(Question).order_by(Question.used_count, func.random()).limit(n)
    ).all()
    for r in rows:
        r.used_count += 1
        session.add(r)
    session.commit()
    return list(rows)


def get_question(session: Session, question_id: int) -> Question | None:
    return session.get(Question, question_id)


def pool_counts(session: Session) -> tuple[int, int, dict[str, int]]:
    total = session.exec(select(func.count()).select_from(Question)).one()
    unused = session.exec(
        select(func.count()).select_from(Question).where(Question.used_count == 0)
    ).one()
    rows = session.exec(
        select(Question.domain, func.count()).group_by(Question.domain)
    ).all()
    by_domain = {d: c for d, c in rows}
    return total, unused, by_domain

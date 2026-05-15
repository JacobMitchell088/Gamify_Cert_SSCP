import hashlib

from pydantic import ValidationError

from ..models import QuestionIn


def stem_hash(stem: str) -> str:
    normalized = " ".join(stem.lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def validate_question(raw: dict) -> QuestionIn | None:
    try:
        return QuestionIn(**raw)
    except ValidationError:
        return None

import hashlib
import logging

from pydantic import ValidationError

from ..models import QuestionIn

logger = logging.getLogger(__name__)


def stem_hash(stem: str) -> str:
    normalized = " ".join(stem.lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def validate_question(raw: dict) -> QuestionIn | None:
    try:
        return QuestionIn(**raw)
    except ValidationError as e:
        errs = [f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()]
        logger.info("validator: rejected — %s | raw keys=%s", "; ".join(errs), list(raw.keys()))
        return None

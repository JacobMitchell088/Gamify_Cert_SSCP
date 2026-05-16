from enum import Enum

from pydantic import BaseModel, Field, field_validator
from sqlmodel import Field as SQLField
from sqlmodel import SQLModel


class Domain(str, Enum):
    SECURITY_OPS = "security_ops"
    ACCESS_CONTROLS = "access_controls"
    RISK = "risk"
    INCIDENT_RESPONSE = "incident_response"
    CRYPTOGRAPHY = "cryptography"
    NETWORK = "network"
    SYS_APP_SECURITY = "sys_app_security"


class QuestionIn(BaseModel):
    """Shape used for seed JSON and for LLM-generated questions before insertion."""

    stem: str = Field(min_length=10, max_length=600)
    options: list[str] = Field(min_length=4, max_length=4)
    correct_index: int = Field(ge=0, le=3)
    explanation: str = Field(min_length=5, max_length=800)
    domain: Domain
    source: str = "seed"

    @field_validator("options")
    @classmethod
    def options_must_be_distinct(cls, v: list[str]) -> list[str]:
        cleaned = [o.strip() for o in v]
        if len(set(cleaned)) != 4:
            raise ValueError("options must be 4 distinct non-empty strings")
        if any(not o for o in cleaned):
            raise ValueError("option strings must not be empty")
        return cleaned


class QuestionOut(BaseModel):
    """What the frontend sees — no correct_index."""

    id: int
    stem: str
    options: list[str]
    domain: Domain


class Question(SQLModel, table=True):
    """Persisted question row."""

    id: int | None = SQLField(default=None, primary_key=True)
    stem_hash: str = SQLField(index=True, unique=True)
    stem: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_index: int
    explanation: str
    domain: str = SQLField(index=True)
    source: str = "seed"
    used_count: int = SQLField(default=0, index=True)

    def to_out(self) -> QuestionOut:
        return QuestionOut(
            id=self.id or 0,
            stem=self.stem,
            options=[self.option_a, self.option_b, self.option_c, self.option_d],
            domain=Domain(self.domain),
        )


class Run(SQLModel, table=True):
    id: int | None = SQLField(default=None, primary_key=True)
    started_at: float
    question_count: int = 0
    correct_count: int = 0
    finished: bool = False


class RunQuestion(SQLModel, table=True):
    """Tracks which questions a run has served, in order, and the user's answer."""

    id: int | None = SQLField(default=None, primary_key=True)
    run_id: int = SQLField(index=True)
    position: int
    question_id: int
    answered_index: int | None = None
    correct: bool | None = None


class AnswerIn(BaseModel):
    question_id: int
    chosen_index: int = Field(ge=0, le=3)


class AnswerOut(BaseModel):
    correct: bool
    correct_index: int
    explanation: str


class BatchOut(BaseModel):
    run_id: int
    batch_index: int
    game_key: str
    questions: list[QuestionOut]
    is_final: bool


class PoolStats(BaseModel):
    total: int
    unused: int
    by_domain: dict[str, int]


class QuestionReport(SQLModel, table=True):
    """Player-submitted report on a question (typo, wrong answer, ambiguous, etc.).

    Snapshots stem/options/correct_index at report time so the record stays
    intelligible even if the question is later edited or regenerated.
    """

    id: int | None = SQLField(default=None, primary_key=True)
    question_id: int = SQLField(index=True)
    reason: str
    stem_snapshot: str
    options_snapshot: str  # JSON-encoded list[str]
    correct_index_snapshot: int
    had_answered: bool = False
    player_pick: int | None = None
    user_agent: str | None = None
    created_at: float = SQLField(index=True)


class ReportIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    had_answered: bool = False
    player_pick: int | None = Field(default=None, ge=0, le=3)

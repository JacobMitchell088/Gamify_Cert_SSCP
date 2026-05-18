from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openrouter_api_key: str = ""
    openrouter_free_models: str = ""
    pool_refill_threshold: int = 50
    monthly_call_cap: int = 2000
    cors_origins: str = "http://localhost:5173"
    database_url: str = "sqlite:///./app/data/pool.db"

    # Dev-only: when True, /run/start and /run/{id}/next-batch include each
    # question's correct_index in its payload so the frontend can render a
    # debug badge on the right answer. Flip to False before any public deploy.
    # See CLAUDE.md §11 for details.
    dev_reveal_answers: bool = False

    # GitHub Issues integration for the in-game Feedback button. When both are
    # set, POST /feedback opens an issue in the named repo via the GitHub API.
    # PAT needs `repo` scope (or `public_repo` for a public repo).
    github_token: str = ""
    github_repo: str = ""  # e.g. "Jacobmitchell088/Gamify_Cert_SSCP"
    github_issue_labels: str = "user-feedback"  # comma-separated

    @property
    def free_model_list(self) -> list[str]:
        return [m.strip() for m in self.openrouter_free_models.split(",") if m.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def github_label_list(self) -> list[str]:
        return [l.strip() for l in self.github_issue_labels.split(",") if l.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

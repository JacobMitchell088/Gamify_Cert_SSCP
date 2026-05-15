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

    @property
    def free_model_list(self) -> list[str]:
        return [m.strip() for m in self.openrouter_free_models.split(",") if m.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

"""Environment-driven settings. Every variable is prefixed with GITVERSE_."""

from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class AnalysisLimits(BaseSettings):
    """Hard ceilings for repository analysis.

    The analysis pipeline does not exist yet; these are published via /api/v1/meta
    now so the contract is fixed before the first clone is ever attempted.
    """

    model_config = SettingsConfigDict(env_prefix="GITVERSE_LIMIT_", env_file=".env", extra="ignore")

    max_repo_size_mb: int = Field(default=250, gt=0)
    max_files: int = Field(default=20_000, gt=0)
    max_file_size_kb: int = Field(default=1_024, gt=0)
    analysis_timeout_seconds: int = Field(default=120, gt=0)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GITVERSE_", env_file=".env", extra="ignore")

    environment: str = "development"
    # Comma-separated, because a JSON list is awkward to write in a .env file.
    cors_origins: str = "http://localhost:3000"
    max_request_body_bytes: int = Field(default=16_384, gt=0)
    github_token: SecretStr | None = None
    anthropic_api_key: SecretStr | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_limits() -> AnalysisLimits:
    return AnalysisLimits()

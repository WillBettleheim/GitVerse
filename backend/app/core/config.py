"""Environment-driven settings. Every variable is prefixed with GITVERSE_."""

from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class AnalysisLimits(BaseSettings):
    """Hard ceilings for repository analysis, enforced while fetching and parsing."""

    model_config = SettingsConfigDict(env_prefix="GITVERSE_LIMIT_", env_file=".env", extra="ignore")

    # Size of the compressed archive downloaded from GitHub.
    max_repo_size_mb: int = Field(default=100, gt=0)
    # Entries scanned in the archive, of any type.
    max_files: int = Field(default=20_000, gt=0)
    # Supported source files analyzed. More than this fails rather than silently truncating.
    max_source_files: int = Field(default=4_000, gt=0)
    max_file_size_kb: int = Field(default=1_024, gt=0)
    # Total bytes of source read for parsing.
    max_total_source_mb: int = Field(default=60, gt=0)
    # Declared size of everything in the archive, which bounds decompression work.
    max_unpacked_mb: int = Field(default=800, gt=0)
    analysis_timeout_seconds: int = Field(default=120, gt=0)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GITVERSE_", env_file=".env", extra="ignore")

    environment: str = "development"
    # Comma-separated, because a JSON list is awkward to write in a .env file.
    cors_origins: str = "http://localhost:3000"
    max_request_body_bytes: int = Field(default=16_384, gt=0)
    # Analysis jobs running at once, and waiting beyond those, before new requests are refused.
    max_concurrent_analyses: int = Field(default=2, gt=0)
    max_queued_analyses: int = Field(default=8, ge=0)
    # New analysis requests allowed per client address per minute.
    # Time travel analyzes several commits in a row, and commits already cached don't count.
    analysis_requests_per_minute: int = Field(default=20, gt=0)
    # History pages and comparisons per client address per minute.
    history_requests_per_minute: int = Field(default=30, gt=0)
    # Finished results, keyed by repository and commit. Empty disables the disk cache.
    cache_dir: str = ".cache/analyses"
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

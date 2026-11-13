"""Failures that are safe to show to users. Anything else is reported as an internal error."""

from typing import Literal

ErrorCode = Literal[
    "invalid_repository",
    "repository_not_found",
    "repository_private",
    "repository_moved",
    "repository_empty",
    "github_rate_limited",
    "github_unavailable",
    "too_large",
    "too_many_files",
    "no_supported_files",
    "unsafe_archive",
    "timeout",
    "busy",
    "internal_error",
]


class AnalysisError(Exception):
    """A failure with a message written for the person who asked for the analysis."""

    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: ErrorCode = code
        self.message = message

"""The server-side connection to Claude. The API key never leaves the server.

Kept behind a small interface so tests and evaluations can supply a scripted model.
"""

import logging
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import anthropic
from anthropic.types.beta import BetaOutputConfigParam

logger = logging.getLogger(__name__)

# Server-side fallback: if a request is declined, the API retries it on Anthropic's recommended
# fallback model for that kind of refusal, in the same call.
FALLBACK_BETA = "server-side-fallback-2026-07-01"

Effort = Literal["low", "medium", "high", "xhigh", "max"]
LLMErrorCode = Literal["not_configured", "busy", "unavailable", "refused", "invalid_output"]


class LLMError(Exception):
    def __init__(self, code: LLMErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: LLMErrorCode = code
        self.message = message


@dataclass(frozen=True)
class LLMRequest:
    system: str
    user: str
    schema: dict[str, Any]


@dataclass(frozen=True)
class LLMReply:
    text: str
    model: str
    # True when the requested model declined and a fallback model answered.
    fallback: bool = False


class LLMClient(Protocol):
    @property
    def model(self) -> str: ...

    async def complete(self, request: LLMRequest) -> LLMReply: ...


class AnthropicClient:
    def __init__(
        self,
        api_key: str,
        model: str,
        effort: Effort,
        max_tokens: int,
        timeout_seconds: float,
    ) -> None:
        self._model = model
        self._effort = effort
        self._max_tokens = max_tokens
        self._client = anthropic.AsyncAnthropic(
            api_key=api_key,
            timeout=anthropic.Timeout(timeout_seconds, connect=5.0),
            max_retries=2,
        )

    @property
    def model(self) -> str:
        return self._model

    async def complete(self, request: LLMRequest) -> LLMReply:
        output_config: BetaOutputConfigParam = {
            "effort": self._effort,
            "format": {"type": "json_schema", "schema": request.schema},
        }
        try:
            response = await self._client.beta.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                betas=[FALLBACK_BETA],
                fallbacks="default",
                output_config=output_config,
                system=request.system,
                messages=[{"role": "user", "content": request.user}],
            )
        except anthropic.RateLimitError as exc:
            raise LLMError("busy", "AI Architect is busy. Try again in a minute.") from exc
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as exc:
            logger.error("Claude rejected the configured API key: %s", exc)
            raise LLMError(
                "not_configured", "AI Architect isn't set up correctly on this server."
            ) from exc
        except anthropic.APIStatusError as exc:
            # Includes 400s. Details go to the log only, never to the user.
            logger.error("Claude request failed with %s: %s", exc.status_code, exc)
            raise LLMError("unavailable", "AI Architect couldn't reach its model.") from exc
        except anthropic.APIConnectionError as exc:
            logger.error("Couldn't connect to Claude: %s", exc)
            raise LLMError("unavailable", "AI Architect couldn't reach its model.") from exc

        if response.stop_reason == "refusal":
            raise LLMError("refused", "The model declined to answer this question.")
        if response.stop_reason == "max_tokens":
            raise LLMError("invalid_output", "The answer was too long and was cut off.")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise LLMError("invalid_output", "The model returned no answer.")
        iterations = getattr(response.usage, "iterations", None) or []
        fallback = any(getattr(i, "type", None) == "fallback_message" for i in iterations)
        return LLMReply(text=text, model=response.model, fallback=fallback)

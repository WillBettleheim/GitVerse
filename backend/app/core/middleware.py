"""Request-level resource limits."""

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_BODY_METHODS = {"POST", "PUT", "PATCH"}


class SecurityHeadersMiddleware:
    """Headers every API response carries: JSON is never sniffed as HTML, never framed."""

    HEADERS = (
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"DENY"),
        (b"referrer-policy", b"no-referrer"),
        (b"cache-control", b"no-store"),
    )

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                existing = {name.lower() for name, _ in message.get("headers", [])}
                message["headers"] = [
                    *message.get("headers", []),
                    *(h for h in self.HEADERS if h[0] not in existing),
                ]
            await send(message)

        await self.app(scope, receive, send_with_headers)


class BodySizeLimitMiddleware:
    """Reject oversized bodies before they are read.

    A declared Content-Length is required: the ASGI server enforces that the body matches
    it, so checking the header is enough and chunked uploads cannot slip past the limit.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in _BODY_METHODS:
            await self.app(scope, receive, send)
            return

        headers = dict(scope["headers"])
        declared = headers.get(b"content-length")
        rejection = self._check(declared)
        if rejection is not None:
            await rejection(scope, receive, send)
            return

        await self.app(scope, receive, send)

    def _check(self, declared: bytes | None) -> JSONResponse | None:
        if declared is None or not declared.isdigit():
            return JSONResponse(
                {"detail": "A valid Content-Length header is required."}, status_code=411
            )
        if int(declared) > self.max_bytes:
            return JSONResponse(
                {"detail": f"Request body exceeds the {self.max_bytes} byte limit."},
                status_code=413,
            )
        return None

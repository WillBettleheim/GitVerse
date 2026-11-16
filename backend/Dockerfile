# syntax=docker/dockerfile:1
# The GitVerse API. One process: analysis jobs, rate limits and the job list live in memory, so
# running several workers or replicas would split them. Parsing scales across cores through the
# built-in parser processes instead (GITVERSE_PARSE_WORKERS).

FROM python:3.13-slim AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /src
RUN python -m venv /venv
COPY requirements.lock ./
RUN /venv/bin/pip install -r requirements.lock
COPY pyproject.toml ./
COPY app ./app
RUN /venv/bin/pip install --no-deps .

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/venv/bin:$PATH \
    GITVERSE_ENVIRONMENT=production \
    GITVERSE_CACHE_DIR=/data/analyses \
    FORWARDED_ALLOW_IPS=127.0.0.1
# An unprivileged user. Repository content is only ever read as data, never executed, and this
# limits the damage if a parser bug were ever exploited.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin gitverse \
    && mkdir -p /data && chown gitverse:gitverse /data
COPY --from=build /venv /venv
USER gitverse
WORKDIR /home/gitverse
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]
# exec, so uvicorn receives SIGTERM directly and shuts down gracefully: queued jobs are
# cancelled and parser processes stopped. FORWARDED_ALLOW_IPS should name the reverse proxy, so
# rate limits see real client addresses rather than the proxy's.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips \"$FORWARDED_ALLOW_IPS\" --timeout-graceful-shutdown 20 --timeout-keep-alive 10 --no-server-header"]

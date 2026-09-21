# Stage 1: Build virtual environment with uv
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Stage 2: Final minimal runtime image
FROM python:3.13-slim
WORKDIR /app

# Copy virtual environment and code
COPY --from=builder /app/.venv /app/.venv
COPY app /app/app
COPY scripts /app/scripts

# Set environment & PATH
ENV PATH="/app/.venv/bin:$PATH"
ENV DATABASE_URL="sqlite:////app/data/ctracker.db"

# Create persistent data directory
RUN mkdir -p /app/data

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

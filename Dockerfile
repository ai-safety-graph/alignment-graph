FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src

# Base deps (psycopg2-binary, pgvector, fastapi, uvicorn) all ship prebuilt
# wheels, so no compiler toolchain is needed. The "pipeline" extra (numpy,
# transformers, etc.) is intentionally NOT installed here -- see pyproject.toml.
RUN pip install --no-cache-dir .

ENV API_HOST=0.0.0.0

EXPOSE 8000

# Railway injects $PORT at runtime; fall back to 8000 for local `docker run`.
CMD ["sh", "-c", "uvicorn aisafety_pipeline.api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

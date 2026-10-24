# Build context is the repo root (see render.yaml) so that content/ ships with the API.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY api/app ./app
COPY api/scripts ./scripts
COPY content ./content

ENV CONTENT_DIR=/app/content \
    PORT=8000 \
    PYTHONUNBUFFERED=1

# SEED_DEMO=true seeds the demo logins and class on first start (no-op once they exist).
CMD ["sh", "-c", "if [ \"$SEED_DEMO\" = \"true\" ]; then python -m scripts.seed_demo --if-empty; fi && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]

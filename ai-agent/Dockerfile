FROM python:3.12-slim

LABEL maintainer="Solidarité Textiles <dev@solidata.online>"
LABEL description="SolidataBot — Agent conversationnel IA"

WORKDIR /app

# System deps for psycopg2
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY . .

# Non-root user
RUN useradd -m solidatabot && chown -R solidatabot:solidatabot /app
USER solidatabot

EXPOSE 5050

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5050/health')"

CMD ["gunicorn", "--bind", "0.0.0.0:5050", "--workers", "2", "--threads", "4", "--timeout", "120", "app:app"]

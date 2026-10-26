FROM python:3.13-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server ./server
COPY static ./static

ENV CAL_DATA_DIR=/data \
    CAL_PORT=8080 \
    PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8080

CMD ["python", "-m", "server.app"]

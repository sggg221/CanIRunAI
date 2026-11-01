FROM python:3.10-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates build-essential && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/kekemi
RUN git clone https://github.com/kkray983681062-bit/douyin-kekemi-public.git . && git checkout 1d40965c9fe0e5d4de3cee3323e9407ffce493ba
RUN pip install --no-cache-dir -r requirements.txt && sed -i -e 's/\blong\b/int/g' -e 's/\bunicode\b/str/g' /usr/local/lib/python3.10/site-packages/protobuf_to_dict.py
RUN npm ci --omit=dev
COPY app.py index.html ./
ENV PYTHONUNBUFFERED=1 NODE_ENV=production PORT=5000
EXPOSE 5000
CMD ["sh","-c","exec gunicorn --workers 1 --threads 8 --worker-class gthread --timeout 0 --bind 0.0.0.0:$PORT app:app"]

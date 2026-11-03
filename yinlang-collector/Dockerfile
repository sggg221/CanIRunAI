FROM node:22-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN git clone https://github.com/ymstar/dyhub.git source && cd source && git checkout 21251a1150b7320abaac7ab8222cfa6856abcee2
WORKDIR /build/source
RUN npm ci && npm run build
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man
WORKDIR /app
COPY --from=builder /build/source/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /build/source/dist ./dist
COPY --from=builder /build/source/third_party ./third_party
COPY yinlang-collector/proxy.mjs ./proxy.mjs
ENV DYHUB_PORT=8757 DYHUB_HOST=127.0.0.1 DYHUB_CHROME=/usr/bin/chromium DYHUB_COLLECTOR=browser NODE_ENV=production
EXPOSE 10000
CMD ["sh", "-c", "node dist/index.js & exec node proxy.mjs"]

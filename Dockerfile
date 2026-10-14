FROM oven/bun:1.4.3-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
RUN mkdir -p /data
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/type-race.sqlite
EXPOSE 8080
CMD ["bun", "src/server/server.ts"]

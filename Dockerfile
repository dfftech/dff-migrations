FROM oven/bun:1.4-slim AS deps
WORKDIR /app
COPY package.json ./
RUN bun install --production

FROM oven/bun:1.4-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
# Migration repo clone lives here; it must be writable by the runtime user (bun).
ENV MIGRATION_DIR=/app/.migration
RUN mkdir -p "$MIGRATION_DIR" && chown -R bun:bun "$MIGRATION_DIR"
# Optional: mount a volume here to keep the clone across restarts
VOLUME ["/app/.migration"]
EXPOSE 8080
USER bun
CMD ["bun", "src/server.ts"]

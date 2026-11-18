# dff-migrations

Bun + Elysia service that clones a migration repo and runs PostgreSQL promote/rollback
migrations (Bun.SQL, one transaction per version), plus content/media loading from the repo.

Requires **Bun ≥ 1.4** and **Elysia ≥ 2.0**.

### env example

```sh
export BASE_NAME=CORE
export CORE_DB_URL='postgresql://postgres:postgres@localhost:5432/postgres?options=-c%20search_path%3Dpublic'
export CORE_REPO_URL='https://github.com/org/migrations.git'
export CORE_REPO_TOKEN='ghp_...'
export PORT=4000            # default 4000
# optional: CORE_KAFKA_LOG_SEND=true CORE_KAFKA_BROKERS=host:9092 CORE_KAFKA_LOG_TOPIC=app-logs
```

### run

```sh
bun install
bun run dev         # bun --watch src/server.ts
bun run start       # production
bun run typecheck   # tsc --noEmit
```

### layout

```
src/
  server.ts                 Bun.serve + boot (DB init, repo clone, Kafka) + graceful shutdown
  app.ts                    Elysia app: routes + global error handler
  http/                     request context (AsyncLocalStorage), logging wrapper, ResponseType helpers
  db/                       Bun.SQL pools (core + per-tenant), tenants LISTEN/NOTIFY
  migration-runner/         z-order resolution + Bun.SQL transactional runner (tx.file per .sql)
  git/clone-repo.ts         isomorphic-git clone / pull / reclone of .migration
  modules/                  health, migration, content-load, media-load routes + services
  logging/, kafka/, utils/  logger (console + Kafka), log masking, dff-util HTTP client
```

### curl

```sh
curl -s http://127.0.0.1:4000/health/local

curl -s http://127.0.0.1:4000/migration/catalog
curl -s http://127.0.0.1:4000/migration/resync

curl -s http://127.0.0.1:4000/migration/core/0001/promote
curl -s http://127.0.0.1:4000/migration/core/z-order/promote
curl -s http://127.0.0.1:4000/migration/tenants/0003/promote/all
curl -s http://127.0.0.1:4000/migration/tenants/z-order/promote/local
curl -s http://127.0.0.1:4000/migration/local/0000/rollback

curl -s "http://127.0.0.1:4000/content-load?query=locales.en-US.app"
curl -s "http://127.0.0.1:4000/media-load?query=photo-3.jpg" -o photo-3.jpg
```

HTTP status mirrors the `status` field of the JSON body (200 / 404 / 500).

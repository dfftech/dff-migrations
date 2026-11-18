import { IS_PRODUCTION, SERVER_HOST, SERVER_PORT } from "./config/env";
import { close_db_pools, init_tenants_db } from "./db/db-connection";
import { clone_repo } from "./git/clone-repo";
import { handleRequest } from "./http/request-handler";
import { disconnectKafkaProducer } from "./kafka/kafka-util";
import { initKafkaProducer } from "./logging/kafka-logger";
import { writeLog } from "./logging/logger";

/** Max Bun.serve idle timeout (seconds) — migrations can run long. */
const IDLE_TIMEOUT_SEC = 255;

function logDbInitFailure(err: unknown): void {
  writeLog("error", ":---------DB initialization failed---------:", { error: err });
}

function logRepoInitFailure(err: unknown): void {
  writeLog("error", ":---------Repo initialization failed---------:", { error: err });
}

function logRepoInitDone(): void {
  writeLog("info", ":---------Repo initialization completed---------:");
}

/** Hosts a local client may use for this port; each must reach this process. */
const SELF_CHECK_HOSTS = ["127.0.0.1", "localhost"];
const SELF_CHECK_TIMEOUT_MS = 2000;

/**
 * On macOS two processes can share a port when they bind different addresses
 * (Vite on localhost/127.0.0.1, Bun on 0.0.0.0) and the more specific one wins.
 * Send a request with a unique request-id: this server echoes it, others don't.
 */
async function probeHost(host: string): Promise<void> {
  const probeId = `self-check-${Bun.randomUUIDv7()}`;
  const url = `http://${host}:${SERVER_PORT}/health/self-check`;
  const headers = { "request-id": probeId };
  const init = { headers, signal: AbortSignal.timeout(SELF_CHECK_TIMEOUT_MS) };
  try {
    const response = await fetch(url, init);
    if (response.headers.get("request-id") === probeId) return;
    const fields = { url, contentType: response.headers.get("content-type") };
    writeLog(
      "error",
      `PORT CONFLICT: ${url} is answered by another process (e.g. a Vite dev server), not dff-migrations. Stop it or start this API on a free port (PORT=4001).`,
      fields
    );
  } catch (err) {
    writeLog("warn", `self-check ${url} failed`, { error: err instanceof Error ? err.message : String(err) });
  }
}

async function checkPortOwnership(): Promise<void> {
  for (const host of SELF_CHECK_HOSTS) {
    await probeHost(host);
  }
}

/** Background boot work; the server starts serving immediately (like Encore load-time init). */
function startBackgroundInit(): void {
  void initKafkaProducer();
  init_tenants_db().catch(logDbInitFailure);
  clone_repo().then(logRepoInitDone).catch(logRepoInitFailure);
}

const serveOptions = {
  port: SERVER_PORT,
  hostname: SERVER_HOST,
  idleTimeout: IDLE_TIMEOUT_SEC,
  fetch: handleRequest,
};

const server = Bun.serve(serveOptions);
writeLog("info", `dff-migrations listening on ${server.url}`);
startBackgroundInit();
if (!IS_PRODUCTION) void checkPortOwnership();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  writeLog("info", `${signal} received, shutting down`);
  await server.stop();
  await close_db_pools();
  await disconnectKafkaProducer();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

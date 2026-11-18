import type { ResponseType } from "dff-util";
import { join } from "node:path";
import { failResponse, okResponse } from "../../http/response";
import { session_meta } from "../../utils/app-util";

type PackageJson = { version?: string };

async function readAppVersion(): Promise<string> {
  try {
    const pkg = (await Bun.file(join(process.cwd(), "package.json")).json()) as PackageJson;
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const APP_VERSION = await readAppVersion();

export async function healthCheck(tenant: string): Promise<ResponseType> {
  const { logger } = session_meta();
  try {
    const details = { tenant, version: APP_VERSION };
    await logger.info("Processing health request", details);
    return okResponse({ message: "Health Check Pass", ...details });
  } catch (err) {
    return failResponse(err);
  }
}

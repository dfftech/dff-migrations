const DEFAULT_BASE_NAME = "XXXX";

/** BASE_NAME (upper-cased) — prefix for every app env key, e.g. CORE_DB_URL. */
export function env_base_name(): string {
  const baseName = Bun.env.BASE_NAME || DEFAULT_BASE_NAME;
  return baseName.toUpperCase();
}

/** Read `${BASE_NAME}_${key}` from the environment. */
export function env(key: string): string | undefined {
  const fullKey = `${env_base_name()}_${key}`.toUpperCase();
  return Bun.env[fullKey];
}

/** Read a plain (un-prefixed) env key. */
export function rawEnv(key: string): string | undefined {
  return Bun.env[key];
}

export const IS_PRODUCTION = Bun.env.NODE_ENV === "production";
export const SERVER_PORT = Number(Bun.env.PORT || 4000);
export const SERVER_HOST = Bun.env.HOST || "0.0.0.0";

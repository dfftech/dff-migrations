import { Http, JwtEncode, toKebabCase, type SessionInfo } from "dff-util";
import { env, env_base_name } from "../config/env";
import { session_meta, session_user } from "./app-util";

const API_JWT_SECRET = env("API_JWT_SECRET") || "-";
const API_JWT_KEY = env("API_JWT_KEY") || "-";
const API_BASE_URL = env("API_BASE_URL") || "https://apidev.com";

type HttpHeaders = Record<string, string | undefined>;

function serviceUrl(key: string, suffix: string): string {
  return env(key) || `${API_BASE_URL}/${toKebabCase(env_base_name())}-${suffix}/`;
}

function absoluteUrl(url: string): string {
  return url.includes("http") ? url : API_BASE_URL + url;
}

export default class AppHttp {
  static MsUrl = {
    base: serviceUrl("MS_BASE_URL", "base"),
    auth: serviceUrl("MS_AUTH_URL", "auth"),
    util: serviceUrl("MS_UTIL_URL", "util"),
    main: serviceUrl("MS_MAIN_URL", "main"),
    sor: serviceUrl("MS_SOR_URL", "sor"),
    events: serviceUrl("MS_EVENTS_URL", "events"),
  };

  static AUTHORIZATION_TOKEN: string | undefined = undefined;

  static async Get(url: string, params: unknown) {
    const target = absoluteUrl(url);
    const headers = await AppHttp.headers(true);
    AppHttp.logCall("GET", target, params, headers);
    return Http.Get(target, params, headers);
  }

  static async Post(url: string, params: unknown) {
    const target = absoluteUrl(url);
    const headers = await AppHttp.headers(true);
    AppHttp.logCall("POST", target, params, headers);
    return Http.Post(target, params, headers);
  }

  static async Put(url: string, params: unknown) {
    const target = absoluteUrl(url);
    const headers = await AppHttp.headers(true);
    AppHttp.logCall("PUT", target, params, headers);
    return Http.Put(target, params, headers);
  }

  static async Delete(url: string, params: unknown) {
    const target = absoluteUrl(url);
    const headers = await AppHttp.headers(true);
    AppHttp.logCall("DELETE", target, params, headers);
    return Http.Delete(target, params, headers);
  }

  /** GET returning the raw body as a Blob (images, video, audio, any binary). */
  static async Media(url: string, params: unknown): Promise<Blob> {
    const target = absoluteUrl(url);
    const headers = await AppHttp.headers(false);
    AppHttp.logCall("GET Media", target, params, headers);
    return Http.FileDownload(target, params, headers);
  }

  static async Token(): Promise<string> {
    const session: SessionInfo = { ...session_user(), key: API_JWT_KEY, roles: ["api"], type: "api" };
    return JwtEncode(session, API_JWT_SECRET);
  }

  private static async headers(json: boolean): Promise<HttpHeaders> {
    const { token, request_id, tenant_id } = session_meta();
    const authorization = AppHttp.AUTHORIZATION_TOKEN || token || (await AppHttp.Token());
    const headers: HttpHeaders = { authorization, "request-id": request_id, "x-tenant-id": tenant_id };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  private static logCall(method: string, url: string, params: unknown, headers: HttpHeaders): void {
    const fields = { url, params: params ?? {}, headers };
    void session_meta().logger.info(`HTTP ${method} Call: ${url}`, fields);
  }
}

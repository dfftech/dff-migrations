import type { KeyValueType } from "dff-util";
import { env } from "../config/env";
import { currentContext } from "../context/request-context";
import { connectKafkaProducer, kafkaPublish } from "../kafka/kafka-util";
import { maskLogData } from "./log-mask";
import { writeLog, type LogLevel } from "./logger";

const KAFKA_LOG_TOPIC = env("KAFKA_LOG_TOPIC") || "app-logs";
const KAFKA_LOG_SEND = env("KAFKA_LOG_SEND") || "false";

let isKafkaConnected = false;

export type LoggerContext = {
  requestId: string;
  traceId?: string;
  sessionUserId?: string;
  tenantId?: string;
};

export async function initKafkaProducer(): Promise<void> {
  if (KAFKA_LOG_SEND === "false") return;
  try {
    await connectKafkaProducer();
    isKafkaConnected = true;
    writeLog("info", "Kafka producer connected");
  } catch (err: unknown) {
    isKafkaConnected = false;
    const errorFields = { error: err instanceof Error ? err.message : String(err) };
    writeLog("error", "Kafka connection failed", errorFields);
  }
}

/** Request-scoped logger: console always, Kafka when KAFKA_LOG_SEND is enabled. */
export class AppLogger {
  private readonly baseContext: KeyValueType;

  constructor(context: LoggerContext) {
    this.baseContext = {
      request_id: context.requestId,
      trace_id: context.traceId,
      session_user_id: context.sessionUserId,
      tenant_id: context.tenantId,
    };
  }

  info(message: string, data: KeyValueType = {}): Promise<void> {
    return this.write("info", message, data);
  }

  error(message: string, data: KeyValueType = {}): Promise<void> {
    return this.write("error", message, data);
  }

  warn(message: string, data: KeyValueType = {}): Promise<void> {
    return this.write("warn", message, data);
  }

  debug(message: string, data: KeyValueType = {}): Promise<void> {
    return this.write("debug", message, data);
  }

  private async write(level: LogLevel, message: string, data: KeyValueType): Promise<void> {
    const safe = maskLogData(data);
    const fields = { ...this.baseContext, ...safe };
    writeLog(level, message, fields);
    await this.sendToKafka(level, message, fields);
  }

  private async sendToKafka(level: LogLevel, message: string, fields: KeyValueType): Promise<void> {
    if (!isKafkaConnected) return;
    const record = { level, message, timestamp: new Date().toISOString(), ...fields };
    try {
      await kafkaPublish(KAFKA_LOG_TOPIC, null, record);
    } catch (err: unknown) {
      const errorFields = { ...this.baseContext, error: err instanceof Error ? err.message : String(err) };
      writeLog("error", "Failed to send log to Kafka", errorFields);
    }
  }
}

const backgroundLogger = new AppLogger({ requestId: "migration" });

/** Request-scoped logger, or a shared background logger outside a request (LISTEN / init). */
export function currentAppLogger(): AppLogger {
  const context = currentContext();
  return context ? context.logger : backgroundLogger;
}

/** Fire-and-forget log through the current logger. */
export function emitAppLog(level: LogLevel, message: string, data: Record<string, unknown> = {}): void {
  void currentAppLogger()[level](message, data);
}

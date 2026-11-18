import { Kafka, type Consumer, type EachMessagePayload, type KafkaConfig, type Producer } from "kafkajs";
import { env } from "../config/env";
import { writeLog } from "../logging/logger";
import type { PubSubEventType } from "../utils/app-types";

const KAFKA_BROKERS = env("KAFKA_BROKERS") || "192.168.1.2:29094";
const KAFKA_USERNAME = env("KAFKA_USERNAME") || "admin";
const KAFKA_PASSWORD = env("KAFKA_PASSWORD") || "";

export type KafkaEventHandler = (event: PubSubEventType) => Promise<void>;

let kafkaSingleton: Kafka | null = null;
let sharedProducer: Producer | null = null;
let producerConnected = false;

function kafkaConfig(): KafkaConfig {
  const sasl = { mechanism: "plain" as const, username: KAFKA_USERNAME, password: KAFKA_PASSWORD };
  const brokers = KAFKA_BROKERS.split(",");
  return {
    clientId: env("KAFKA_CLIENT_ID") || "dff-migrations",
    brokers,
    ssl: false,
    sasl,
  };
}

export function getKafkaClient(): Kafka {
  if (!kafkaSingleton) kafkaSingleton = new Kafka(kafkaConfig());
  return kafkaSingleton;
}

export async function connectKafkaProducer(): Promise<Producer> {
  if (!sharedProducer) sharedProducer = getKafkaClient().producer();
  if (!producerConnected) {
    await sharedProducer.connect();
    producerConnected = true;
    writeLog("info", "Kafka utils: shared producer connected");
  }
  return sharedProducer;
}

export async function disconnectKafkaProducer(): Promise<void> {
  if (!sharedProducer || !producerConnected) return;
  try {
    await sharedProducer.disconnect();
    producerConnected = false;
    sharedProducer = null;
    writeLog("info", "Kafka utils: shared producer disconnected");
  } catch (err: unknown) {
    const errorFields = { error: err instanceof Error ? err.message : String(err) };
    writeLog("error", "Kafka utils: producer disconnect failed", errorFields);
  }
}

export async function kafkaPublish(topic: string, key: string | null, message: unknown): Promise<void> {
  const producer = await connectKafkaProducer();
  const value = typeof message === "string" ? message : JSON.stringify(message);
  const record = key ? { key, value } : { value };
  const payload = { topic, messages: [record] };
  await producer.send(payload);
}

/** Forward each consumed message to handler(topic, raw). */
async function forwardMessage(topic: string, handler: KafkaEventHandler, payload: EachMessagePayload): Promise<void> {
  const raw = payload.message.value?.toString() ?? undefined;
  const event: PubSubEventType = { id: crypto.randomUUID(), name: topic, raw };
  await handler(event);
}

export async function runKafkaConsumer(
  topic: string,
  groupId: string,
  handler: KafkaEventHandler,
  fromBeginning = false
): Promise<Consumer> {
  const consumer = getKafkaClient().consumer({ groupId });
  await consumer.connect();
  const subscription = { topic, fromBeginning };
  await consumer.subscribe(subscription);
  const runConfig = { eachMessage: forwardMessage.bind(null, topic, handler) };
  await consumer.run(runConfig);
  return consumer;
}

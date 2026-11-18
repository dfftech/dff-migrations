export type { KeyValueType, ResponseType, SearchType, SessionInfo } from "dff-util";

export type RequestQueryType = {
  query?: string;
  active?: boolean;
  data?: string;
  raw?: string;
  filters?: string;
};

export type RequestByQuery = { query: string };

export type RequestByIdType = RequestQueryType & { id: string };

export type PubSubEventType = {
  id: string;
  name?: string;
  query?: string;
  active?: boolean;
  data?: string;
  raw?: string;
  filters?: string;
};

export type { KeyValueType, ResponseType, SearchType, SessionInfo } from 'dff-util';

import type { Query } from 'encore.dev/api';

export type RequestQueryType = {
  query?: Query<string>;
  active?: Query<boolean>;
  data?: Query<string>;
  raw?: Query<string>;
  filters?: Query<string>;
};

export type RequestByQuery = {
  query: Query<string>;
};

export type RequestByIdType = {
  id: string;
  query?: Query<string>;
  active?: Query<boolean>;
  data?: Query<string>;
  raw?: Query<string>;
  filters?: Query<string>;
};

export type RequestByNameType = {
  name: string;
  query?: Query<string>;
  active?: Query<boolean>;
  data?: Query<string>;
  raw?: Query<string>;
  filters?: Query<string>;
};

export type RequestByTypeType = {
  type: string;
  query?: Query<string>;
  active?: Query<boolean>;
  data?: Query<string>;
  raw?: Query<string>;
  filters?: Query<string>;
};

export type RequestByCodeType = {
  code: string;
  query?: Query<string>;
  active?: Query<boolean>;
  data?: Query<string>;
  raw?: Query<string>;
  filters?: Query<string>;
};

export type PubSubEventType = {
  id: string;
  name?: string;
  query?: string;
  active?: boolean;
  data?: string;
  raw?: string;
  filters?: string;
};

export type RequestSssUrlType = {
  fileName: Query<string>;
  private?: Query<boolean>;
  type?: Query<string>;
};

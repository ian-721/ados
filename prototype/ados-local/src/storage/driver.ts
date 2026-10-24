export type SqlValue = null | number | string | Uint8Array | bigint;
export type SqlParams = readonly SqlValue[];
export type SqlRow = Record<string, unknown>;

export interface DriverRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

export interface StorageDriver {
  readonly databasePath: string;
  exec(sql: string): void;
  run(sql: string, params?: SqlParams): DriverRunResult;
  get<T extends SqlRow>(sql: string, params?: SqlParams): T | undefined;
  all<T extends SqlRow>(sql: string, params?: SqlParams): T[];
  pragma<T = unknown>(source: string, simple?: boolean): T;
  checkpoint(mode: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE"): unknown;
  backup(destinationPath: string): Promise<void>;
  close(): void;
}

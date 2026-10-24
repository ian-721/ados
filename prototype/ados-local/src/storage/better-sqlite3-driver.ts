import Database from "better-sqlite3";
import type {
  DriverRunResult,
  SqlParams,
  SqlRow,
  StorageDriver,
} from "./driver.js";

export interface BetterSqlite3DriverOptions {
  readonly readonly?: boolean;
  readonly fileMustExist?: boolean;
}

export class BetterSqlite3Driver implements StorageDriver {
  readonly #database: Database.Database;
  public readonly databasePath: string;

  public constructor(
    databasePath: string,
    options: BetterSqlite3DriverOptions = {},
  ) {
    this.databasePath = databasePath;
    this.#database = new Database(databasePath, {
      readonly: options.readonly ?? false,
      fileMustExist: options.fileMustExist ?? false,
    });
  }

  public exec(sql: string): void {
    this.#database.exec(sql);
  }

  public run(sql: string, params: SqlParams = []): DriverRunResult {
    const result = this.#database.prepare(sql).run(...params);
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  public get<T extends SqlRow>(sql: string, params: SqlParams = []): T | undefined {
    return this.#database.prepare(sql).get(...params) as T | undefined;
  }

  public all<T extends SqlRow>(sql: string, params: SqlParams = []): T[] {
    return this.#database.prepare(sql).all(...params) as T[];
  }

  public pragma<T = unknown>(source: string, simple = false): T {
    return this.#database.pragma(source, { simple }) as T;
  }

  public checkpoint(mode: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE"): unknown {
    return this.#database.pragma(`wal_checkpoint(${mode})`);
  }

  public async backup(destinationPath: string): Promise<void> {
    await this.#database.backup(destinationPath);
  }

  public close(): void {
    if (this.#database.open) {
      this.#database.close();
    }
  }
}

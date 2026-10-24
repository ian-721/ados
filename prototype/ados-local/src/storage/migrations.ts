import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { sha256Text } from "../canonical/index.js";
import type { StorageDriver } from "./driver.js";

export interface MigrationIdentity {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly sql: string;
}

interface MigrationRow extends Record<string, unknown> {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function canonicalMigrationSql(directory: string, name: string): string {
  const sqlBytes = readFileSync(join(directory, name));
  let sql: string;
  try {
    sql = UTF8_DECODER.decode(sqlBytes);
  } catch {
    throw new Error(`MIGRATION_UTF8_INVALID:${name}`);
  }
  if (sql.startsWith("\ufeff")) {
    throw new Error(`MIGRATION_BOM_FORBIDDEN:${name}`);
  }
  if (/\r(?!\n)/u.test(sql)) {
    throw new Error(`MIGRATION_LINE_ENDING_INVALID:${name}`);
  }
  return sql.replace(/\r\n/g, "\n");
}

function legacyCrlfChecksum(sql: string): string {
  return sha256Text(sql.replace(/\n/g, "\r\n"));
}

function migrationChecksumMatches(stored: string, wanted: MigrationIdentity): boolean {
  return stored === wanted.checksum || stored === legacyCrlfChecksum(wanted.sql);
}

function discoverMigrations(directory: string): MigrationIdentity[] {
  const migrations = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const match = /^(\d{4})_[A-Za-z0-9_-]+\.sql$/.exec(name);
      if (match === null) {
        throw new Error(`INVALID_MIGRATION_NAME:${name}`);
      }
      const versionText = match[1];
      if (versionText === undefined) {
        throw new Error(`INVALID_MIGRATION_NAME:${name}`);
      }
      const sql = canonicalMigrationSql(directory, name);
      return {
        version: Number.parseInt(versionText, 10),
        name,
        checksum: sha256Text(sql),
        sql,
      };
    });

  if (migrations.length === 0) {
    throw new Error("MIGRATIONS_MISSING");
  }
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`MIGRATION_ORDER_INVALID:${migration.name}`);
    }
  });
  return migrations;
}

function hasMigrationTable(driver: StorageDriver): boolean {
  const row = driver.get<{ readonly count: number }>(
    "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  );
  return row?.count === 1;
}

export function applyAndVerifyMigrations(
  driver: StorageDriver,
  directory: string,
  now: () => string,
  maximumVersion?: number,
): readonly MigrationIdentity[] {
  const discovered = discoverMigrations(directory);
  const expected = maximumVersion === undefined
    ? discovered
    : discovered.filter((migration) => migration.version <= maximumVersion);
  if (maximumVersion !== undefined && expected.length !== maximumVersion) {
    throw new Error(`MIGRATION_MAXIMUM_UNAVAILABLE:${maximumVersion}`);
  }
  const applied = hasMigrationTable(driver)
    ? driver.all<MigrationRow>(
        "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
      )
    : [];

  for (let index = 0; index < applied.length; index += 1) {
    const actual = applied[index];
    const wanted = discovered[index];
    if (
      actual === undefined ||
      wanted === undefined ||
      actual.version !== wanted.version ||
      actual.name !== wanted.name ||
      !migrationChecksumMatches(actual.checksum, wanted)
    ) {
      throw new Error(`MIGRATION_IDENTITY_MISMATCH:${actual?.name ?? "missing"}`);
    }
  }
  if (applied.length > discovered.length) {
    throw new Error("MIGRATION_SOURCE_MISSING");
  }

  for (const migration of expected.slice(applied.length)) {
    driver.exec("BEGIN IMMEDIATE");
    try {
      driver.exec(migration.sql);
      driver.run(
        "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        [migration.version, migration.name, migration.checksum, now()],
      );
      driver.exec("COMMIT");
    } catch (error) {
      driver.exec("ROLLBACK");
      throw error;
    }
  }

  const finalRows = driver.all<MigrationRow>(
    "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
  );
  const requiredLength = maximumVersion === undefined ? expected.length : Math.max(expected.length, applied.length);
  if (finalRows.length !== requiredLength) {
    throw new Error("MIGRATION_SET_INCOMPLETE");
  }
  finalRows.forEach((actual, index) => {
    const wanted = discovered[index];
    if (
      wanted === undefined ||
      actual.version !== wanted.version ||
      actual.name !== wanted.name ||
      !migrationChecksumMatches(actual.checksum, wanted)
    ) {
      throw new Error(`MIGRATION_VERIFICATION_FAILED:${actual.name}`);
    }
  });
  return expected;
}

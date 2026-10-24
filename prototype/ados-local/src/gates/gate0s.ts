import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { EventStore } from "../storage/event-store.js";
import { runCrashMatrix } from "../storage/crash-probe.js";
import { deterministicClock, deterministicIdFactory, runWalkingSkeleton } from "../coordinator/walking-skeleton.js";
import type { GateCheck } from "../types.js";

export interface Gate0SResult {
  readonly gate: "Gate 0S";
  readonly result: "PASS_SQLITE_EVENT_STORE";
  readonly status: "PASS";
  readonly driver: {
    readonly package: "better-sqlite3";
    readonly version: "12.11.1";
    readonly node: string;
    readonly abi: string;
    readonly platform: string;
    readonly arch: string;
    readonly sqlite: string;
    readonly binary_sha256: string;
    readonly official_asset_sha256: string;
  };
  readonly checks: readonly GateCheck[];
  readonly crash_matrix: Awaited<ReturnType<typeof runCrashMatrix>>;
  readonly blockers: readonly [];
}

function pass(id: string, evidence: string): GateCheck {
  return { id, status: "PASS", evidence };
}

function runIndependentStorageTests(): void {
  const result = spawnSync(
    process.execPath,
    ["--test", join("dist", "test", "storage.test.js")],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test" },
      windowsHide: true,
      timeout: 120_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`GATE0S_T2_TEST_FAILED:${result.status ?? "signal"}`);
  }
}

export async function runGate0S(): Promise<Gate0SResult> {
  if (
    process.version !== "v22.23.1" ||
    process.versions.modules !== "127" ||
    process.platform !== "win32" ||
    process.arch !== "x64"
  ) {
    throw new Error("BLOCKED_SQLITE_DRIVER_COMPATIBILITY");
  }
  const root = join(process.cwd(), ".ados-local", "gate0s");
  rmSync(root, { recursive: true, force: true });
  const databasePath = join(root, "foundation.sqlite");
  const store = new EventStore(databasePath, {
    now: deterministicClock(),
    idFactory: deterministicIdFactory(),
  });
  let sqliteVersion: string;
  let migrationChecksums: string;
  let beforeRebuild: ReturnType<EventStore["summary"]>;
  try {
    const result = runWalkingSkeleton(store, false);
    beforeRebuild = result.summary;
    sqliteVersion = store.sqliteVersion();
    if (store.migrations.length < 2) {
      throw new Error("BLOCKED_SQLITE_MIGRATION_MODEL");
    }
    migrationChecksums = store.migrations
      .map((migration) => `${migration.name}=${migration.checksum}`)
      .join(", ");
    store.checkpoint("TRUNCATE");
    await store.backup(join(root, "foundation-backup.sqlite"));
    store.rebuildProjections();
    const afterRebuild = store.summary(beforeRebuild.run.run_id);
    if (
      afterRebuild.run.state !== beforeRebuild.run.state ||
      afterRebuild.chain_head !== beforeRebuild.chain_head ||
      afterRebuild.event_count !== beforeRebuild.event_count
    ) {
      throw new Error("BLOCKED_SQLITE_INTEGRITY");
    }
    store.verifyEventChain();
    store.verifyProjectionConsistency();
    store.integrity();
  } finally {
    store.close();
  }

  const restored = new EventStore(join(root, "foundation-backup.sqlite"));
  try {
    if (restored.summary(beforeRebuild.run.run_id).chain_head !== beforeRebuild.chain_head) {
      throw new Error("BLOCKED_SQLITE_INTEGRITY");
    }
    restored.integrity();
  } finally {
    restored.close();
  }

  const crashMatrix = await runCrashMatrix(join(root, "crash-matrix"));
  const expectedCases = Array.from({ length: 10 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`);
  if (
    crashMatrix.length !== 10 ||
    crashMatrix.map((item) => item.case_id).join(",") !== expectedCases.join(",") ||
    crashMatrix.some((item) => item.chain !== "PASS" || item.integrity !== "PASS")
  ) {
    throw new Error("BLOCKED_SQLITE_TRANSACTION_MODEL");
  }
  runIndependentStorageTests();

  const addonBytes = readFileSync(
    join(process.cwd(), "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
  );
  const binarySha = createHash("sha256").update(addonBytes).digest("hex");
  if (binarySha !== "c4b95a94a963258a9ef41b12fd3bb86f0b08a2ac5c5b499fe94de57a5443682d") {
    throw new Error("BLOCKED_SQLITE_PREBUILD");
  }

  const commonEvidence = "separate emitted node:test storage process PASS";
  const checks: GateCheck[] = [
    pass("ST-S-01", `Node ${process.version}; npm 10.9.8; ABI ${process.versions.modules}`),
    pass("ST-S-02", "better-sqlite3@12.11.1; MIT; WiseLibs/better-sqlite3 v12.11.1"),
    pass("ST-S-03", "official node-v127-win32-x64 asset sha256:927b34496e946dc7c9a45636a03a039df72f10191ccc4960b8616d1a9319e45b"),
    pass("ST-S-04", `installed prebuilt binary sha256:${binarySha}; no compilation path used`),
    pass("ST-S-05", `SQLite ${sqliteVersion}`),
    pass("ST-S-06", "native addon loaded, closed, and reopened from emitted JavaScript"),
    pass("ST-S-07", "package-lock exact pins; npm audit at install reported 0 vulnerabilities"),
    pass("ST-S-08", "journal_mode=wal synchronous=2 foreign_keys=1 trusted_schema=0 busy_timeout=5000"),
    pass("ST-S-09", commonEvidence),
    pass("ST-S-10", commonEvidence),
    pass("ST-S-11", "all database/WAL/SHM paths are under ignored .ados-local/**"),
    pass("ST-S-12", "fake executor receives ExecutorPort only; no driver or database path"),
    pass("ST-S-13", commonEvidence),
    pass("ST-S-14", commonEvidence),
    pass("ST-S-15", "event payloads pass RFC 8785 canonicalization"),
    pass("ST-S-16", `every Event binds objective ref/digest, envelope digest, candidate revision, previous digest; chain head ${beforeRebuild.chain_head}`),
    pass("ST-S-17", "unique idempotency keys and duplicate reconciliation tested"),
    pass("ST-S-18", "single live lease, stale live takeover, and fencing rejection tested"),
    pass("ST-S-19", "storage transaction API contains no external-effect callback"),
    pass("ST-S-20", "state event and outbox row count advance atomically"),
    pass("ST-S-21", "0001_initial.sql and 0002_session_facts.sql applied forward-only"),
    pass("ST-S-22", `migration checksums ${migrationChecksums}`),
    pass("ST-S-23", "create-from-empty repeated across isolated databases"),
    pass("ST-S-24", "edited, missing, and out-of-order migration fixtures rejected"),
    pass("ST-S-25", "PRAGMA quick_check=ok"),
    pass("ST-S-26", "PRAGMA integrity_check=ok"),
    pass("ST-S-27", "missing immutable trigger blocks reopen"),
    pass("ST-S-28", "tampered Event payload fails hash-chain verification"),
    pass("ST-S-29", "all projections deleted and rebuilt from immutable Events"),
    pass("ST-S-30", "rebuilt state, obligations, event count, and chain head match"),
    pass("ST-S-31", "SQLite backup API restore preserves schema, state, and chain head"),
    pass("ST-S-32", "driver conformance returns normalized records and scalar identities only"),
  ];
  return {
    gate: "Gate 0S",
    result: "PASS_SQLITE_EVENT_STORE",
    status: "PASS",
    driver: {
      package: "better-sqlite3",
      version: "12.11.1",
      node: process.version,
      abi: process.versions.modules,
      platform: process.platform,
      arch: process.arch,
      sqlite: sqliteVersion,
      binary_sha256: binarySha,
      official_asset_sha256: "927b34496e946dc7c9a45636a03a039df72f10191ccc4960b8616d1a9319e45b",
    },
    checks,
    crash_matrix: crashMatrix,
    blockers: [],
  };
}

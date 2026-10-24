import { fork } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EventStore } from "./event-store.js";
import { deterministicClock, deterministicIdFactory } from "../coordinator/walking-skeleton.js";
import { hashCanonical } from "../canonical/index.js";
import type { RunSeed, RunState } from "../types.js";

export type CrashBoundary =
  | "before-begin"
  | "after-begin"
  | "after-event"
  | "after-projection"
  | "after-commit";

export interface CrashCaseResult {
  readonly case_id: `S${string}`;
  readonly scenario: string;
  readonly boundary: CrashBoundary | null;
  readonly expected_commit: boolean;
  readonly expected_outcome: string;
  readonly observed_outcome: string;
  readonly run_id: string;
  readonly observed_state: RunState;
  readonly event_count: number;
  readonly chain: "PASS";
  readonly integrity: "PASS";
}

function recoverySeed(
  suffix: string,
  leaseKey = `objective-recovery-${suffix}`,
  holderId = `coordinator-recovery-${suffix}`,
  ttlSeconds = 300,
): RunSeed {
  return {
    run_id: `run-recovery-${suffix}`,
    request_id: `dr-recovery-${suffix}`,
    objective_id: `objective-recovery-${suffix}`,
    objective_ref: `fixture://objective/recovery/${suffix}`,
    request_digest: hashCanonical({ request: suffix }),
    objective_digest: hashCanonical({ objective: suffix }),
    envelope_digest: hashCanonical({ envelope: suffix }),
    generation: 1,
    lease_key: leaseKey,
    holder_id: holderId,
    ttl_seconds: ttlSeconds,
    obligations: [{
      obligation_id: "owner-acceptance",
      category: "owner",
      verifier_id: "verifier.owner",
      minimum_trust: "T4",
    }],
  };
}

function prepareCrashDatabase(databasePath: string): {
  readonly runId: string;
  readonly holderId: string;
  readonly fencingToken: number;
  readonly eventCount: number;
} {
  const store = new EventStore(databasePath, {
    now: deterministicClock(),
    idFactory: deterministicIdFactory(),
  });
  const runId = "run-crash-matrix-0001";
  try {
    const created = store.createRun({
      run_id: runId,
      request_id: "dr-crash-matrix-0001",
      objective_id: "objective-crash-matrix-0001",
      objective_ref: "fixture://objective/crash-matrix-0001",
      request_digest: hashCanonical({ request: "crash-matrix" }),
      objective_digest: hashCanonical({ objective: "crash-matrix" }),
      envelope_digest: hashCanonical({ envelope: "crash-matrix" }),
      generation: 1,
      lease_key: "objective-crash-matrix-0001",
      holder_id: "coordinator-crash-matrix",
      ttl_seconds: 300,
      obligations: [
        {
          obligation_id: "owner-acceptance",
          category: "owner",
          verifier_id: "verifier.owner",
          minimum_trust: "T4",
        },
      ],
    });
    store.transition(
      runId,
      "PREPARED",
      "EXECUTING",
      created.lease.holder_id,
      created.lease.fencing_token,
      `${runId}:executing`,
    );
    return {
      runId,
      holderId: created.lease.holder_id,
      fencingToken: created.lease.fencing_token,
      eventCount: store.summary(runId).event_count,
    };
  } finally {
    store.close();
  }
}

async function killAtBoundary(
  databasePath: string,
  runId: string,
  holderId: string,
  fencingToken: number,
  boundary: CrashBoundary,
): Promise<void> {
  const workerPath = fileURLToPath(new URL("./crash-worker.js", import.meta.url));
  const absoluteDatabasePath = resolve(databasePath);
  const child = fork(
    workerPath,
    [absoluteDatabasePath, runId, holderId, String(fencingToken), boundary],
    {
      execArgv: [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`CRASH_WORKER_TIMEOUT:${boundary}`));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`CRASH_WORKER_ERROR:${error.name}`));
    });
    child.on("message", (message: unknown) => {
      const record = message as { readonly type?: string; readonly boundary?: string };
      if (record.type === "ready" && record.boundary === boundary) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`CRASH_WORKER_EARLY_EXIT:${boundary}:${code}`));
      }
    });
  });
  child.kill();
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

function verifyStore(store: EventStore, runId: string): ReturnType<EventStore["summary"]> {
  const summary = store.summary(runId);
  store.verifyEventChain();
  store.verifyProjectionConsistency();
  store.integrity();
  return summary;
}

function runRecoveryCases(rootDirectory: string): readonly CrashCaseResult[] {
  const results: CrashCaseResult[] = [];

  const walPath = join(rootDirectory, "s06-wal-reopen.sqlite");
  const walStore = new EventStore(walPath, {
    now: deterministicClock(),
    idFactory: deterministicIdFactory(),
  });
  const walCreated = walStore.createRun(recoverySeed("s06"));
  walStore.transition(
    walCreated.run.run_id,
    "PREPARED",
    "EXECUTING",
    walCreated.lease.holder_id,
    walCreated.lease.fencing_token,
    "s06-executing",
  );
  const walExists = existsSync(`${walPath}-wal`);
  walStore.close();
  const walReopened = new EventStore(walPath);
  try {
    const summary = verifyStore(walReopened, walCreated.run.run_id);
    if (!walExists || summary.run.state !== "EXECUTING") {
      throw new Error("S06_WAL_REOPEN_FAILED");
    }
    results.push({
      case_id: "S06",
      scenario: "reopen with WAL",
      boundary: null,
      expected_commit: true,
      expected_outcome: "WAL_REOPEN_SAME_RUN",
      observed_outcome: "WAL_REOPEN_SAME_RUN",
      run_id: summary.run.run_id,
      observed_state: summary.run.state,
      event_count: summary.event_count,
      chain: "PASS",
      integrity: "PASS",
    });
  } finally {
    walReopened.close();
  }

  const checkpointPath = join(rootDirectory, "s07-checkpoint.sqlite");
  const checkpointStore = new EventStore(checkpointPath, {
    now: deterministicClock(),
    idFactory: deterministicIdFactory(),
  });
  const checkpointCreated = checkpointStore.createRun(recoverySeed("s07"));
  checkpointStore.checkpoint("TRUNCATE");
  checkpointStore.close();
  const checkpointReopened = new EventStore(checkpointPath);
  try {
    const summary = verifyStore(checkpointReopened, checkpointCreated.run.run_id);
    results.push({
      case_id: "S07",
      scenario: "checkpoint then reopen",
      boundary: null,
      expected_commit: true,
      expected_outcome: "CHECKPOINT_REOPEN_SAME_RUN",
      observed_outcome: "CHECKPOINT_REOPEN_SAME_RUN",
      run_id: summary.run.run_id,
      observed_state: summary.run.state,
      event_count: summary.event_count,
      chain: "PASS",
      integrity: "PASS",
    });
  } finally {
    checkpointReopened.close();
  }

  const retryPath = join(rootDirectory, "s08-duplicate-retry.sqlite");
  const retryStore = new EventStore(retryPath, {
    now: deterministicClock(),
    idFactory: deterministicIdFactory(),
  });
  try {
    const created = retryStore.createRun(recoverySeed("s08"));
    retryStore.transition(
      created.run.run_id,
      "PREPARED",
      "EXECUTING",
      created.lease.holder_id,
      created.lease.fencing_token,
      "s08-uncertain-ack",
    );
    const beforeRetry = retryStore.summary(created.run.run_id);
    const retried = retryStore.transition(
      created.run.run_id,
      "PREPARED",
      "EXECUTING",
      created.lease.holder_id,
      created.lease.fencing_token,
      "s08-uncertain-ack",
    );
    const afterRetry = verifyStore(retryStore, created.run.run_id);
    if (
      retried.run_id !== created.run.run_id ||
      afterRetry.event_count !== beforeRetry.event_count
    ) {
      throw new Error("S08_DUPLICATE_RETRY_FAILED");
    }
    results.push({
      case_id: "S08",
      scenario: "duplicate retry after uncertain acknowledgement",
      boundary: null,
      expected_commit: true,
      expected_outcome: "DUPLICATE_RECONCILED",
      observed_outcome: "DUPLICATE_RECONCILED",
      run_id: afterRetry.run.run_id,
      observed_state: afterRetry.run.state,
      event_count: afterRetry.event_count,
      chain: "PASS",
      integrity: "PASS",
    });
  } finally {
    retryStore.close();
  }

  const leasePath = join(rootDirectory, "s09-second-writer.sqlite");
  const leaseStore = new EventStore(leasePath, {
    now: deterministicClock(),
    idFactory: deterministicIdFactory(),
  });
  try {
    const first = leaseStore.createRun(recoverySeed("s09-a", "shared-s09-lease"));
    let blocked = false;
    try {
      leaseStore.createRun(recoverySeed("s09-b", "shared-s09-lease", "second-writer"));
    } catch (error) {
      blocked = error instanceof Error && error.message === "LEASE_HELD:shared-s09-lease";
    }
    const summary = verifyStore(leaseStore, first.run.run_id);
    if (!blocked) {
      throw new Error("S09_SECOND_WRITER_NOT_BLOCKED");
    }
    results.push({
      case_id: "S09",
      scenario: "second writer while lease held",
      boundary: null,
      expected_commit: false,
      expected_outcome: "LEASE_HELD",
      observed_outcome: "LEASE_HELD",
      run_id: summary.run.run_id,
      observed_state: summary.run.state,
      event_count: summary.event_count,
      chain: "PASS",
      integrity: "PASS",
    });
  } finally {
    leaseStore.close();
  }

  const stalePath = join(rootDirectory, "s10-stale-live.sqlite");
  let now = "2026-08-02T03:00:00.000Z";
  const staleStore = new EventStore(stalePath, {
    now: () => now,
    idFactory: deterministicIdFactory(),
  });
  try {
    const first = staleStore.createRun(
      recoverySeed("s10-a", "shared-s10-lease", `live-process-${process.pid}`, 1),
    );
    now = "2026-08-02T03:01:00.000Z";
    process.kill(process.pid, 0);
    let blocked = false;
    try {
      staleStore.createRun(recoverySeed("s10-b", "shared-s10-lease", "takeover-writer"));
    } catch (error) {
      blocked = error instanceof Error && error.message === "LEASE_HELD:shared-s10-lease";
    }
    const summary = verifyStore(staleStore, first.run.run_id);
    if (!blocked || Date.parse(summary.lease.expires_at) >= Date.parse(now)) {
      throw new Error("S10_STALE_LIVE_TAKEOVER_NOT_BLOCKED");
    }
    results.push({
      case_id: "S10",
      scenario: "stale lease with live holder process",
      boundary: null,
      expected_commit: false,
      expected_outcome: "SAFE_BLOCK_NO_AUTOMATIC_TAKEOVER",
      observed_outcome: "SAFE_BLOCK_NO_AUTOMATIC_TAKEOVER",
      run_id: summary.run.run_id,
      observed_state: summary.run.state,
      event_count: summary.event_count,
      chain: "PASS",
      integrity: "PASS",
    });
  } finally {
    staleStore.close();
  }
  return results;
}

export async function runCrashMatrix(rootDirectory: string): Promise<readonly CrashCaseResult[]> {
  mkdirSync(rootDirectory, { recursive: true });
  const boundaries: readonly CrashBoundary[] = [
    "before-begin",
    "after-begin",
    "after-event",
    "after-projection",
    "after-commit",
  ];
  const caseIds: Readonly<Record<CrashBoundary, `S${string}`>> = {
    "before-begin": "S01",
    "after-begin": "S02",
    "after-event": "S03",
    "after-projection": "S04",
    "after-commit": "S05",
  };
  const results: CrashCaseResult[] = [];
  for (const boundary of boundaries) {
    const databasePath = join(rootDirectory, `${boundary}.sqlite`);
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }
    const base = prepareCrashDatabase(databasePath);
    await killAtBoundary(
      databasePath,
      base.runId,
      base.holderId,
      base.fencingToken,
      boundary,
    );
    const reopened = new EventStore(databasePath);
    try {
      const committed = boundary === "after-commit";
      const summary = reopened.summary(base.runId);
      const expectedState = committed ? "VERIFYING" : "EXECUTING";
      const expectedEvents = base.eventCount + (committed ? 1 : 0);
      if (summary.run.state !== expectedState || summary.event_count !== expectedEvents) {
        throw new Error(`CRASH_ATOMICITY_FAILED:${boundary}`);
      }
      reopened.verifyEventChain();
      reopened.verifyProjectionConsistency();
      reopened.integrity();
      results.push({
        case_id: caseIds[boundary],
        scenario: `kill ${boundary}`,
        boundary,
        expected_commit: committed,
        expected_outcome: committed ? "COMMIT_VISIBLE" : "ROLLBACK_NO_PARTIAL_STATE",
        observed_outcome: committed ? "COMMIT_VISIBLE" : "ROLLBACK_NO_PARTIAL_STATE",
        run_id: summary.run.run_id,
        observed_state: summary.run.state as "EXECUTING" | "VERIFYING",
        event_count: summary.event_count,
        chain: "PASS",
        integrity: "PASS",
      });
    } finally {
      reopened.close();
    }
  }
  results.push(...runRecoveryCases(rootDirectory));
  return results;
}

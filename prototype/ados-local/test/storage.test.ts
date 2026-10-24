import assert from "node:assert/strict";
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { BetterSqlite3Driver } from "../src/storage/better-sqlite3-driver.js";
import { EventStore } from "../src/storage/event-store.js";
import { applyAndVerifyMigrations } from "../src/storage/migrations.js";
import { runCrashMatrix } from "../src/storage/crash-probe.js";
import { runWalkingSkeleton } from "../src/coordinator/walking-skeleton.js";
import { createMinimalRun, isolatedStore } from "./helpers.js";

process.env.NODE_ENV = "test";

test("exact Windows SQLite prebuilt binary matches the frozen SHA", { skip: process.platform !== "win32" ? "Windows x64 prebuilt binary identity; Linux is a separate artifact" : false }, () => {
    const addonPath = join(
      process.cwd(),
      "node_modules",
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node",
    );
    const { createHash } = requireHash();
    const digest = createHash("sha256").update(readFileSync(addonPath)).digest("hex");
    assert.equal(digest, "c4b95a94a963258a9ef41b12fd3bb86f0b08a2ac5c5b499fe94de57a5443682d");
});


test("SQLite embedded version, pragmas, STRICT and foreign keys pass", () => {
  const fixture = isolatedStore("identity");
  try {
    assert.equal(fixture.store.sqliteVersion(), "3.53.2");
    assert.deepEqual(fixture.store.verifyPragmas(), {
      journal_mode: "wal",
      synchronous: 2,
      foreign_keys: 1,
      trusted_schema: 0,
      busy_timeout: 5000,
    });
    assert.throws(
      () => fixture.store.testOnlyExec("UPDATE projection_meta SET last_event_seq = 'not-an-integer' WHERE singleton = 1"),
      /cannot store TEXT|datatype mismatch/i,
    );
    assert.throws(
      () => fixture.store.testOnlyExec("INSERT INTO obligations(run_id, obligation_id, category, verifier_id, minimum_trust, status, achieved_trust, last_event_seq) VALUES ('missing', 'x', 'owner', 'v', 4, 'PENDING', NULL, 1)"),
      /FOREIGN KEY/i,
    );
  } finally {
    fixture.cleanup();
  }
});

function requireHash(): typeof import("node:crypto") {
  return globalThis.process.getBuiltinModule("node:crypto") as typeof import("node:crypto");
}

test("event, projection, lease and outbox transition atomically with idempotency", () => {
  const fixture = isolatedStore("atomic");
  const readback = new BetterSqlite3Driver(fixture.databasePath, { readonly: true, fileMustExist: true });
  try {
    const created = createMinimalRun(fixture.store);
    const duplicate = createMinimalRun(fixture.store);
    assert.equal(created.disposition, "CREATED");
    assert.equal(duplicate.disposition, "DUPLICATE_RECONCILED");
    assert.equal(duplicate.run.run_id, created.run.run_id);
    const before = fixture.store.summary(created.run.run_id);
    assert.equal(
      readback.get<{ readonly status: string }>(
        "SELECT status FROM outbox WHERE outbox_id = ?",
        [`${created.run.run_id}:prepared`],
      )?.status,
      "PENDING",
    );
    fixture.store.transition(
      created.run.run_id,
      "PREPARED",
      "EXECUTING",
      created.lease.holder_id,
      created.lease.fencing_token,
      "atomic-executing",
    );
    const after = fixture.store.summary(created.run.run_id);
    fixture.store.transition(
      created.run.run_id,
      "PREPARED",
      "EXECUTING",
      created.lease.holder_id,
      created.lease.fencing_token,
      "atomic-executing",
    );
    const afterRetry = fixture.store.summary(created.run.run_id);
    assert.equal(after.event_count, before.event_count + 1);
    assert.equal(after.outbox_count, before.outbox_count + 1);
    assert.equal(after.run.state, "EXECUTING");
    assert.equal(afterRetry.event_count, after.event_count);
    assert.deepEqual(
      readback.all<{ readonly kind: string; readonly status: string }>(
        "SELECT kind, status FROM outbox WHERE run_id = ? ORDER BY kind",
        [created.run.run_id],
      ),
      [
        { kind: "RUN_PREPARED", status: "DELIVERED" },
        { kind: "RUN_STATE_CHANGED", status: "PENDING" },
      ],
    );
    fixture.store.verifyEventChain();
    fixture.store.verifyProjectionConsistency();
  } finally {
    readback.close();
    fixture.cleanup();
  }
});

test("session facts upsert one dynamic projection and rebuild from Events", () => {
  const fixture = isolatedStore("session-projection");
  try {
    const created = createMinimalRun(fixture.store);
    const common = {
      profile_id: "executor.fixture",
      thread_id: "thread-fixture-0001",
      capability_digest: `sha256:${"a".repeat(64)}`,
    };
    fixture.store.recordSessionFact(
      created.run.run_id,
      created.lease.holder_id,
      created.lease.fencing_token,
      { ...common, turn_id: "turn-0001", status: "completed" },
      "session-started",
    );
    fixture.store.recordSessionFact(
      created.run.run_id,
      created.lease.holder_id,
      created.lease.fencing_token,
      { ...common, turn_id: null, status: "resumed" },
      "session-resumed",
    );
    assert.equal(fixture.store.summary(created.run.run_id).session_count, 1);
    fixture.store.rebuildProjections();
    assert.equal(fixture.store.summary(created.run.run_id).session_count, 1);
  } finally {
    fixture.cleanup();
  }
});

test("one live lease rejects a second writer and stale live takeover", () => {
  const fixture = isolatedStore("lease");
  try {
    createMinimalRun(fixture.store, "lease-a");
    assert.throws(
      () => fixture.store.createRun({
        run_id: "run-minimal-lease-b",
        request_id: "dr-minimal-lease-b",
        objective_id: "objective-minimal-lease-b",
        objective_ref: "fixture://objective/minimal/lease-b",
        request_digest: `sha256:${"1".repeat(64)}`,
        objective_digest: `sha256:${"2".repeat(64)}`,
        envelope_digest: `sha256:${"3".repeat(64)}`,
        generation: 1,
        lease_key: "objective-minimal-lease-a",
        holder_id: "second-writer",
        ttl_seconds: 30,
        obligations: [{
          obligation_id: "owner",
          category: "owner",
          verifier_id: "owner",
          minimum_trust: "T4",
        }],
      }),
      /LEASE_HELD/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("forward-only migration upgrade, edit, missing source, and ordering drift are verified", () => {
  const fixture = isolatedStore("migrations");
  const migrationCopy = join(fixture.root, "migrations");
  fixture.store.close();
  cpSync(join(process.cwd(), "migrations"), migrationCopy, { recursive: true });
  const db = join(fixture.root, "migration-state.sqlite");
  const migration = join(migrationCopy, "0001_initial.sql");
  const upgradeMigration = join(migrationCopy, "0002_session_facts.sql");
  const fulfillmentMigration = join(migrationCopy, "0003_fulfillment_effects.sql");
  const intakeMigration = join(migrationCopy, "0004_delivery_intake.sql");
  const dispatchMigration = join(migrationCopy, "0005_activation_dispatch.sql");
  const slice4DispatchMigration = join(migrationCopy, "0006_slice4_dispatch_binding.sql");
  const migrationSource = readFileSync(migration, "utf8");
  const upgradeSource = readFileSync(upgradeMigration, "utf8");
  const fulfillmentSource = readFileSync(fulfillmentMigration, "utf8");
  rmSync(upgradeMigration);
  rmSync(fulfillmentMigration);
  rmSync(intakeMigration);
  rmSync(dispatchMigration);
  rmSync(slice4DispatchMigration);
  const initial = new BetterSqlite3Driver(db);
  assert.equal(
    applyAndVerifyMigrations(initial, migrationCopy, () => "2026-08-02T00:00:00.000Z").length,
    1,
  );
  initial.close();
  writeFileSync(upgradeMigration, upgradeSource, "utf8");
  writeFileSync(fulfillmentMigration, fulfillmentSource, "utf8");
  const upgraded = new EventStore(db, { migrationsDirectory: migrationCopy });
  assert.equal(upgraded.migrations.length, 3);
  upgraded.close();
  writeFileSync(migration, `${migrationSource}\n-- edited\n`, "utf8");
  assert.throws(() => new EventStore(db, { migrationsDirectory: migrationCopy }), /MIGRATION_IDENTITY_MISMATCH/);
  writeFileSync(migration, migrationSource, "utf8");
  rmSync(migration);
  rmSync(upgradeMigration);
  rmSync(fulfillmentMigration);
  assert.throws(() => new EventStore(db, { migrationsDirectory: migrationCopy }), /MIGRATIONS_MISSING/);
  writeFileSync(upgradeMigration, upgradeSource, "utf8");
  writeFileSync(fulfillmentMigration, fulfillmentSource, "utf8");
  assert.throws(() => new EventStore(join(fixture.root, "order.sqlite"), { migrationsDirectory: migrationCopy }), /MIGRATION_ORDER_INVALID/);
  rmSync(fixture.root, { recursive: true, force: true });
});

test("migration identity is stable across LF and CRLF checkouts and rejects other byte drift", () => {
  const fixture = isolatedStore("migration-line-endings");
  fixture.store.close();
  const sourceDirectory = join(process.cwd(), "migrations");
  const lfDirectory = join(fixture.root, "migrations-lf");
  const crlfDirectory = join(fixture.root, "migrations-crlf");
  cpSync(sourceDirectory, lfDirectory, { recursive: true });
  cpSync(sourceDirectory, crlfDirectory, { recursive: true });

  const names = readdirSync(sourceDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const canonicalSources = new Map(
    names.map((name) => {
      const source = readFileSync(join(sourceDirectory, name), "utf8");
      const canonical = source.replace(/\r\n/g, "\n");
      assert.doesNotMatch(canonical, /\r/);
      return [name, canonical] as const;
    }),
  );
  const canonicalSource = (name: string): string => {
    const source = canonicalSources.get(name);
    if (source === undefined) {
      throw new Error(`MIGRATION_SOURCE_MISSING:${name}`);
    }
    return source;
  };
  const writeLineEndings = (directory: string, eol: "\n" | "\r\n"): void => {
    for (const name of names) {
      writeFileSync(
        join(directory, name),
        canonicalSource(name).replace(/\n/g, eol),
        "utf8",
      );
    }
  };
  const storedChecksums = (driver: BetterSqlite3Driver): readonly string[] =>
    driver.all<{ readonly checksum: string }>(
      "SELECT checksum FROM schema_migrations ORDER BY version",
    ).map((row) => row.checksum);

  try {
    writeLineEndings(lfDirectory, "\n");
    const lfDatabase = join(fixture.root, "lf.sqlite");
    const lfDriver = new BetterSqlite3Driver(lfDatabase);
    const canonicalChecksums = applyAndVerifyMigrations(
      lfDriver,
      lfDirectory,
      () => "2026-08-04T00:00:00.000Z",
    ).map((migration) => migration.checksum);
    assert.deepEqual(storedChecksums(lfDriver), canonicalChecksums);
    lfDriver.close();

    writeLineEndings(lfDirectory, "\r\n");
    const lfReopenedFromCrlf = new BetterSqlite3Driver(lfDatabase);
    assert.deepEqual(
      applyAndVerifyMigrations(
        lfReopenedFromCrlf,
        lfDirectory,
        () => "2026-08-04T00:00:01.000Z",
      ).map((migration) => migration.checksum),
      canonicalChecksums,
    );
    assert.deepEqual(storedChecksums(lfReopenedFromCrlf), canonicalChecksums);
    lfReopenedFromCrlf.close();

    writeLineEndings(crlfDirectory, "\r\n");
    const legacyDatabase = join(fixture.root, "legacy-crlf.sqlite");
    const legacyDriver = new BetterSqlite3Driver(legacyDatabase);
    assert.deepEqual(
      applyAndVerifyMigrations(
        legacyDriver,
        crlfDirectory,
        () => "2026-08-04T00:00:02.000Z",
      ).map((migration) => migration.checksum),
      canonicalChecksums,
    );
    assert.deepEqual(storedChecksums(legacyDriver), canonicalChecksums);

    const { createHash } = requireHash();
    const legacyChecksums = names.map((name) =>
      `sha256:${createHash("sha256")
        .update(canonicalSource(name).replace(/\n/g, "\r\n"))
        .digest("hex")}`,
    );
    legacyDriver.exec("DROP TRIGGER migrations_no_update");
    names.forEach((name, index) => {
      const checksum = legacyChecksums[index];
      if (checksum === undefined) {
        throw new Error(`MIGRATION_CHECKSUM_MISSING:${name}`);
      }
      legacyDriver.run(
        "UPDATE schema_migrations SET checksum = ? WHERE name = ?",
        [checksum, name],
      );
    });
    legacyDriver.exec(
      "CREATE TRIGGER migrations_no_update BEFORE UPDATE ON schema_migrations BEGIN SELECT RAISE(ABORT, 'migrations are immutable'); END;",
    );
    assert.deepEqual(storedChecksums(legacyDriver), legacyChecksums);
    legacyDriver.close();

    writeLineEndings(crlfDirectory, "\n");
    const legacyReopenedFromLf = new BetterSqlite3Driver(legacyDatabase);
    assert.deepEqual(
      applyAndVerifyMigrations(
        legacyReopenedFromLf,
        crlfDirectory,
        () => "2026-08-04T00:00:03.000Z",
      ).map((migration) => migration.checksum),
      canonicalChecksums,
    );
    assert.deepEqual(storedChecksums(legacyReopenedFromLf), legacyChecksums);
    legacyReopenedFromLf.close();

    const firstName = names[0];
    if (firstName === undefined) {
      throw new Error("MIGRATIONS_MISSING");
    }
    const firstSource = canonicalSource(firstName);
    writeFileSync(join(crlfDirectory, firstName), `${firstSource}\n-- edited\n`, "utf8");
    assert.throws(
      () => new EventStore(legacyDatabase, { migrationsDirectory: crlfDirectory }),
      /MIGRATION_IDENTITY_MISMATCH/,
    );

    writeFileSync(join(crlfDirectory, firstName), firstSource.replace("\n", "\r"), "utf8");
    assert.throws(
      () => new EventStore(legacyDatabase, { migrationsDirectory: crlfDirectory }),
      /MIGRATION_LINE_ENDING_INVALID/,
    );

    writeFileSync(join(crlfDirectory, firstName), Buffer.from([0xff]));
    assert.throws(
      () => new EventStore(legacyDatabase, { migrationsDirectory: crlfDirectory }),
      /MIGRATION_UTF8_INVALID/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("external effects require committed intent and reconcile idempotently", () => {
  const fixture = isolatedStore("external-effects");
  try {
    const created = createMinimalRun(fixture.store);
    const runId = created.run.run_id;
    const holder = created.lease.holder_id;
    const token = created.lease.fencing_token;
    fixture.store.recordWorkspaceFact(
      runId,
      holder,
      token,
      {
        repository_full_name: "fixture.invalid/ados-fixture-delivery",
        base_sha: "3536f4810f9cfadc75443a838a26e969883fca44",
        branch_name: "ados/slice2-owner-summary-v0.1",
        worktree_path_digest: `sha256:${"4".repeat(64)}`,
        candidate_sha: null,
        candidate_revision: 1,
        status: "BOUND",
      },
      "workspace-bound",
    );
    const intent = {
      outbox_id: `${runId}:push`,
      effect_kind: "GIT_PUSH",
      identity_key: "fixture:branch:1",
      target_ref: "refs/heads/ados/slice2-owner-summary-v0.1",
      candidate_sha: "a".repeat(40),
      payload: { branch: "ados/slice2-owner-summary-v0.1" },
    };
    assert.equal(
      fixture.store.recordExternalEffectIntent(runId, holder, token, intent, "push-intent"),
      "CREATED",
    );
    assert.equal(
      fixture.store.recordExternalEffectIntent(runId, holder, token, intent, "push-intent"),
      "REUSED",
    );
    assert.equal(fixture.store.pendingExternalEffects(runId).length, 1);
    const result = {
      outbox_id: intent.outbox_id,
      effect_kind: intent.effect_kind,
      identity_key: intent.identity_key,
      result_ref: "refs/heads/ados/slice2-owner-summary-v0.1",
      readback_digest: `sha256:${"5".repeat(64)}`,
    };
    assert.equal(
      fixture.store.reconcileExternalEffect(runId, holder, token, result, "push-reconciled"),
      "CONFIRMED",
    );
    assert.equal(
      fixture.store.reconcileExternalEffect(runId, holder, token, result, "push-reconciled"),
      "REUSED",
    );
    assert.equal(fixture.store.pendingExternalEffects(runId).length, 0);
    assert.equal(fixture.store.publications(runId).length, 1);
    assert.equal(fixture.store.workspace(runId)?.status, "BOUND");
    fixture.store.rebuildProjections();
    assert.equal(fixture.store.publications(runId)[0]?.status, "CONFIRMED");
    assert.equal(fixture.store.workspace(runId)?.branch_name, "ados/slice2-owner-summary-v0.1");
  } finally {
    fixture.cleanup();
  }
});

test("schema corruption, projection drift, and broken Event chain block", () => {
  const schemaFixture = isolatedStore("schema-corruption");
  const schemaPath = schemaFixture.databasePath;
  schemaFixture.store.testOnlyExec("DROP TRIGGER events_no_delete");
  schemaFixture.store.close();
  assert.throws(() => new EventStore(schemaPath), /SCHEMA_TRIGGER_MISSING/);
  rmSync(schemaFixture.root, { recursive: true, force: true });

  const projectionFixture = isolatedStore("projection-drift");
  try {
    const created = createMinimalRun(projectionFixture.store);
    projectionFixture.store.testOnlyExec(`UPDATE runs SET state = 'FAILED' WHERE run_id = '${created.run.run_id}'`);
    assert.throws(() => projectionFixture.store.verifyProjectionConsistency(), /PROJECTION_STATE_DRIFT/);
  } finally {
    projectionFixture.cleanup();
  }

  const chainFixture = isolatedStore("chain-corruption");
  try {
    const created = createMinimalRun(chainFixture.store);
    chainFixture.store.testOnlyExec("DROP TRIGGER events_no_update; UPDATE events SET payload_jcs = '{}' WHERE seq = 1; CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;");
    assert.throws(() => chainFixture.store.verifyEventChain(), /EVENT_CHAIN_HASH_MISMATCH/);
    assert.equal(chainFixture.store.getRun(created.run.run_id).state, "PREPARED");
  } finally {
    chainFixture.cleanup();
  }

  const bindingFixture = isolatedStore("event-binding-drift");
  try {
    createMinimalRun(bindingFixture.store);
    bindingFixture.store.testOnlyExec(
      "UPDATE runs SET objective_ref = 'fixture://objective/forged'",
    );
    assert.throws(
      () => bindingFixture.store.verifyEventChain(),
      /EVENT_BINDING_MISMATCH/,
    );
  } finally {
    bindingFixture.cleanup();
  }
});

test("projection rebuild from Events is deterministic", () => {
  const fixture = isolatedStore("rebuild");
  try {
    const before = runWalkingSkeleton(fixture.store, false).summary;
    fixture.store.rebuildProjections();
    const after = fixture.store.summary(before.run.run_id);
    assert.equal(after.run.state, before.run.state);
    assert.equal(after.event_count, before.event_count);
    assert.equal(after.chain_head, before.chain_head);
    assert.deepEqual(
      after.obligations.map((item) => [item.obligation_id, item.status, item.achieved_trust]),
      before.obligations.map((item) => [item.obligation_id, item.status, item.achieved_trust]),
    );
  } finally {
    fixture.cleanup();
  }
});

test("same-run Evidence correction reconciles one existing comment and rebuilds deterministically", () => {
  const fixture = isolatedStore("evidence-correction");
  try {
    const walking = runWalkingSkeleton(fixture.store, false);
    const runId = walking.run_id;
    const lease = fixture.store.getLease(runId);
    const candidateSha = "a".repeat(40);
    const identity = "fixture-owner-summary:run:1";
    const commentId = 101;
    const commentUrl = `https://github.com/example/fixture/pull/2#issuecomment-${commentId}`;
    const priorManifestDigest = `sha256:${"1".repeat(64)}`;
    const correctedManifestDigest = `sha256:${"2".repeat(64)}`;
    const priorReadbackDigest = `sha256:${"3".repeat(64)}`;
    const correctedReadbackDigest = `sha256:${"4".repeat(64)}`;

    fixture.store.recordWorkspaceFact(runId, lease.holder_id, lease.fencing_token, {
      repository_full_name: "example/fixture",
      base_sha: "b".repeat(40),
      branch_name: "ados/slice2-owner-summary-v0.1",
      worktree_path_digest: `sha256:${"5".repeat(64)}`,
      candidate_sha: candidateSha,
      candidate_revision: 1,
      status: "PUBLISHED",
    }, "evidence-correction-workspace");
    fixture.store.recordExternalEffectIntent(runId, lease.holder_id, lease.fencing_token, {
      outbox_id: "evidence-comment-original",
      effect_kind: "EVIDENCE_COMMENT",
      identity_key: identity,
      target_ref: "https://github.com/example/fixture/pull/2",
      candidate_sha: candidateSha,
      payload: { manifest_digest: priorManifestDigest },
    }, "evidence-comment-original-intent");
    fixture.store.reconcileExternalEffect(runId, lease.holder_id, lease.fencing_token, {
      outbox_id: "evidence-comment-original",
      effect_kind: "EVIDENCE_COMMENT",
      identity_key: identity,
      result_ref: commentUrl,
      readback_digest: priorReadbackDigest,
    }, "evidence-comment-original-effect");
    fixture.store.recordExternalEffectIntent(runId, lease.holder_id, lease.fencing_token, {
      outbox_id: "evidence-comment-correction",
      effect_kind: "EVIDENCE_CORRECTION",
      identity_key: identity,
      target_ref: commentUrl,
      candidate_sha: candidateSha,
      payload: {
        comment_id: commentId,
        prior_manifest_digest: priorManifestDigest,
        corrected_manifest_digest: correctedManifestDigest,
      },
    }, "evidence-comment-correction-intent");
    fixture.store.reconcileExternalEffect(runId, lease.holder_id, lease.fencing_token, {
      outbox_id: "evidence-comment-correction",
      effect_kind: "EVIDENCE_CORRECTION",
      identity_key: identity,
      result_ref: commentUrl,
      readback_digest: correctedReadbackDigest,
    }, "evidence-comment-correction-effect");
    const correction = {
      evidence_outbox_id: "evidence-comment-original",
      correction_outbox_id: "evidence-comment-correction",
      identity_key: identity,
      candidate_sha: candidateSha,
      comment_id: commentId,
      comment_url: commentUrl,
      prior_manifest_digest: priorManifestDigest,
      corrected_manifest_digest: correctedManifestDigest,
      corrected_comment_readback_digest: correctedReadbackDigest,
    } as const;
    assert.equal(fixture.store.reconcileEvidenceCorrection(
      runId,
      lease.holder_id,
      lease.fencing_token,
      correction,
      "evidence-correction-reconciled",
    ), "RECORDED");
    assert.equal(fixture.store.reconcileEvidenceCorrection(
      runId,
      lease.holder_id,
      lease.fencing_token,
      correction,
      "evidence-correction-reconciled",
    ), "REUSED");
    assert.equal(
      fixture.store.publications(runId).find((item) => item.outbox_id === "evidence-comment-original")?.readback_digest,
      correctedReadbackDigest,
    );
    const before = fixture.store.summary(runId);
    assert.equal(before.run.state, "OWNER_REVIEW");
    assert.equal(before.publication_count, 2);
    assert.equal(fixture.store.pendingExternalEffects(runId).length, 0);
    fixture.store.verifyEventChain();
    fixture.store.verifyProjectionConsistency();
    fixture.store.rebuildProjections();
    const after = fixture.store.summary(runId);
    assert.equal(after.chain_head, before.chain_head);
    assert.equal(after.event_count, before.event_count);
    assert.equal(
      fixture.store.publications(runId).find((item) => item.outbox_id === "evidence-comment-original")?.readback_digest,
      correctedReadbackDigest,
    );
  } finally {
    fixture.cleanup();
  }
});

test("WAL checkpoint/reopen and SQLite backup/restore preserve state and chain", async () => {
  const fixture = isolatedStore("backup");
  const backupPath = join(fixture.root, "backup.sqlite");
  const result = runWalkingSkeleton(fixture.store, false);
  const before = result.summary;
  fixture.store.checkpoint("TRUNCATE");
  await fixture.store.backup(backupPath);
  fixture.store.close();
  const reopened = new EventStore(fixture.databasePath);
  const restored = new EventStore(backupPath);
  try {
    assert.equal(reopened.summary(before.run.run_id).chain_head, before.chain_head);
    assert.equal(restored.summary(before.run.run_id).chain_head, before.chain_head);
    assert.deepEqual(restored.integrity(), { quick_check: "ok", integrity_check: "ok" });
    restored.verifyEventChain();
  } finally {
    reopened.close();
    restored.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("child-process kill boundaries roll back before commit and survive after commit", async () => {
  const fixture = isolatedStore("crash-matrix");
  fixture.store.close();
  try {
    const results = await runCrashMatrix(join(fixture.root, "matrix"));
    assert.deepEqual(results.slice(0, 5).map((item) => item.observed_state), [
      "EXECUTING",
      "EXECUTING",
      "EXECUTING",
      "EXECUTING",
      "VERIFYING",
    ]);
    assert.deepEqual(
      results.map((item) => item.case_id),
      ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10"],
    );
    assert.ok(results.every((item) => item.chain === "PASS" && item.integrity === "PASS"));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

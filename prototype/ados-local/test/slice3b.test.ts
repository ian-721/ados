import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { compilerPackForCapture, validateCapturePack } from "../src/capture/profile.js";
import { frozenProfile } from "../src/compiler/profile.js";
import type { AcceptedCompilerCandidate, CompilerCandidate } from "../src/compiler/types.js";
import {
  derivePackBindings,
  normalizeSourceText,
  validateCompilerCandidateForIntake,
} from "../src/compiler/validator.js";
import { hashCanonical } from "../src/canonical/index.js";
import { buildDeliveryCard } from "../src/intake/card.js";
import { buildDeliveryRequestDraft } from "../src/intake/request.js";
import {
  IntakeStore,
  slice3aExtensionOrigin,
} from "../src/intake/store.js";
import type { ApprovedIntake, OwnerAuthorizationReceipt } from "../src/intake/types.js";
import { parseNativeRequest } from "../src/native/protocol.js";
import { fixtureExecutorCapabilityDigest } from "../src/profiles/codex-fixture-executor.js";
import { fixtureResolverCapabilityDigest } from "../src/resolver/fixture-single-running-objective.js";
import { slice4RepairExecutionCapabilityDigest } from "../src/safety/slice4/admission.js";
import { slice4ResolverCapabilityDigest } from "../src/safety/slice4/resolver.js";
import { BetterSqlite3Driver } from "../src/storage/better-sqlite3-driver.js";
import {
  EventStore,
  type ActivationDispatchBindingInput,
} from "../src/storage/event-store.js";
import type { JsonValue, RunSeed } from "../src/types.js";

const fixtureDirectory = join(process.cwd(), "test", "fixtures", "slice3a");

function testPaths(name: string) {
  const root = join(process.cwd(), ".ados-local", "test", `slice3b-${name}-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  return {
    root,
    database: join(root, "state.sqlite"),
    identity: join(root, "device-identity.json"),
  };
}

function compilerCandidate(
  authorization: OwnerAuthorizationReceipt["authorization"],
): { readonly capture: ReturnType<typeof validateCapturePack>; readonly candidate: AcceptedCompilerCandidate } {
  const capture = validateCapturePack(
    JSON.parse(readFileSync(join(fixtureDirectory, "chatgpt-supported.json"), "utf8")) as unknown,
  );
  const profile = frozenProfile();
  const compilerPack = compilerPackForCapture(capture);
  const bindings = derivePackBindings(compilerPack);
  const owner = compilerPack.turns.find((turn) =>
    compilerPack.selected_turn_ids.includes(turn.turn_id) && turn.role === "owner");
  assert.ok(owner);
  const decision = normalizeSourceText(owner.text);
  const value: CompilerCandidate = {
    schema_version: "gate0a-compiler-candidate/v0.2",
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    prompt_version: profile.prompt_version,
    capability_digest: profile.capability_digest,
    case_id: "clear-ready",
    selected_turn_digest: bindings.selected_turn_digest,
    owner_turn_digest: bindings.owner_turn_digest,
    disposition: "PROPOSE",
    outcome: "Add the exact deterministic owner-review fixture output and preserve all accepted outputs.",
    owner_decisions: [{
      decision,
      source_turn_id: owner.turn_id,
      source_quote: decision,
      source_span: {
        normalization: "unicode-nfkc-whitespace-v0.1",
        start: 0,
        end: decision.length,
      },
    }],
    assumptions: [],
    open_decisions: [],
    readiness: "READY",
    material_question: null,
    requested_authorization: authorization,
    risk_flags: ["LOCAL_SYNTHETIC_ONLY"],
    rejection_reason: null,
  };
  return {
    capture,
    candidate: validateCompilerCandidateForIntake(value, compilerPack, profile.capability_digest),
  };
}

async function approvedIntake(
  database: string,
  identity: string,
  authorization: OwnerAuthorizationReceipt["authorization"],
  migrationsDirectory?: string,
): Promise<ApprovedIntake> {
  const { capture, candidate } = compilerCandidate(authorization);
  const profile = frozenProfile();
  const draft = buildDeliveryRequestDraft(capture, candidate, profile);
  const card = buildDeliveryCard(draft, capture, candidate, profile);
  const store = await IntakeStore.open(database, {
    deviceIdentityPath: identity,
    ...(migrationsDirectory === undefined ? {} : { migrationsDirectory }),
    now: () => "2026-08-05T04:20:00.000Z",
  });
  try {
    const challenge = store.issueChallenge({
      extension_origin: slice3aExtensionOrigin,
      draft,
      card,
      owner_turn_digest: capture.owner_turn_digest,
      requested_authorization: authorization,
      capture_profile_id: capture.pack.capture_profile_id,
      capture_profile_version: capture.pack.capture_profile_version,
      compiler_profile_id: profile.profile_id,
      compiler_profile_version: profile.profile_version,
      compiler_candidate_digest: candidate.candidate_digest,
      capture_digest: capture.capture_digest,
    });
    return store.confirm({
      extension_origin: slice3aExtensionOrigin,
      challenge: challenge.challenge,
      challenge_token: challenge.challenge_token,
    });
  } finally {
    store.close();
  }
}

function seedFor(intake: ApprovedIntake): RunSeed {
  return {
    run_id: "run-slice3b-binding-0001",
    request_id: intake.request_id,
    objective_id: "fixture-owner-review-v0.1",
    objective_ref: "fixture.invalid/ados-fixture-delivery#3",
    request_digest: intake.request_digest,
    objective_digest: hashCanonical({ objective: "fixture-owner-review-v0.1" }),
    envelope_digest: hashCanonical({ envelope: "slice3b-binding-0001" }),
    generation: 1,
    lease_key: "fixture-owner-review-v0.1",
    holder_id: "coordinator-slice3b-binding",
    ttl_seconds: 3600,
    obligations: [{
      obligation_id: "owner-acceptance",
      category: "owner",
      verifier_id: "verifier.owner",
      minimum_trust: "T4",
    }],
  };
}

function bindingInput(intake: ApprovedIntake): ActivationDispatchBindingInput {
  const seed = seedFor(intake);
  return {
    dispatch_id: "dispatch-slice3b-binding-0001",
    activation_id: intake.activation.activation_id,
    resolver_profile_id: "resolver.fixture-single-running-objective",
    resolver_profile_version: "0.1.0-public.1",
    resolver_capability_digest: fixtureResolverCapabilityDigest(),
    resolution_digest: hashCanonical({ objective_ref: "fixture.invalid/ados-fixture-delivery#3", base: "9177" }),
    repository_full_name: "fixture.invalid/ados-fixture-delivery",
    repository_id: "10002",
    objective_ref: "fixture.invalid/ados-fixture-delivery#3",
    objective_digest: seed.objective_digest,
    project_harness_ref: "fixture.invalid/ados-fixture-delivery@e75d162750acf4775a7a1ba1d1955ca9d60bc73f#docs/HARNESS.md",
    harness_digest: hashCanonical({ harness: "fixture-9177" }),
    base_sha: "e75d162750acf4775a7a1ba1d1955ca9d60bc73f",
    execution_profile_id: "executor.codex-app-server.fixture-v0.1",
    execution_profile_version: "0.1.0-public.1",
    execution_capability_digest: fixtureExecutorCapabilityDigest(),
    seed,
  };
}

function slice4BindingInput(intake: ApprovedIntake): ActivationDispatchBindingInput {
  const objectiveDigest = hashCanonical({ objective: "fixture-dogfood-safety-v0.1" });
  const seed: RunSeed = {
    ...seedFor(intake),
    run_id: "run-slice4-repair-binding-0001",
    objective_id: "fixture-dogfood-safety-v0.1",
    objective_ref: "fixture.invalid/ados-fixture-delivery#5",
    objective_digest: objectiveDigest,
    envelope_digest: hashCanonical({ envelope: "slice4-repair-binding-0001" }),
    lease_key: "fixture-dogfood-safety-v0.1",
    holder_id: "coordinator-slice4-repair-binding",
  };
  return {
    dispatch_id: "dispatch-slice4-repair-binding-0001",
    activation_id: intake.activation.activation_id,
    resolver_profile_id: "resolver.fixture-single-running-objective",
    resolver_profile_version: "0.1.1-public.1",
    resolver_capability_digest: slice4ResolverCapabilityDigest(),
    resolution_digest: hashCanonical({ objective_ref: seed.objective_ref, base: "9bb8" }),
    repository_full_name: "fixture.invalid/ados-fixture-delivery",
    repository_id: "10002",
    objective_ref: "fixture.invalid/ados-fixture-delivery#5",
    objective_digest: seed.objective_digest,
    project_harness_ref: "fixture.invalid/ados-fixture-delivery@4e772e775cbc843420c8580fcff8a85c92754bdd#docs/HARNESS.md",
    harness_digest: hashCanonical({ harness: "fixture-9bb8" }),
    base_sha: "4e772e775cbc843420c8580fcff8a85c92754bdd",
    execution_profile_id: "executor.codex-app-server.fixture-v0.1",
    execution_profile_version: "0.1.0-slice4-repair-public.1",
    execution_capability_digest: slice4RepairExecutionCapabilityDigest(),
    seed,
  };
}

function runBindingWorker(
  databasePath: string,
  binding: ActivationDispatchBindingInput,
): Promise<Record<string, unknown>> {
  const worker = join(process.cwd(), "dist", "src", "dispatch", "binding-worker.js");
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(process.execPath, [worker], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectWorker);
    child.once("exit", (code) => {
      if (code !== 0) {
        rejectWorker(new Error(`BINDING_WORKER_EXIT:${code}:${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      resolveWorker(JSON.parse(Buffer.concat(stdout).toString("utf8")) as Record<string, unknown>);
    });
    child.stdin.end(JSON.stringify({ database_path: databasePath, binding }));
  });
}

test("migration 0006 preserves the immutable dispatch binding surface", async () => {
  const paths = testPaths("migration");
  try {
    const intake = await IntakeStore.open(paths.database, { deviceIdentityPath: paths.identity });
    assert.equal(intake.migrations.length, 6);
    intake.close();
    const driver = new BetterSqlite3Driver(paths.database, { readonly: true, fileMustExist: true });
    try {
      assert.equal(driver.get<{ readonly count: number }>(
        "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'activation_dispatch_bindings'",
      )?.count, 1);
      const triggers = driver.all<{ readonly name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'activation_dispatch_bindings_%' ORDER BY name",
      ).map((row) => row.name);
      assert.deepEqual(triggers, [
        "activation_dispatch_bindings_no_delete",
        "activation_dispatch_bindings_no_update",
      ]);
      assert.equal(String(driver.pragma("integrity_check", true)), "ok");
    } finally {
      driver.close();
    }
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("migration 0006 preserves legacy rows and admits only complete frozen dispatch tuples", async () => {
  const legacyPaths = testPaths("migration-0006-legacy-row");
  try {
    const migrationCopy = join(legacyPaths.root, "migrations");
    cpSync(join(process.cwd(), "migrations"), migrationCopy, { recursive: true });
    const source0006 = join(process.cwd(), "migrations", "0006_slice4_dispatch_binding.sql");
    const copied0006 = join(migrationCopy, "0006_slice4_dispatch_binding.sql");
    rmSync(copied0006);
    const intake = await approvedIntake(
      legacyPaths.database,
      legacyPaths.identity,
      "IMPLEMENT",
      migrationCopy,
    );
    const legacyInput = bindingInput(intake);
    const legacyStore = new EventStore(legacyPaths.database, { migrationsDirectory: migrationCopy });
    legacyStore.bindActivationToRun(legacyInput);
    legacyStore.close();

    writeFileSync(copied0006, readFileSync(source0006, "utf8"), "utf8");
    const migrated = await IntakeStore.open(legacyPaths.database, {
      deviceIdentityPath: legacyPaths.identity,
      migrationsDirectory: migrationCopy,
    });
    assert.equal(migrated.migrations.length, 6);
    migrated.close();

    const readback = new EventStore(legacyPaths.database, { migrationsDirectory: migrationCopy });
    assert.equal(
      readback.dispatchBinding(intake.activation.activation_id)?.run_id,
      legacyInput.seed.run_id,
    );
    readback.verifyEventChain();
    readback.verifyProjectionConsistency();
    readback.close();
  } finally {
    rmSync(legacyPaths.root, { recursive: true, force: true });
  }

  const exactPaths = testPaths("migration-0006-slice4-exact");
  try {
    const intake = await approvedIntake(exactPaths.database, exactPaths.identity, "IMPLEMENT");
    const input = slice4BindingInput(intake);
    const store = new EventStore(exactPaths.database);
    const bound = store.bindActivationToRun(input);
    assert.equal(bound.disposition, "CREATED");
    assert.equal(bound.binding.objective_ref, "fixture.invalid/ados-fixture-delivery#5");
    assert.equal(bound.run.state, "PREPARED");
    store.close();
  } finally {
    rmSync(exactPaths.root, { recursive: true, force: true });
  }

  const mixedPaths = testPaths("migration-0006-slice4-mixed");
  try {
    const intake = await approvedIntake(mixedPaths.database, mixedPaths.identity, "IMPLEMENT");
    const input = slice4BindingInput(intake);
    const mixed: ActivationDispatchBindingInput = {
      ...input,
      resolver_profile_version: "0.1.0-public.1",
      resolver_capability_digest: fixtureResolverCapabilityDigest(),
    };
    const store = new EventStore(mixedPaths.database);
    assert.throws(
      () => store.bindActivationToRun(mixed),
      /CHECK constraint failed/u,
    );
    assert.equal(store.dispatchBinding(intake.activation.activation_id), null);
    assert.throws(() => store.getRun(input.seed.run_id), /RUN_NOT_FOUND/u);
    store.close();
  } finally {
    rmSync(mixedPaths.root, { recursive: true, force: true });
  }
});

test("migration 0005 checksum drift is rejected without rewriting the database", async () => {
  const paths = testPaths("migration-drift");
  try {
    const intake = await IntakeStore.open(paths.database, { deviceIdentityPath: paths.identity });
    intake.close();
    const migrationCopy = join(paths.root, "migrations");
    cpSync(join(process.cwd(), "migrations"), migrationCopy, { recursive: true });
    const migrationPath = join(migrationCopy, "0005_activation_dispatch.sql");
    writeFileSync(migrationPath, `${readFileSync(migrationPath, "utf8")}\n-- drift\n`, "utf8");
    await assert.rejects(
      IntakeStore.open(paths.database, {
        deviceIdentityPath: paths.identity,
        migrationsDirectory: migrationCopy,
      }),
      /MIGRATION_IDENTITY_MISMATCH:0005_activation_dispatch.sql/,
    );
    const driver = new BetterSqlite3Driver(paths.database, { readonly: true, fileMustExist: true });
    assert.equal(String(driver.pragma("integrity_check", true)), "ok");
    driver.close();
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("two concurrent dispatch transactions create one binding and reconcile one Run", async () => {
  const paths = testPaths("concurrent");
  try {
    const intake = await approvedIntake(paths.database, paths.identity, "IMPLEMENT");
    const input = bindingInput(intake);
    const outcomes = await Promise.all([
      runBindingWorker(paths.database, input),
      runBindingWorker(paths.database, input),
    ]);
    assert.deepEqual(
      outcomes.map((outcome) => outcome.disposition).sort(),
      ["CREATED", "DUPLICATE_RECONCILED"],
    );
    assert.equal(new Set(outcomes.map((outcome) => outcome.dispatch_id)).size, 1);
    assert.equal(new Set(outcomes.map((outcome) => outcome.run_id)).size, 1);
    const store = new EventStore(paths.database);
    assert.equal(store.summary(input.seed.run_id).event_count, 2);
    assert.equal(store.summary(input.seed.run_id).approval_count, 1);
    store.verifyProjectionConsistency();
    store.close();
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("IMPLEMENT Activation binds atomically, survives lost response, reconciles duplicates, rebuild and backup", async () => {
  const paths = testPaths("binding");
  try {
    const intake = await approvedIntake(paths.database, paths.identity, "IMPLEMENT");
    const input = bindingInput(intake);
    const before = new EventStore(paths.database);
    assert.throws(
      () => before.bindActivationToRun({ ...input, fault: "before_commit" }),
      /TEST_FAULT:BEFORE_DISPATCH_COMMIT/,
    );
    assert.equal(before.dispatchBinding(intake.activation.activation_id), null);
    assert.throws(() => before.getRun(input.seed.run_id), /RUN_NOT_FOUND/);
    before.close();

    const lost = new EventStore(paths.database);
    assert.throws(
      () => lost.bindActivationToRun({ ...input, fault: "after_commit" }),
      /TEST_FAULT:AFTER_DISPATCH_COMMIT/,
    );
    lost.close();

    const reconciled = new EventStore(paths.database);
    const duplicate = reconciled.bindActivationToRun(input);
    assert.equal(duplicate.disposition, "DUPLICATE_RECONCILED");
    assert.equal(duplicate.binding.run_id, input.seed.run_id);
    assert.equal(duplicate.receipt.receipt_id, intake.receipt.receipt_id);
    const summary = reconciled.summary(input.seed.run_id);
    assert.equal(summary.approval_count, 1);
    assert.equal(summary.event_count, 2);
    assert.equal(summary.run.state, "PREPARED");
    assert.throws(
      () => reconciled.bindActivationToRun({
        ...input,
        resolution_digest: hashCanonical({ conflicting: true }),
      }),
      /BLOCKED_DISPATCH_BINDING_CONFLICT/,
    );
    reconciled.rebuildProjections();
    reconciled.verifyEventChain();
    reconciled.verifyProjectionConsistency();
    const backup = join(paths.root, "binding-backup.sqlite");
    await reconciled.backup(backup);
    reconciled.close();

    const restored = new EventStore(backup);
    assert.equal(restored.dispatchBinding(intake.activation.activation_id)?.run_id, input.seed.run_id);
    assert.equal(restored.summary(input.seed.run_id).approval_count, 1);
    restored.verifyProjectionConsistency();
    restored.close();

    const driver = new BetterSqlite3Driver(paths.database);
    try {
      assert.throws(
        () => driver.run("UPDATE activation_dispatch_bindings SET repository_id = ? WHERE activation_id = ?", ["drift", intake.activation.activation_id]),
        /IMMUTABLE_ACTIVATION_DISPATCH_BINDING/,
      );
      assert.throws(
        () => driver.run("DELETE FROM activation_dispatch_bindings WHERE activation_id = ?", [intake.activation.activation_id]),
        /IMMUTABLE_ACTIVATION_DISPATCH_BINDING/,
      );
    } finally {
      driver.close();
    }
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("DISCOVERY Activation is mechanically rejected and creates zero binding or Run", async () => {
  const paths = testPaths("authorization");
  try {
    const intake = await approvedIntake(paths.database, paths.identity, "DISCOVERY");
    const input = bindingInput(intake);
    const store = new EventStore(paths.database);
    try {
      assert.throws(() => store.bindActivationToRun(input), /BLOCKED_DISPATCH_AUTHORIZATION/);
      assert.equal(store.dispatchBinding(intake.activation.activation_id), null);
      assert.throws(() => store.getRun(input.seed.run_id), /RUN_NOT_FOUND/);
    } finally {
      store.close();
    }
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("Native protocol admits only exact dispatch and resume messages", () => {
  const activationId = `activation-${"a".repeat(32)}`;
  for (const kind of ["dispatch", "resume"] as const) {
    assert.equal(parseNativeRequest({
      schema_version: "slice3a-native-message/v0.1",
      kind,
      activation_id: activationId,
    }).kind, kind);
    assert.throws(
      () => parseNativeRequest({
        schema_version: "slice3a-native-message/v0.1",
        kind,
        activation_id: activationId,
        repository: "forbidden",
      }),
      /BLOCKED_NATIVE_PROTOCOL:ADDITIONAL_PROPERTIES/,
    );
  }
});

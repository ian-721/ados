import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { validateCapturePack, compilerPackForCapture } from "../src/capture/profile.js";
import { frozenProfile } from "../src/compiler/profile.js";
import type {
  AcceptedCompilerCandidate,
  CompilerCandidate,
  ConversationEvidencePack,
} from "../src/compiler/types.js";
import {
  derivePackBindings,
  normalizeSourceText,
  validateCompilerCandidateForIntake,
} from "../src/compiler/validator.js";
import { hashCanonical } from "../src/canonical/index.js";
import {
  IntakeService,
  type ConfirmationRevalidator,
  type IntakeCompilerPort,
} from "../src/intake/service.js";
import {
  IntakeStore,
  slice3aExtensionOrigin,
} from "../src/intake/store.js";
import type {
  ConfirmationRevalidation,
  DurableReadyCardIdentity,
} from "../src/intake/types.js";
import { EventStore } from "../src/storage/event-store.js";
import { BetterSqlite3Driver } from "../src/storage/better-sqlite3-driver.js";
import {
  encodeNativeMessage,
  parseNativeRequest,
  readNativeMessage,
  sanitizeNativeHostError,
} from "../src/native/protocol.js";
import { Readable } from "node:stream";

const fixtureDirectory = join(process.cwd(), "test", "fixtures", "slice3a");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDirectory, name), "utf8")) as unknown;
}

function fakeCandidate(pack: ConversationEvidencePack): AcceptedCompilerCandidate {
  const profile = frozenProfile();
  const bindings = derivePackBindings(pack);
  const owner = pack.turns.find(
    (turn) => pack.selected_turn_ids.includes(turn.turn_id) && turn.role === "owner",
  );
  if (owner === undefined) {
    throw new Error("TEST_OWNER_TURN_MISSING");
  }
  const decision = normalizeSourceText(owner.text);
  const candidate: CompilerCandidate = {
    schema_version: "gate0a-compiler-candidate/v0.2",
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    prompt_version: profile.prompt_version,
    capability_digest: profile.capability_digest,
    case_id: "clear-ready",
    selected_turn_digest: bindings.selected_turn_digest,
    owner_turn_digest: bindings.owner_turn_digest,
    disposition: "PROPOSE",
    outcome: "Create one bounded local intake Activation without dispatching any work.",
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
    requested_authorization: "IMPLEMENT",
    risk_flags: ["LOCAL_SYNTHETIC_ONLY"],
    rejection_reason: null,
  };
  return validateCompilerCandidateForIntake(candidate, pack, profile.capability_digest);
}

class FakeCompiler implements IntakeCompilerPort {
  public calls = 0;

  public async compile(pack: ConversationEvidencePack) {
    this.calls += 1;
    const candidate = fakeCandidate(pack);
    return {
      candidate,
      profile: frozenProfile(),
      evidence: {
        prompt_digest: hashCanonical({ fixture: "slice3a-fake-compiler" }),
        tool_items: 0 as const,
        server_requests: 0,
        cleanup: "PASS" as const,
        residual_process_status: "ABSENT" as const,
      },
    };
  }
}

function fakeConfirmationRevalidation(
  overrides: Partial<ConfirmationRevalidation> = {},
): ConfirmationRevalidation {
  const profile = frozenProfile();
  return {
    schema_version: "slice3b-confirmation-revalidation/v0.1",
    local_objective_ref: "fixture.invalid/ados-local#9",
    local_objective_digest: hashCanonical({ objective: "local-slice3b" }),
    target_objective_ref: "fixture.invalid/ados-fixture-delivery#3",
    target_objective_digest: hashCanonical({ objective: "fixture-owner-review-v0.1" }),
    target_resolution_digest: hashCanonical({ resolution: "fixture-owner-review-v0.1" }),
    target_harness_digest: hashCanonical({ harness: "fixture-owner-review-v0.1" }),
    target_base_sha: "e75d162750acf4775a7a1ba1d1955ca9d60bc73f",
    compiler_profile_digest: profile.profile_digest,
    compiler_capability_digest: profile.capability_digest,
    ...overrides,
  };
}

function fakeSlice4ConfirmationRevalidation(
  overrides: Partial<ConfirmationRevalidation> = {},
): ConfirmationRevalidation {
  return fakeConfirmationRevalidation({
    local_objective_ref: "fixture.invalid/ados-local#11",
    target_objective_ref: "fixture.invalid/ados-fixture-delivery#5",
    target_base_sha: "4e772e775cbc843420c8580fcff8a85c92754bdd",
    ...overrides,
  });
}

class FakeConfirmationRevalidator implements ConfirmationRevalidator {
  public calls = 0;
  public current = fakeConfirmationRevalidation();

  public revalidate(): ConfirmationRevalidation {
    this.calls += 1;
    return this.current;
  }
}

function readyCardIdentityFor(
  compiled: Awaited<ReturnType<IntakeService["compile"]>>,
  revalidation: ConfirmationRevalidation,
): DurableReadyCardIdentity {
  return {
    challenge_id: compiled.challenge.challenge_id,
    selected_turn_digest: compiled.challenge.selected_turn_digest,
    owner_turn_digest: compiled.challenge.owner_turn_digest,
    compiler_candidate_digest: compiled.challenge.compiler_candidate_digest,
    request_id: compiled.challenge.request_id,
    request_digest: compiled.challenge.request_digest,
    card_digest: compiled.card_digest,
    capture_digest: compiled.challenge.capture_digest,
    compiler_profile_id: "compiler.codex-app-server.gate0a-no-tools",
    compiler_profile_version: "0.3.1-public.1",
    compiler_profile_digest: revalidation.compiler_profile_digest,
    compiler_capability_digest: revalidation.compiler_capability_digest,
    local_objective_digest: revalidation.local_objective_digest,
    target_objective_digest: revalidation.target_objective_digest,
    target_resolution_digest: revalidation.target_resolution_digest,
    target_harness_digest: revalidation.target_harness_digest,
  };
}

function testPaths(name: string) {
  const root = join(process.cwd(), ".ados-local", "test", `slice3a-${name}-${process.pid}-${Date.now()}`);
  return {
    root,
    database: join(root, "state.sqlite"),
    identity: join(root, "device-identity.json"),
  };
}

function decodeNativeResponse(frame: Buffer): Record<string, unknown> {
  assert.ok(frame.byteLength >= 4);
  const length = frame.readUInt32LE(0);
  assert.equal(frame.byteLength, length + 4);
  return JSON.parse(frame.subarray(4).toString("utf8")) as Record<string, unknown>;
}

function runNativeHost(cwd: string, message: unknown): Promise<Record<string, unknown>> {
  const host = join(cwd, "dist", "src", "native", "host.js");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [host, slice3aExtensionOrigin], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`NATIVE_HOST_EXIT:${code}:${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      assert.equal(Buffer.concat(stderr).toString("utf8"), "");
      resolve(decodeNativeResponse(Buffer.concat(stdout)));
    });
    child.stdin.end(encodeNativeMessage(message));
  });
}

function runJitConfirmWorker(
  database: string,
  identity: string,
  now: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  const worker = [
    "import { IntakeStore } from './dist/src/intake/store.js';",
    "let source = '';",
    "process.stdin.setEncoding('utf8');",
    "for await (const chunk of process.stdin) source += chunk;",
    "const payload = JSON.parse(source);",
    "const store = await IntakeStore.open(payload.database, { deviceIdentityPath: payload.identity, now: () => payload.now, jitConfirmationTtlMs: 30000 });",
    "try { console.log(JSON.stringify(store.confirm(payload.input))); } finally { store.close(); }",
  ].join("\n");
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", worker], {
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
        rejectWorker(new Error(`JIT_CONFIRM_WORKER_EXIT:${code}:${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      resolveWorker(JSON.parse(Buffer.concat(stdout).toString("utf8")) as Record<string, unknown>);
    });
    child.stdin.end(JSON.stringify({ database, identity, now, input }));
  });
}

test("ChatGPT capture profile binds visible roles, minimizes identity, and fails closed on parser drift", () => {
  const supported = validateCapturePack(fixture("chatgpt-supported.json"));
  assert.match(supported.conversation_ref, /^chatgpt:\/\/conversation\/(?:direct|scoped)\/[a-f0-9]{64}$/u);
  assert.doesNotMatch(supported.conversation_ref, /sanitized-fixture/u);
  assert.deepEqual(supported.role_summary, [
    { role: "owner", count: 1 },
    { role: "assistant", count: 1 },
    { role: "quoted_external", count: 1 },
  ]);
  const compilerPack = compilerPackForCapture(supported);
  assert.equal(compilerPack.turns[1]?.role, "assistant");
  assert.throws(
    () => validateCapturePack(fixture("chatgpt-parser-drift.json")),
    /BLOCKED_CAPTURE:ROLE_UNKNOWN/,
  );
  const spoofed = structuredClone(fixture("chatgpt-supported.json")) as Record<string, unknown>;
  const turns = spoofed.turns as Array<Record<string, unknown>>;
  turns[0]!.role = "assistant";
  assert.throws(() => validateCapturePack(spoofed), /BLOCKED_CAPTURE:ROLE_PROOF_MISMATCH/);

  const scoped = structuredClone(fixture("chatgpt-supported.json")) as Record<string, unknown>;
  scoped.conversation_ref = `chatgpt://conversation/scoped/${"b".repeat(64)}`;
  assert.equal(validateCapturePack(scoped).conversation_ref, scoped.conversation_ref);

  const rawUrl = structuredClone(fixture("chatgpt-supported.json")) as Record<string, unknown>;
  rawUrl.conversation_ref = "https://chatgpt.com/g/project/c/conversation?account=owner#state";
  assert.throws(() => validateCapturePack(rawUrl), /BLOCKED_CAPTURE:CONVERSATION_REF/);
});

test("migrations 0004-0006 upgrade only the intake path, verify backup, and preserve Run state", async () => {
  const paths = testPaths("upgrade");
  try {
    const runStore = new EventStore(paths.database);
    const created = runStore.createRun({
      run_id: "run-slice3a-upgrade-0001",
      request_id: "dr-slice3a-upgrade-0001",
      objective_id: "objective-slice3a-upgrade-0001",
      objective_ref: "fixture://slice3a/objective/upgrade",
      request_digest: hashCanonical({ request: "slice3a-upgrade" }),
      objective_digest: hashCanonical({ objective: "slice3a-upgrade" }),
      envelope_digest: hashCanonical({ envelope: "slice3a-upgrade" }),
      generation: 1,
      lease_key: "objective-slice3a-upgrade-0001",
      holder_id: "coordinator-slice3a-upgrade-0001",
      ttl_seconds: 300,
      obligations: [{
        obligation_id: "engineering-core",
        category: "engineering",
        verifier_id: "verifier.core",
        minimum_trust: "T2",
      }],
    });
    assert.equal(runStore.migrations.length, 3);
    runStore.close();

    const intake = await IntakeStore.open(paths.database, { deviceIdentityPath: paths.identity });
    assert.equal(intake.migrations.length, 6);
    assert.notEqual(intake.backupPath, null);
    const backup = new BetterSqlite3Driver(intake.backupPath!, { readonly: true, fileMustExist: true });
    assert.equal(
      backup.get<{ readonly count: number }>("SELECT count(*) AS count FROM schema_migrations")?.count,
      3,
    );
    assert.equal(String(backup.pragma("integrity_check", true)), "ok");
    backup.close();
    intake.close();

    const reopened = new EventStore(paths.database);
    assert.equal(reopened.migrations.length, 3);
    assert.equal(reopened.getRun(created.run.run_id).request_digest, created.run.request_digest);
    reopened.verifyEventChain();
    reopened.verifyProjectionConsistency();
    reopened.close();
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("one authenticated confirm atomically creates request, Receipt, Activation and reconciles duplicates", async () => {
  const paths = testPaths("approve");
  let now = "2026-08-04T05:40:00.000Z";
  const store = await IntakeStore.open(paths.database, {
    deviceIdentityPath: paths.identity,
    now: () => now,
  });
  try {
    const service = new IntakeService(store, new FakeCompiler());
    const compiled = await service.compile(fixture("chatgpt-supported.json"), slice3aExtensionOrigin);
    assert.equal(compiled.status, "READY_FOR_CONFIRMATION");
    assert.equal(compiled.consequence, "APPROVED_NOT_DISPATCHED");
    assert.deepEqual(store.counts(), { challenges: 1, requests: 0, receipts: 0, activations: 0, events: 0 });

    assert.throws(
      () => service.confirm(slice3aExtensionOrigin, compiled.challenge, compiled.challenge_token, "before_commit"),
      /TEST_FAULT:BEFORE_COMMIT/,
    );
    assert.deepEqual(store.counts(), { challenges: 1, requests: 0, receipts: 0, activations: 0, events: 0 });

    now = "2026-08-04T05:41:00.000Z";
    const approved = service.confirm(slice3aExtensionOrigin, compiled.challenge, compiled.challenge_token);
    assert.equal(approved.disposition, "CREATED");
    assert.equal(approved.activation.status, "APPROVED_NOT_DISPATCHED");
    assert.equal(approved.receipt.authn_method, "local_extension_confirm");
    assert.deepEqual(store.counts(), { challenges: 1, requests: 1, receipts: 1, activations: 1, events: 1 });

    const duplicate = service.confirm(slice3aExtensionOrigin, compiled.challenge, compiled.challenge_token);
    assert.equal(duplicate.disposition, "DUPLICATE_RECONCILED");
    assert.equal(duplicate.receipt.receipt_id, approved.receipt.receipt_id);
    assert.equal(duplicate.activation.activation_id, approved.activation.activation_id);
    assert.deepEqual(store.counts(), { challenges: 1, requests: 1, receipts: 1, activations: 1, events: 1 });
    const rebuilt = store.rebuildProjectionSnapshot();
    assert.equal(rebuilt.length, 1);
    assert.equal(rebuilt[0]?.activation.activation_id, approved.activation.activation_id);

    const mutated = structuredClone(compiled.challenge);
    (mutated as { request_digest: string }).request_digest = hashCanonical({ mutation: true });
    assert.throws(
      () => service.confirm(slice3aExtensionOrigin, mutated, compiled.challenge_token),
      /BLOCKED_RECEIPT:CHALLENGE_AUTHENTICATION/,
    );
    store.verifyEventChain();
    store.verifyProjectionConsistency();

    const durableBackup = join(paths.root, "approved-backup.sqlite");
    await store.backup(durableBackup);
    const restoredStore = await IntakeStore.open(durableBackup, {
      deviceIdentityPath: join(paths.root, "restored-device-identity.json"),
    });
    const restored = restoredStore.status(approved.request_digest);
    assert.equal(restored?.receipt.receipt_id, approved.receipt.receipt_id);
    assert.equal(restored?.activation.activation_id, approved.activation.activation_id);
    restoredStore.verifyEventChain();
    restoredStore.verifyProjectionConsistency();
    restoredStore.close();
  } finally {
    store.close();
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("expired unconsumed READY Card rehydrates through a read-only reopen with identical identity and zero Compiler or durable writes", async () => {
  const paths = testPaths("ready-card-rehydrate");
  let now = "2026-08-05T10:00:00.000Z";
  const compiler = new FakeCompiler();
  const revalidator = new FakeConfirmationRevalidator();
  let store = await IntakeStore.open(paths.database, {
    deviceIdentityPath: paths.identity,
    now: () => now,
    challengeTtlMs: 1_000,
  });
  try {
    const compiled = await new IntakeService(store, compiler, revalidator).compile(
      fixture("chatgpt-supported.json"),
      slice3aExtensionOrigin,
    );
    const expected = readyCardIdentityFor(compiled, revalidator.current);
    const beforeCounts = store.counts();
    assert.equal(compiler.calls, 1);
    store.close();

    now = "2026-08-05T10:00:02.000Z";
    const beforeMtime = statSync(paths.database).mtimeMs;
    store = IntakeStore.openReadOnly(paths.database, {
      deviceIdentityPath: paths.identity,
      now: () => now,
    });
    const restored = new IntakeService(
      store,
      compiler,
      revalidator,
      revalidator,
      expected,
    ).restoreReadyCard(slice3aExtensionOrigin);
    assert.equal(restored.status, "READY_FOR_CONFIRMATION");
    assert.equal(restored.restoration, "DURABLE_READY_CARD_REHYDRATED");
    assert.equal(restored.card_digest, compiled.card_digest);
    assert.deepEqual(restored.card, compiled.card);
    assert.deepEqual(restored.request, compiled.request);
    assert.deepEqual(restored.challenge, compiled.challenge);
    assert.equal(restored.challenge_token, compiled.challenge_token);
    assert.deepEqual(store.counts(), beforeCounts);
    assert.equal(compiler.calls, 1);
    store.close();
    assert.equal(statSync(paths.database).mtimeMs, beforeMtime);

    store = await IntakeStore.open(paths.database, {
      deviceIdentityPath: paths.identity,
      now: () => now,
      challengeTtlMs: 1_000,
    });
    assert.throws(
      () => new IntakeService(store, compiler, revalidator).confirm(
        slice3aExtensionOrigin,
        restored.challenge,
        restored.challenge_token,
      ),
      /BLOCKED_RECEIPT:CHALLENGE_EXPIRED/u,
    );
    assert.deepEqual(store.counts(), beforeCounts);
    assert.equal(compiler.calls, 1);
  } finally {
    try {
      store.close();
    } catch {
      // The same test deliberately crosses writable/read-only reopen boundaries.
    }
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("READY Card rehydration fails closed on zero or multiple eligible candidates", async () => {
  const emptyPaths = testPaths("ready-card-none");
  let emptyStore = await IntakeStore.open(emptyPaths.database, {
    deviceIdentityPath: emptyPaths.identity,
    now: () => "2026-08-05T10:10:00.000Z",
  });
  try {
    emptyStore.close();
    emptyStore = IntakeStore.openReadOnly(emptyPaths.database, {
      deviceIdentityPath: emptyPaths.identity,
      now: () => "2026-08-05T10:10:02.000Z",
    });
    assert.throws(
      () => emptyStore.restoreReadyCard({
        extension_origin: slice3aExtensionOrigin,
        revalidation: fakeConfirmationRevalidation(),
        identity: {} as DurableReadyCardIdentity,
      }),
      /BLOCKED_READY_CARD_RESTORE:NO_CANDIDATE/u,
    );
  } finally {
    try {
      emptyStore.close();
    } catch {
      // The empty store is deliberately reopened read-only.
    }
    rmSync(emptyPaths.root, { recursive: true, force: true });
  }

  const multiplePaths = testPaths("ready-card-multiple");
  let multipleStore = await IntakeStore.open(multiplePaths.database, {
    deviceIdentityPath: multiplePaths.identity,
    now: () => "2026-08-05T10:20:00.000Z",
    challengeTtlMs: 1_000,
  });
  try {
    const compiler = new FakeCompiler();
    const service = new IntakeService(multipleStore, compiler, new FakeConfirmationRevalidator());
    const first = await service.compile(fixture("chatgpt-supported.json"), slice3aExtensionOrigin);
    const secondCapture = structuredClone(fixture("chatgpt-supported.json")) as Record<string, unknown>;
    secondCapture.captured_at = "2026-08-05T10:20:00.500Z";
    secondCapture.conversation_ref = "chatgpt://conversation/direct/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const second = await service.compile(secondCapture, slice3aExtensionOrigin);
    assert.notEqual(first.challenge.challenge_id, second.challenge.challenge_id);
    multipleStore.close();
    multipleStore = IntakeStore.openReadOnly(multiplePaths.database, {
      deviceIdentityPath: multiplePaths.identity,
      now: () => "2026-08-05T10:20:02.000Z",
    });
    assert.throws(
      () => multipleStore.restoreReadyCard({
        extension_origin: slice3aExtensionOrigin,
        revalidation: fakeConfirmationRevalidation(),
        identity: readyCardIdentityFor(first, fakeConfirmationRevalidation()),
      }),
      /BLOCKED_READY_CARD_RESTORE:MULTIPLE_CANDIDATES:2/u,
    );
  } finally {
    try {
      multipleStore.close();
    } catch {
      // The multiple-candidate store is deliberately reopened read-only.
    }
    rmSync(multiplePaths.root, { recursive: true, force: true });
  }
});

test("READY Card rehydration rejects frozen binding, Objective, target, Profile, origin, and device drift with zero durable writes", async () => {
  const paths = testPaths("ready-card-drift");
  let now = "2026-08-05T10:30:00.000Z";
  const compiler = new FakeCompiler();
  const revalidator = new FakeConfirmationRevalidator();
  let store = await IntakeStore.open(paths.database, {
    deviceIdentityPath: paths.identity,
    now: () => now,
    challengeTtlMs: 1_000,
  });
  try {
    const compiled = await new IntakeService(store, compiler, revalidator).compile(
      fixture("chatgpt-supported.json"),
      slice3aExtensionOrigin,
    );
    const expected = readyCardIdentityFor(compiled, revalidator.current);
    const before = store.counts();
    store.close();
    now = "2026-08-05T10:30:02.000Z";
    store = IntakeStore.openReadOnly(paths.database, {
      deviceIdentityPath: paths.identity,
      now: () => now,
    });

    for (const field of [
      "card_digest",
      "compiler_candidate_digest",
      "request_digest",
      "capture_digest",
      "selected_turn_digest",
      "owner_turn_digest",
    ] as const) {
      assert.throws(
        () => new IntakeService(
          store,
          compiler,
          revalidator,
          revalidator,
          { ...expected, [field]: hashCanonical({ drift: field }) },
        ).restoreReadyCard(slice3aExtensionOrigin),
        /BLOCKED_READY_CARD_RESTORE:FROZEN_IDENTITY_DRIFT/u,
      );
    }

    for (const [field, expectedBlocker] of [
      ["local_objective_digest", "FROZEN_IDENTITY_DRIFT"],
      ["target_objective_digest", "FROZEN_IDENTITY_DRIFT"],
      ["target_resolution_digest", "FROZEN_IDENTITY_DRIFT"],
      ["target_harness_digest", "FROZEN_IDENTITY_DRIFT"],
      ["compiler_profile_digest", "FROZEN_IDENTITY_DRIFT"],
      ["compiler_capability_digest", "FROZEN_IDENTITY_DRIFT"],
    ] as const) {
      revalidator.current = fakeConfirmationRevalidation({ [field]: hashCanonical({ drift: field }) });
      assert.throws(
        () => new IntakeService(store, compiler, revalidator, revalidator, expected)
          .restoreReadyCard(slice3aExtensionOrigin),
        new RegExp(`BLOCKED_READY_CARD_RESTORE:${expectedBlocker}`, "u"),
      );
    }
    revalidator.current = fakeConfirmationRevalidation();
    assert.throws(
      () => new IntakeService(store, compiler, revalidator, revalidator, expected)
        .restoreReadyCard("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"),
      /BLOCKED_NATIVE_ORIGIN/u,
    );
    assert.deepEqual(store.counts(), before);
    assert.equal(compiler.calls, 1);
    store.close();

    rmSync(paths.identity);
    store = IntakeStore.openReadOnly(paths.database, {
      deviceIdentityPath: paths.identity,
      now: () => now,
    });
    assert.throws(
      () => new IntakeService(store, compiler, revalidator, revalidator, expected)
        .restoreReadyCard(slice3aExtensionOrigin),
      /BLOCKED_OWNER_IDENTITY:MISSING_STATE/u,
    );
    assert.equal(existsSync(paths.identity), false);
    assert.deepEqual(store.counts(), before);
  } finally {
    try {
      store.close();
    } catch {
      // The store is deliberately reopened across the missing-device boundary.
    }
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("JIT revalidation accepts only the exact Slice 4 Objective tuple", async () => {
  const acceptedPaths = testPaths("jit-slice4-tuple-accepted");
  const acceptedRevalidator = new FakeConfirmationRevalidator();
  acceptedRevalidator.current = fakeSlice4ConfirmationRevalidation();
  const acceptedStore = await IntakeStore.open(acceptedPaths.database, {
    deviceIdentityPath: acceptedPaths.identity,
  });
  try {
    const service = new IntakeService(acceptedStore, new FakeCompiler(), acceptedRevalidator);
    const compiled = await service.compile(fixture("chatgpt-supported.json"), slice3aExtensionOrigin);
    const prepared = service.prepareConfirm(
      slice3aExtensionOrigin,
      compiled.challenge,
      compiled.challenge_token,
    );
    assert.equal(prepared.status, "READY_TO_CONFIRM");
    const approved = service.confirm(
      slice3aExtensionOrigin,
      compiled.challenge,
      compiled.challenge_token,
      undefined,
      { binding: prepared.jit_binding, token: prepared.jit_token },
    );
    assert.equal(approved.disposition, "CREATED");
    assert.deepEqual(acceptedStore.counts(), {
      challenges: 1,
      requests: 1,
      receipts: 1,
      activations: 1,
      events: 1,
    });
  } finally {
    acceptedStore.close();
    rmSync(acceptedPaths.root, { recursive: true, force: true });
  }

  const rejectedPaths = testPaths("jit-slice4-tuple-mixed");
  const rejectedRevalidator = new FakeConfirmationRevalidator();
  rejectedRevalidator.current = fakeSlice4ConfirmationRevalidation({
    target_objective_ref: "fixture.invalid/ados-fixture-delivery#3",
    target_base_sha: "e75d162750acf4775a7a1ba1d1955ca9d60bc73f",
  });
  const rejectedStore = await IntakeStore.open(rejectedPaths.database, {
    deviceIdentityPath: rejectedPaths.identity,
  });
  try {
    const service = new IntakeService(rejectedStore, new FakeCompiler(), rejectedRevalidator);
    const compiled = await service.compile(fixture("chatgpt-supported.json"), slice3aExtensionOrigin);
    const beforePrepare = rejectedStore.counts();
    assert.throws(
      () => service.prepareConfirm(
        slice3aExtensionOrigin,
        compiled.challenge,
        compiled.challenge_token,
      ),
      /BLOCKED_RECEIPT:JIT_REVALIDATION_INVALID/u,
    );
    assert.deepEqual(rejectedStore.counts(), beforePrepare);
  } finally {
    rejectedStore.close();
    rmSync(rejectedPaths.root, { recursive: true, force: true });
  }
});

test("expired durable Challenge succeeds once only through fresh stateless JIT revalidation", async () => {
  const paths = testPaths("jit-expired-original");
  let now = "2026-08-05T09:00:00.000Z";
  const compiler = new FakeCompiler();
  const revalidator = new FakeConfirmationRevalidator();
  const store = await IntakeStore.open(paths.database, {
    deviceIdentityPath: paths.identity,
    now: () => now,
    challengeTtlMs: 1_000,
    jitConfirmationTtlMs: 30_000,
  });
  try {
    const service = new IntakeService(store, compiler, revalidator);
    const compiled = await service.compile(fixture("chatgpt-supported.json"), slice3aExtensionOrigin);
    assert.equal(compiler.calls, 1);
    now = "2026-08-05T09:00:02.000Z";
    assert.throws(
      () => service.confirm(slice3aExtensionOrigin, compiled.challenge, compiled.challenge_token),
      /BLOCKED_RECEIPT:CHALLENGE_EXPIRED/u,
    );
    const beforePrepare = store.counts();
    const prepared = service.prepareConfirm(
      slice3aExtensionOrigin,
      compiled.challenge,
      compiled.challenge_token,
    );
    assert.equal(prepared.status, "READY_TO_CONFIRM");
    assert.equal(prepared.jit_binding.original_challenge_id, compiled.challenge.challenge_id);
    assert.equal(prepared.jit_binding.card_digest, compiled.challenge.card_digest);
    assert.equal(prepared.jit_binding.capture_digest, compiled.challenge.capture_digest);
    assert.equal(
      prepared.jit_binding.compiler_candidate_digest,
      compiled.challenge.compiler_candidate_digest,
    );
    assert.equal(prepared.jit_binding.request_digest, compiled.challenge.request_digest);
    assert.equal(
      prepared.jit_binding.revalidation.compiler_profile_digest,
      frozenProfile().profile_digest,
    );
    assert.equal(
      prepared.jit_binding.revalidation.compiler_capability_digest,
      frozenProfile().capability_digest,
    );
    assert.deepEqual(store.counts(), beforePrepare);
    assert.equal(compiler.calls, 1);

    const drifted = structuredClone(prepared.jit_binding);
    (drifted as { request_digest: string }).request_digest = hashCanonical({ drift: "request" });
    assert.throws(
      () => service.confirm(
        slice3aExtensionOrigin,
        compiled.challenge,
        compiled.challenge_token,
        undefined,
        { binding: drifted, token: prepared.jit_token },
      ),
      /BLOCKED_RECEIPT:JIT_AUTHENTICATION/u,
    );
    assert.deepEqual(store.counts(), beforePrepare);

    revalidator.current = fakeConfirmationRevalidation({
      target_resolution_digest: hashCanonical({ drift: "target" }),
    });
    assert.throws(
      () => service.confirm(
        slice3aExtensionOrigin,
        compiled.challenge,
        compiled.challenge_token,
        undefined,
        { binding: prepared.jit_binding, token: prepared.jit_token },
      ),
      /BLOCKED_RECEIPT:JIT_BINDING_MISMATCH/u,
    );
    assert.deepEqual(store.counts(), beforePrepare);

    revalidator.current = prepared.jit_binding.revalidation;
    const approved = service.confirm(
      slice3aExtensionOrigin,
      compiled.challenge,
      compiled.challenge_token,
      undefined,
      { binding: prepared.jit_binding, token: prepared.jit_token },
    );
    assert.equal(approved.disposition, "CREATED");
    assert.deepEqual(store.counts(), {
      challenges: 1,
      requests: 1,
      receipts: 1,
      activations: 1,
      events: 1,
    });
    assert.equal(compiler.calls, 1);

    const duplicate = service.confirm(
      slice3aExtensionOrigin,
      compiled.challenge,
      compiled.challenge_token,
      undefined,
      { binding: prepared.jit_binding, token: prepared.jit_token },
    );
    assert.equal(duplicate.disposition, "DUPLICATE_RECONCILED");
    assert.equal(duplicate.receipt.receipt_id, approved.receipt.receipt_id);
    assert.equal(duplicate.activation.activation_id, approved.activation.activation_id);
    assert.equal(compiler.calls, 1);
  } finally {
    store.close();
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("JIT expiry, original binding mismatches, and prepare-only loss fail closed with zero durable intake", async () => {
  const paths = testPaths("jit-fail-closed");
  let now = "2026-08-05T09:10:00.000Z";
  const compiler = new FakeCompiler();
  const revalidator = new FakeConfirmationRevalidator();
  let store = await IntakeStore.open(paths.database, {
    deviceIdentityPath: paths.identity,
    now: () => now,
    challengeTtlMs: 1_000,
    jitConfirmationTtlMs: 30_000,
  });
  try {
    let service = new IntakeService(store, compiler, revalidator);
    const compiled = await service.compile(fixture("chatgpt-supported.json"), slice3aExtensionOrigin);
    now = "2026-08-05T09:10:02.000Z";
    const firstPrepared = service.prepareConfirm(
      slice3aExtensionOrigin,
      compiled.challenge,
      compiled.challenge_token,
    );
    assert.deepEqual(store.counts(), {
      challenges: 1,
      requests: 0,
      receipts: 0,
      activations: 0,
      events: 0,
    });

    const challengeFields = [
      "card_digest",
      "capture_digest",
      "compiler_candidate_digest",
      "request_digest",
      "actor_id",
    ] as const;
    for (const field of challengeFields) {
      const mutated = structuredClone(compiled.challenge) as unknown as Record<string, unknown>;
      mutated[field] = field === "actor_id" ? "actor-local-drift" : hashCanonical({ field });
      assert.throws(
        () => service.confirm(
          slice3aExtensionOrigin,
          mutated as unknown as typeof compiled.challenge,
          compiled.challenge_token,
          undefined,
          { binding: firstPrepared.jit_binding, token: firstPrepared.jit_token },
        ),
        /BLOCKED_RECEIPT:CHALLENGE_AUTHENTICATION/u,
      );
    }
    assert.throws(
      () => service.prepareConfirm(
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
        compiled.challenge,
        compiled.challenge_token,
      ),
      /BLOCKED_NATIVE_ORIGIN/u,
    );
    assert.deepEqual(store.counts(), {
      challenges: 1,
      requests: 0,
      receipts: 0,
      activations: 0,
      events: 0,
    });

    store.close();
    store = await IntakeStore.open(paths.database, {
      deviceIdentityPath: paths.identity,
      now: () => now,
      challengeTtlMs: 1_000,
      jitConfirmationTtlMs: 30_000,
    });
    service = new IntakeService(store, compiler, revalidator);
    const secondPrepared = service.prepareConfirm(
      slice3aExtensionOrigin,
      compiled.challenge,
      compiled.challenge_token,
    );
    assert.notEqual(secondPrepared.jit_binding.nonce_digest, firstPrepared.jit_binding.nonce_digest);
    assert.equal(secondPrepared.jit_binding.card_digest, firstPrepared.jit_binding.card_digest);
    assert.deepEqual(store.counts(), {
      challenges: 1,
      requests: 0,
      receipts: 0,
      activations: 0,
      events: 0,
    });

    now = "2026-08-05T09:10:33.000Z";
    assert.throws(
      () => service.confirm(
        slice3aExtensionOrigin,
        compiled.challenge,
        compiled.challenge_token,
        undefined,
        { binding: secondPrepared.jit_binding, token: secondPrepared.jit_token },
      ),
      /BLOCKED_RECEIPT:JIT_EXPIRED/u,
    );
    assert.deepEqual(store.counts(), {
      challenges: 1,
      requests: 0,
      receipts: 0,
      activations: 0,
      events: 0,
    });
    assert.equal(compiler.calls, 1);
  } finally {
    store.close();
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("two concurrent JIT confirms reconcile the same Receipt and Activation identity", async () => {
  const paths = testPaths("jit-concurrent");
  let now = "2026-08-05T09:20:00.000Z";
  const compiler = new FakeCompiler();
  const revalidator = new FakeConfirmationRevalidator();
  const store = await IntakeStore.open(paths.database, {
    deviceIdentityPath: paths.identity,
    now: () => now,
    challengeTtlMs: 1_000,
    jitConfirmationTtlMs: 30_000,
  });
  try {
    const service = new IntakeService(store, compiler, revalidator);
    const compiled = await service.compile(fixture("chatgpt-supported.json"), slice3aExtensionOrigin);
    now = "2026-08-05T09:20:02.000Z";
    const prepared = service.prepareConfirm(
      slice3aExtensionOrigin,
      compiled.challenge,
      compiled.challenge_token,
    );
    const input = {
      extension_origin: slice3aExtensionOrigin,
      challenge: compiled.challenge,
      challenge_token: compiled.challenge_token,
      jit_confirmation: {
        binding: prepared.jit_binding,
        token: prepared.jit_token,
        current_revalidation: prepared.jit_binding.revalidation,
      },
    };
    store.close();
    const outcomes = await Promise.all([
      runJitConfirmWorker(paths.database, paths.identity, now, input),
      runJitConfirmWorker(paths.database, paths.identity, now, input),
    ]);
    assert.deepEqual(
      outcomes.map((outcome) => outcome.disposition).sort(),
      ["CREATED", "DUPLICATE_RECONCILED"],
    );
    const receipts = new Set(outcomes.map((outcome) =>
      (outcome.receipt as Record<string, unknown>).receipt_id));
    const activations = new Set(outcomes.map((outcome) =>
      (outcome.activation as Record<string, unknown>).activation_id));
    assert.equal(receipts.size, 1);
    assert.equal(activations.size, 1);
    const reopened = await IntakeStore.open(paths.database, {
      deviceIdentityPath: paths.identity,
      now: () => now,
    });
    assert.deepEqual(reopened.counts(), {
      challenges: 1,
      requests: 1,
      receipts: 1,
      activations: 1,
      events: 1,
    });
    reopened.verifyEventChain();
    reopened.verifyProjectionConsistency();
    reopened.close();
    assert.equal(compiler.calls, 1);
  } finally {
    try {
      store.close();
    } catch {
      // The main connection is intentionally closed before concurrent worker start.
    }
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("prepare-confirm never recreates missing device identity durable state", async () => {
  const paths = testPaths("jit-missing-identity");
  let store = await IntakeStore.open(paths.database, {
    deviceIdentityPath: paths.identity,
    now: () => "2026-08-05T09:30:00.000Z",
  });
  try {
    const compiled = await new IntakeService(
      store,
      new FakeCompiler(),
      new FakeConfirmationRevalidator(),
    ).compile(fixture("chatgpt-supported.json"), slice3aExtensionOrigin);
    store.close();
    rmSync(paths.identity);
    assert.equal(existsSync(paths.identity), false);
    store = await IntakeStore.open(paths.database, {
      deviceIdentityPath: paths.identity,
      now: () => "2026-08-05T09:31:00.000Z",
    });
    const service = new IntakeService(store, new FakeCompiler(), new FakeConfirmationRevalidator());
    assert.throws(
      () => service.prepareConfirm(
        slice3aExtensionOrigin,
        compiled.challenge,
        compiled.challenge_token,
      ),
      /BLOCKED_OWNER_IDENTITY:MISSING_STATE/u,
    );
    assert.equal(existsSync(paths.identity), false);
    assert.deepEqual(store.counts(), {
      challenges: 1,
      requests: 0,
      receipts: 0,
      activations: 0,
      events: 0,
    });
  } finally {
    try {
      store.close();
    } catch {
      // The store is deliberately reopened across the missing-identity boundary.
    }
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("after-commit interruption restores the same durable Receipt and Activation", async () => {
  const paths = testPaths("after-commit");
  const store = await IntakeStore.open(paths.database, {
    deviceIdentityPath: paths.identity,
    now: () => "2026-08-04T05:50:00.000Z",
  });
  try {
    const service = new IntakeService(store, new FakeCompiler());
    const compiled = await service.compile(fixture("chatgpt-supported.json"), slice3aExtensionOrigin);
    assert.throws(
      () => service.confirm(slice3aExtensionOrigin, compiled.challenge, compiled.challenge_token, "after_commit"),
      /TEST_FAULT:AFTER_COMMIT/,
    );
    const restored = service.status(compiled.challenge.request_digest);
    assert.notEqual(restored, null);
    assert.equal(restored!.activation.status, "APPROVED_NOT_DISPATCHED");
    const reconciled = service.confirm(slice3aExtensionOrigin, compiled.challenge, compiled.challenge_token);
    assert.equal(reconciled.disposition, "DUPLICATE_RECONCILED");
    assert.equal(reconciled.receipt.receipt_id, restored!.receipt.receipt_id);
    assert.equal(reconciled.activation.activation_id, restored!.activation.activation_id);
  } finally {
    store.close();
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("two concurrent one-shot Native Hosts reconcile one Receipt and Activation", { skip: process.platform !== "win32" ? "Requires the Windows Native Host / npm.cmd profile" : false }, async () => {
  const paths = testPaths("concurrent-hosts");
  const runtimeRoot = paths.root;
  const nativeDatabase = join(runtimeRoot, ".ados-local", "slice3a", "state.sqlite");
  const nativeIdentity = join(runtimeRoot, ".ados-local", "slice3a", "device-identity.json");
  try {
    mkdirSync(runtimeRoot, { recursive: true });
    cpSync(join(process.cwd(), "migrations"), join(runtimeRoot, "migrations"), { recursive: true });
    cpSync(join(process.cwd(), "vendor"), join(runtimeRoot, "vendor"), { recursive: true });
    cpSync(join(process.cwd(), "dist", "src"), join(runtimeRoot, "dist", "src"), { recursive: true });
    const store = await IntakeStore.open(nativeDatabase, {
      deviceIdentityPath: nativeIdentity,
    });
    const service = new IntakeService(store, new FakeCompiler());
    const compiled = await service.compile(fixture("chatgpt-supported.json"), slice3aExtensionOrigin);
    store.close();
    const request = {
      schema_version: "slice3a-native-message/v0.1",
      kind: "confirm",
      challenge: compiled.challenge,
      challenge_token: compiled.challenge_token,
    };
    const responses = await Promise.all([
      runNativeHost(runtimeRoot, request),
      runNativeHost(runtimeRoot, request),
    ]);
    assert.ok(
      responses.every((response) => response.ok === true),
      JSON.stringify(responses),
    );
    const dispositions = responses.map((response) => {
      const result = response.result as Record<string, unknown>;
      return result.disposition;
    }).sort();
    assert.deepEqual(dispositions, ["CREATED", "DUPLICATE_RECONCILED"]);
    const reopened = await IntakeStore.open(nativeDatabase, { deviceIdentityPath: nativeIdentity });
    assert.deepEqual(reopened.counts(), { challenges: 1, requests: 1, receipts: 1, activations: 1, events: 1 });
    reopened.verifyEventChain();
    reopened.verifyProjectionConsistency();
    reopened.close();
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("native framing rejects malformed or additional-property requests", async () => {
  const message = {
    schema_version: "slice3a-native-message/v0.1",
    kind: "status",
    request_digest: null,
  };
  const frame = encodeNativeMessage(message);
  assert.deepEqual(await readNativeMessage(Readable.from([frame])), message);
  assert.deepEqual(parseNativeRequest(message), message);
  assert.throws(
    () => parseNativeRequest({ ...message, execute: true }),
    /BLOCKED_NATIVE_PROTOCOL:ADDITIONAL_PROPERTIES/,
  );
  const restore = {
    schema_version: "slice3a-native-message/v0.1",
    kind: "restore-ready-card",
  };
  assert.deepEqual(parseNativeRequest(restore), restore);
  assert.throws(
    () => parseNativeRequest({ ...restore, challenge_id: "challenge-injected" }),
    /BLOCKED_NATIVE_PROTOCOL:ADDITIONAL_PROPERTIES/u,
  );
  const prepare = {
    schema_version: "slice3a-native-message/v0.1",
    kind: "prepare-confirm",
    challenge: { challenge_id: "challenge-test" },
    challenge_token: "a".repeat(64),
  };
  assert.deepEqual(parseNativeRequest(prepare), prepare);
  const jitConfirm = {
    schema_version: "slice3a-native-message/v0.1",
    kind: "confirm",
    challenge: { challenge_id: "challenge-test" },
    challenge_token: "a".repeat(64),
    jit_binding: { schema_version: "slice3b-jit-confirmation-binding/v0.1" },
    jit_token: "b".repeat(64),
  };
  assert.deepEqual(parseNativeRequest(jitConfirm), jitConfirm);
  assert.throws(
    () => parseNativeRequest({ ...jitConfirm, jit_token: undefined }),
    /BLOCKED_NATIVE_PROTOCOL:JIT_CONFIRMATION/u,
  );
  const missingJitToken = structuredClone(jitConfirm) as Record<string, unknown>;
  delete missingJitToken.jit_token;
  assert.throws(
    () => parseNativeRequest(missingJitToken),
    /BLOCKED_NATIVE_PROTOCOL:ADDITIONAL_PROPERTIES/u,
  );
  await assert.rejects(
    () => readNativeMessage(Readable.from([Buffer.from([1, 0, 0, 0])])),
    /BLOCKED_NATIVE_PROTOCOL:PAYLOAD_EOF/,
  );
});

test("native blocker sanitization preserves safe multi-segment compiler identity", () => {
  assert.equal(
    sanitizeNativeHostError(new Error("BLOCKED_COMPILER_PATH:SERVER_REQUEST:before-close:count=1")),
    "BLOCKED_COMPILER_PATH:SERVER_REQUEST",
  );
  assert.equal(
    sanitizeNativeHostError(new Error("BLOCKED_COMPILER_PATH:TURN_STATUS:FAILED")),
    "BLOCKED_COMPILER_PATH:TURN_STATUS:FAILED",
  );
  assert.equal(
    sanitizeNativeHostError(new Error("APP_SERVER_NOTIFICATION_TIMEOUT:turn/completed")),
    "BLOCKED_COMPILER_PATH:APP_SERVER_NOTIFICATION_TIMEOUT:TURN_COMPLETED",
  );
  assert.equal(
    sanitizeNativeHostError(new Error("GATE0A_LOCAL_VALIDATION_REJECTED:OWNER_DECISION_SOURCE_QUOTE_MISMATCH")),
    "BLOCKED_COMPILER_PATH:GATE0A_LOCAL_VALIDATION_REJECTED:OWNER_DECISION_SOURCE_QUOTE_MISMATCH",
  );
  assert.equal(sanitizeNativeHostError(new Error("unsafe path C:\\secret")), "BLOCKED_NATIVE_HOST:UNKNOWN");
});

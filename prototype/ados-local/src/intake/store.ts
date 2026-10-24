import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson, hashCanonical, sha256Text } from "../canonical/index.js";
import { ContractValidator, computeDeliveryRequestDigest } from "../contracts/validator.js";
import { BetterSqlite3Driver } from "../storage/better-sqlite3-driver.js";
import type { StorageDriver } from "../storage/driver.js";
import { applyAndVerifyMigrations, type MigrationIdentity } from "../storage/migrations.js";
import type { JsonObject, JsonValue } from "../types.js";
import { finalizeDeliveryRequest } from "./request.js";
import {
  readDeviceIdentity,
  readOrCreateDeviceIdentity,
  signChallenge,
  signJitConfirmation,
  verifyChallengeToken,
  verifyJitConfirmationToken,
} from "./device-identity.js";
import type {
  ApprovedIntake,
  ChallengeBinding,
  ChallengeResponse,
  ConfirmationRevalidation,
  DeliveryCard,
  DeliveryRequestDraft,
  DurableReadyCardIdentity,
  JitConfirmationBinding,
  JitConfirmationResponse,
  OwnerAuthorizationReceipt,
  ReadyCardRehydrationResponse,
} from "./types.js";

export const slice3aExtensionId = "fpmliiakgebgdlgaddocgddllidmkomd";
export const slice3aExtensionOrigin = `chrome-extension://${slice3aExtensionId}/`;
export const slice3aNativeHostName = "org.ados.public_fixture.slice3a";

interface ChallengeRow extends Record<string, unknown> {
  readonly challenge_id: string;
  readonly nonce_digest: string;
  readonly extension_origin: string;
  readonly actor_id: string;
  readonly card_digest: string;
  readonly selected_turn_digest: string;
  readonly request_id: string;
  readonly request_digest: string;
  readonly owner_turn_digest: string;
  readonly requested_authorization: OwnerAuthorizationReceipt["authorization"];
  readonly capture_profile_id: string;
  readonly capture_profile_version: string;
  readonly compiler_profile_id: string;
  readonly compiler_profile_version: string;
  readonly compiler_candidate_digest: string;
  readonly capture_digest: string;
  readonly request_json: string;
  readonly card_json: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly receipt_id: string | null;
}

interface EventRow extends Record<string, unknown> {
  readonly seq: number;
  readonly event_id: string;
  readonly activation_id: string;
  readonly event_type: "INTAKE_APPROVED";
  readonly occurred_at: string;
  readonly previous_digest: string | null;
  readonly event_digest: string;
  readonly payload_json: string;
}

export interface IntakeStoreOptions {
  readonly migrationsDirectory?: string;
  readonly now?: () => string;
  readonly challengeTtlMs?: number;
  readonly jitConfirmationTtlMs?: number;
  readonly deviceIdentityPath?: string;
}

export interface IssueChallengeInput {
  readonly extension_origin: string;
  readonly draft: DeliveryRequestDraft;
  readonly card: DeliveryCard;
  readonly owner_turn_digest: string;
  readonly requested_authorization: OwnerAuthorizationReceipt["authorization"];
  readonly capture_profile_id: string;
  readonly capture_profile_version: string;
  readonly compiler_profile_id: string;
  readonly compiler_profile_version: string;
  readonly compiler_candidate_digest: string;
  readonly capture_digest: string;
}

export interface ConfirmInput {
  readonly extension_origin: string;
  readonly challenge: ChallengeBinding;
  readonly challenge_token: string;
  readonly jit_confirmation?: {
    readonly binding: JitConfirmationBinding;
    readonly token: string;
    readonly current_revalidation: ConfirmationRevalidation;
  };
  readonly fault?: "before_commit" | "after_commit";
}

export interface PrepareConfirmationInput {
  readonly extension_origin: string;
  readonly challenge: ChallengeBinding;
  readonly challenge_token: string;
  readonly revalidation: ConfirmationRevalidation;
}

export interface ConfirmationSnapshot {
  readonly request: JsonObject;
  readonly card: DeliveryCard;
}

export interface RestoreReadyCardInput {
  readonly extension_origin: string;
  readonly revalidation: ConfirmationRevalidation;
  readonly identity: DurableReadyCardIdentity;
}

function safeInteger(value: number | bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error("SQLITE_INTEGER_OUT_OF_RANGE");
  }
  return result;
}

function deterministicId(prefix: string, value: JsonValue): string {
  return `${prefix}-${hashCanonical(value).slice(7, 39)}`;
}

function bindingFromRow(row: ChallengeRow): ChallengeBinding {
  return {
    challenge_id: row.challenge_id,
    nonce_digest: row.nonce_digest,
    extension_origin: row.extension_origin,
    actor_id: row.actor_id,
    card_digest: row.card_digest,
    capture_digest: row.capture_digest,
    selected_turn_digest: row.selected_turn_digest,
    compiler_candidate_digest: row.compiler_candidate_digest,
    request_id: row.request_id,
    request_digest: row.request_digest,
    owner_turn_digest: row.owner_turn_digest,
    requested_authorization: row.requested_authorization,
    capture_profile_id: row.capture_profile_id,
    capture_profile_version: row.capture_profile_version,
    compiler_profile_id: row.compiler_profile_id,
    compiler_profile_version: row.compiler_profile_version,
    issued_at: row.issued_at,
    expires_at: row.expires_at,
  };
}

function shortDigest(value: string): string {
  return value.startsWith("sha256:") ? value.slice(7, 19) : value.slice(0, 12);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function hasTrustedObjectiveTuple(value: ConfirmationRevalidation): boolean {
  return (
    value.local_objective_ref === "fixture.invalid/ados-local#9" &&
    value.target_objective_ref === "fixture.invalid/ados-fixture-delivery#3" &&
    value.target_base_sha === "e75d162750acf4775a7a1ba1d1955ca9d60bc73f"
  ) || (
    value.local_objective_ref === "fixture.invalid/ados-local#11" &&
    value.target_objective_ref === "fixture.invalid/ados-fixture-delivery#5" &&
    value.target_base_sha === "4e772e775cbc843420c8580fcff8a85c92754bdd"
  );
}

function assertRevalidation(value: ConfirmationRevalidation): void {
  if (
    value.schema_version !== "slice3b-confirmation-revalidation/v0.1" ||
    !hasTrustedObjectiveTuple(value) ||
    !isDigest(value.local_objective_digest) ||
    !isDigest(value.target_objective_digest) ||
    !isDigest(value.target_resolution_digest) ||
    !isDigest(value.target_harness_digest) ||
    !isDigest(value.compiler_profile_digest) ||
    !isDigest(value.compiler_capability_digest)
  ) {
    throw new Error("BLOCKED_RECEIPT:JIT_REVALIDATION_INVALID");
  }
}

export class IntakeStore {
  readonly #driver: StorageDriver;
  readonly #now: () => string;
  readonly #challengeTtlMs: number;
  readonly #jitConfirmationTtlMs: number;
  readonly #deviceIdentityPath: string | undefined;
  public readonly migrations: readonly MigrationIdentity[];
  public readonly backupPath: string | null;

  private constructor(
    driver: StorageDriver,
    migrations: readonly MigrationIdentity[],
    backupPath: string | null,
    options: IntakeStoreOptions,
  ) {
    this.#driver = driver;
    this.migrations = migrations;
    this.backupPath = backupPath;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#challengeTtlMs = options.challengeTtlMs ?? 5 * 60_000;
    this.#jitConfirmationTtlMs = options.jitConfirmationTtlMs ?? 30_000;
    this.#deviceIdentityPath = options.deviceIdentityPath;
  }

  public static async open(databasePath: string, options: IntakeStoreOptions = {}): Promise<IntakeStore> {
    mkdirSync(dirname(databasePath), { recursive: true });
    const existed = existsSync(databasePath);
    const driver = new BetterSqlite3Driver(databasePath);
    try {
      driver.pragma("journal_mode = WAL");
      driver.pragma("synchronous = FULL");
      driver.pragma("foreign_keys = ON");
      driver.pragma("busy_timeout = 5000");
      driver.pragma("trusted_schema = OFF");
      let backupPath: string | null = null;
      const hasMigrationTable = driver.get<{ readonly count: number }>(
        "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
      )?.count === 1;
      if (existed && hasMigrationTable) {
        const rows = driver.all<{ readonly version: number; readonly name: string; readonly checksum: string }>(
          "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
        );
        if (rows.length === 3 && rows[2]?.version === 3) {
          const backupDirectory = join(dirname(databasePath), "backups");
          mkdirSync(backupDirectory, { recursive: true });
          backupPath = join(backupDirectory, `pre-0004-${hashCanonical(rows as unknown as JsonValue).slice(7, 23)}.sqlite`);
          if (!existsSync(backupPath)) {
            await driver.backup(backupPath);
          }
          const backup = new BetterSqlite3Driver(backupPath, { readonly: true, fileMustExist: true });
          try {
            if (String(backup.pragma("integrity_check", true)) !== "ok") {
              throw new Error("BLOCKED_INTAKE_BACKUP:INTEGRITY");
            }
            const backupRows = backup.all<{ readonly version: number; readonly name: string; readonly checksum: string }>(
              "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
            );
            if (canonicalJson(backupRows as unknown as JsonValue) !== canonicalJson(rows as unknown as JsonValue)) {
              throw new Error("BLOCKED_INTAKE_BACKUP:MIGRATION_IDENTITY");
            }
          } finally {
            backup.close();
          }
        }
      }
      const migrations = applyAndVerifyMigrations(
        driver,
        options.migrationsDirectory ?? join(process.cwd(), "migrations"),
        options.now ?? (() => new Date().toISOString()),
      );
      const store = new IntakeStore(driver, migrations, backupPath, options);
      store.verifySchema();
      store.verifyIntegrity();
      return store;
    } catch (error) {
      driver.close();
      throw error;
    }
  }

  public close(): void {
    this.#driver.close();
  }

  #identity() {
    return readOrCreateDeviceIdentity(this.#deviceIdentityPath);
  }

  public static openReadOnly(databasePath: string, options: IntakeStoreOptions = {}): IntakeStore {
    const driver = new BetterSqlite3Driver(databasePath, { readonly: true, fileMustExist: true });
    try {
      driver.pragma("query_only = ON");
      driver.pragma("foreign_keys = ON");
      driver.pragma("busy_timeout = 5000");
      driver.pragma("trusted_schema = OFF");
      const migrations = applyAndVerifyMigrations(
        driver,
        options.migrationsDirectory ?? join(process.cwd(), "migrations"),
        options.now ?? (() => new Date().toISOString()),
      );
      const store = new IntakeStore(driver, migrations, null, options);
      store.verifySchema();
      store.verifyIntegrity();
      return store;
    } catch (error) {
      driver.close();
      throw error;
    }
  }

  #existingIdentity() {
    return readDeviceIdentity(this.#deviceIdentityPath);
  }

  #transaction<T>(operation: () => T): T {
    this.#driver.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#driver.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#driver.exec("ROLLBACK");
      } catch {
        // Preserve the protected mutation's primary failure.
      }
      throw error;
    }
  }

  public issueChallenge(input: IssueChallengeInput): ChallengeResponse {
    if (input.extension_origin !== slice3aExtensionOrigin) {
      throw new Error("BLOCKED_NATIVE_ORIGIN");
    }
    if (
      input.draft.request_digest !== input.draft.request.request_digest ||
      input.owner_turn_digest !== (input.draft.request.capture as JsonObject).owner_turn_digest ||
      input.requested_authorization !== input.draft.request.requested_authorization
    ) {
      throw new Error("BLOCKED_CHALLENGE:BINDING_MISMATCH");
    }
    const identity = this.#identity();
    return this.#transaction(() => {
      this.verifyEventChain();
      this.verifyProjectionConsistency();
      const existing = this.#driver.get<ChallengeRow>(
        "SELECT * FROM intake_challenges WHERE request_id = ?",
        [input.draft.request_id],
      );
      if (existing !== undefined) {
        if (
          existing.request_digest !== input.draft.request_digest ||
          existing.owner_turn_digest !== input.owner_turn_digest ||
          existing.extension_origin !== input.extension_origin ||
          existing.card_digest !== hashCanonical(input.card as unknown as JsonValue) ||
          existing.selected_turn_digest !== (input.draft.request.capture as JsonObject).selected_turn_digest ||
          existing.compiler_candidate_digest !== input.compiler_candidate_digest ||
          existing.capture_digest !== input.capture_digest
        ) {
          throw new Error("BLOCKED_RECEIPT_RECONCILIATION:CHALLENGE_CONFLICT");
        }
        return signChallenge(bindingFromRow(existing), identity);
      }
      const issuedAt = this.#now();
      const expiresAt = new Date(Date.parse(issuedAt) + this.#challengeTtlMs).toISOString();
      const nonceDigest = sha256Text(randomBytes(32));
      const challengeId = deterministicId("challenge", {
        nonce_digest: nonceDigest,
        request_digest: input.draft.request_digest,
        actor_id: identity.actor_id,
      });
      const binding: ChallengeBinding = {
        challenge_id: challengeId,
        nonce_digest: nonceDigest,
        extension_origin: input.extension_origin,
        actor_id: identity.actor_id,
        card_digest: hashCanonical(input.card as unknown as JsonValue),
        capture_digest: input.capture_digest,
        selected_turn_digest: String((input.draft.request.capture as JsonObject).selected_turn_digest),
        compiler_candidate_digest: input.compiler_candidate_digest,
        request_id: input.draft.request_id,
        request_digest: input.draft.request_digest,
        owner_turn_digest: input.owner_turn_digest,
        requested_authorization: input.requested_authorization,
        capture_profile_id: input.capture_profile_id,
        capture_profile_version: input.capture_profile_version,
        compiler_profile_id: input.compiler_profile_id,
        compiler_profile_version: input.compiler_profile_version,
        issued_at: issuedAt,
        expires_at: expiresAt,
      };
      this.#driver.run(
        `INSERT INTO intake_challenges(
          challenge_id, nonce_digest, extension_origin, actor_id, card_digest,
          selected_turn_digest,
          request_id, request_digest, owner_turn_digest, requested_authorization,
          capture_profile_id, capture_profile_version, compiler_profile_id,
          compiler_profile_version, compiler_candidate_digest, capture_digest,
          request_json, card_json, issued_at, expires_at, consumed_at, receipt_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        [
          binding.challenge_id,
          binding.nonce_digest,
          binding.extension_origin,
          binding.actor_id,
          binding.card_digest,
          binding.selected_turn_digest,
          binding.request_id,
          binding.request_digest,
          binding.owner_turn_digest,
          binding.requested_authorization,
          binding.capture_profile_id,
          binding.capture_profile_version,
          binding.compiler_profile_id,
          binding.compiler_profile_version,
          input.compiler_candidate_digest,
          input.capture_digest,
          canonicalJson(input.draft.request),
          canonicalJson(input.card as unknown as JsonObject),
          binding.issued_at,
          binding.expires_at,
        ],
      );
      return signChallenge(binding, identity);
    });
  }

  #durableSnapshot(row: ChallengeRow): ConfirmationSnapshot {
    let request: JsonObject;
    let card: DeliveryCard;
    try {
      request = JSON.parse(row.request_json) as JsonObject;
      card = JSON.parse(row.card_json) as DeliveryCard;
    } catch {
      throw new Error("BLOCKED_RECEIPT:JIT_DURABLE_PAYLOAD_INVALID");
    }
    const capture = request.capture as JsonObject | undefined;
    const compiler = request.compiler as JsonObject | undefined;
    const requestDecisions = request.owner_decisions;
    const cardDecisions = card.owner_decisions;
    const cardDecisionTexts = Array.isArray(cardDecisions)
      ? cardDecisions.map((decision) => decision.decision)
      : [];
    const repairBinding = card.repair_binding;
    const legacyAuthority =
      card.target_hint === "UNVERIFIED" &&
      card.authority_notice === "NO_OBJECTIVE_NO_RUN_NO_DISPATCH_NO_TARGET_MUTATION";
    const boundRepairAuthority =
      card.target_hint === "EXACT_EXISTING_SLICE4_REPAIR_IDENTITIES" &&
      card.authority_notice === "CONFIRM_AUTHORIZES_EXACT_BOUND_REPAIR_AFTER_RECEIPT_ACTIVATION" &&
      repairBinding?.selected_context.authority === "NON_AUTHORITATIVE_SELECTED_ASSISTANT_CONTEXT" &&
      repairBinding.selected_context.source_quote ===
        "This synthetic repair fixture requires a separate IMPLEMENT decision before any repair Run, candidate revision or evidence update." &&
      repairBinding.central_plan_ref ===
        "fixture.invalid/control@3f5801451f991226704f7b141ddbd6fbcb7e31ac#docs/ados-personal/implementation/SLICE4_REPAIR_AMENDMENT_PLAN_V0.1.md" &&
      repairBinding.local.objective_ref === "fixture.invalid/ados-local#11" &&
      isDigest(repairBinding.local.objective_digest) &&
      repairBinding.local.draft_pr === "fixture.invalid/ados-local#12" &&
      repairBinding.local.branch === "fixture/public-local-safety-v1" &&
      repairBinding.local.revision_1_sha === "6bfbb7b8b74bad18144c97d439260a98e11384f3" &&
      repairBinding.fixture.objective_ref === "fixture.invalid/ados-fixture-delivery#5" &&
      isDigest(repairBinding.fixture.objective_digest) &&
      isDigest(repairBinding.fixture.resolution_digest) &&
      repairBinding.fixture.draft_pr === "fixture.invalid/ados-fixture-delivery#6" &&
      repairBinding.fixture.branch === "fixture/public-target-safety-v1" &&
      repairBinding.fixture.revision_1_sha === "710bd4c9e1ba5912219ba401e205e9cec91268d4" &&
      repairBinding.evidence_comment ===
        "fixture.invalid/ados-fixture-delivery#6:issuecomment-1000001" &&
      repairBinding.retained_lineage === "REJECTED_CAUSAL_EVIDENCE_GAP" &&
      repairBinding.execution_profile === "safety.fixture-dogfood-gate@0.1.1-public.1" &&
      repairBinding.authorized_effects.length > 0 &&
      repairBinding.forbidden_effects.length > 0;
    if (
      hashCanonical(card as unknown as JsonValue) !== row.card_digest ||
      request.request_id !== row.request_id ||
      request.request_digest !== row.request_digest ||
      computeDeliveryRequestDigest(request) !== row.request_digest ||
      capture === undefined ||
      capture.selected_turn_digest !== row.selected_turn_digest ||
      capture.owner_turn_digest !== row.owner_turn_digest ||
      capture.adapter_id !== row.capture_profile_id ||
      capture.adapter_version !== row.capture_profile_version ||
      compiler === undefined ||
      compiler.profile_id !== row.compiler_profile_id ||
      compiler.profile_version !== row.compiler_profile_version ||
      request.requested_authorization !== row.requested_authorization ||
      request.readiness !== "READY" ||
      !Array.isArray(request.assumptions) || request.assumptions.length !== 0 ||
      !Array.isArray(request.open_decisions) || request.open_decisions.length !== 0 ||
      card.schema_version !== "slice3a-delivery-card/v0.1" ||
      card.request_id !== row.request_id ||
      card.readiness !== "READY" ||
      card.requested_authorization !== row.requested_authorization ||
      card.capture_profile !== `${row.capture_profile_id}@${row.capture_profile_version}` ||
      card.compiler_profile !== `${row.compiler_profile_id}@${row.compiler_profile_version}` ||
      card.digest_short_codes.selected_turn !== shortDigest(row.selected_turn_digest) ||
      card.digest_short_codes.owner_turn !== shortDigest(row.owner_turn_digest) ||
      card.digest_short_codes.candidate !== shortDigest(row.compiler_candidate_digest) ||
      card.digest_short_codes.request !== shortDigest(row.request_digest) ||
      card.consequence !== "APPROVED_NOT_DISPATCHED" ||
      (!legacyAuthority && !boundRepairAuthority) ||
      !Array.isArray(requestDecisions) ||
      !Array.isArray(cardDecisions) ||
      cardDecisions.length === 0 ||
      canonicalJson(cardDecisionTexts as unknown as JsonValue) !== canonicalJson(requestDecisions as JsonValue) ||
      cardDecisions.some((decision) =>
        decision.decision.length === 0 ||
        decision.source_quote !== decision.decision ||
        decision.source_turn_id.length === 0
      ) ||
      !isDigest(row.capture_digest) ||
      !isDigest(row.compiler_candidate_digest)
    ) {
      throw new Error("BLOCKED_RECEIPT:JIT_DURABLE_BINDING_DRIFT");
    }
    return { request, card };
  }

  #confirmationSnapshot(
    extensionOrigin: string,
    challenge: ChallengeBinding,
    challengeToken: string,
  ): ConfirmationSnapshot & { readonly row: ChallengeRow } {
    if (extensionOrigin !== slice3aExtensionOrigin || challenge.extension_origin !== extensionOrigin) {
      throw new Error("BLOCKED_NATIVE_ORIGIN");
    }
    const identity = this.#existingIdentity();
    if (challenge.actor_id !== identity.actor_id || !verifyChallengeToken(challenge, challengeToken, identity)) {
      throw new Error("BLOCKED_RECEIPT:CHALLENGE_AUTHENTICATION");
    }
    const row = this.#driver.get<ChallengeRow>(
      "SELECT * FROM intake_challenges WHERE challenge_id = ?",
      [challenge.challenge_id],
    );
    if (
      row === undefined ||
      canonicalJson(bindingFromRow(row) as unknown as JsonObject) !== canonicalJson(challenge as unknown as JsonObject)
    ) {
      throw new Error("BLOCKED_RECEIPT:CHALLENGE_BINDING");
    }

    return { row, ...this.#durableSnapshot(row) };
  }

  #readyCardCandidate(
    extensionOrigin: string,
    expected: DurableReadyCardIdentity,
  ): { readonly row: ChallengeRow; readonly snapshot: ConfirmationSnapshot } {
    if (extensionOrigin !== slice3aExtensionOrigin) {
      throw new Error("BLOCKED_NATIVE_ORIGIN");
    }
    const candidates = this.#driver.all<ChallengeRow>(
      `SELECT * FROM intake_challenges
       WHERE requested_authorization = 'IMPLEMENT'
         AND consumed_at IS NULL
         AND receipt_id IS NULL
       ORDER BY issued_at, challenge_id`,
    );
    if (candidates.length === 0) {
      throw new Error("BLOCKED_READY_CARD_RESTORE:NO_CANDIDATE");
    }
    if (candidates.length !== 1) {
      throw new Error(`BLOCKED_READY_CARD_RESTORE:MULTIPLE_CANDIDATES:${candidates.length}`);
    }
    const row = candidates[0]!;
    const identity = this.#existingIdentity();
    const snapshot = this.#durableSnapshot(row);
    const compilerIdentity = snapshot.request.compiler as JsonObject | undefined;
    if (
      row.challenge_id !== expected.challenge_id ||
      row.selected_turn_digest !== expected.selected_turn_digest ||
      row.owner_turn_digest !== expected.owner_turn_digest ||
      row.compiler_candidate_digest !== expected.compiler_candidate_digest ||
      row.request_id !== expected.request_id ||
      row.request_digest !== expected.request_digest ||
      row.card_digest !== expected.card_digest ||
      row.capture_digest !== expected.capture_digest ||
      row.compiler_profile_id !== expected.compiler_profile_id ||
      row.compiler_profile_version !== expected.compiler_profile_version ||
      row.extension_origin !== extensionOrigin ||
      row.actor_id !== identity.actor_id ||
      row.requested_authorization !== "IMPLEMENT" ||
      compilerIdentity?.capability_digest !== expected.compiler_capability_digest
    ) {
      throw new Error("BLOCKED_READY_CARD_RESTORE:FROZEN_IDENTITY_DRIFT");
    }
    const now = Date.parse(this.#now());
    const expiresAt = Date.parse(row.expires_at);
    if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || now <= expiresAt) {
      throw new Error("BLOCKED_READY_CARD_RESTORE:CHALLENGE_NOT_EXPIRED");
    }
    return { row, snapshot };
  }

  public inspectReadyCardCandidate(
    extensionOrigin: string,
    identity: DurableReadyCardIdentity,
  ): ConfirmationSnapshot {
    return this.#readyCardCandidate(extensionOrigin, identity).snapshot;
  }

  public restoreReadyCard(input: RestoreReadyCardInput): ReadyCardRehydrationResponse {
    assertRevalidation(input.revalidation);
    const { row, snapshot } = this.#readyCardCandidate(input.extension_origin, input.identity);
    const expected = input.identity;
    if (
      input.revalidation.compiler_profile_digest !== expected.compiler_profile_digest ||
      input.revalidation.compiler_capability_digest !== expected.compiler_capability_digest ||
      input.revalidation.local_objective_digest !== expected.local_objective_digest ||
      input.revalidation.target_objective_digest !== expected.target_objective_digest ||
      input.revalidation.target_resolution_digest !== expected.target_resolution_digest ||
      input.revalidation.target_harness_digest !== expected.target_harness_digest
    ) {
      throw new Error("BLOCKED_READY_CARD_RESTORE:FROZEN_IDENTITY_DRIFT");
    }
    const signed = signChallenge(bindingFromRow(row), this.#existingIdentity());
    return {
      status: "READY_FOR_CONFIRMATION",
      restoration: "DURABLE_READY_CARD_REHYDRATED",
      request: snapshot.request,
      card: snapshot.card,
      card_digest: row.card_digest,
      challenge: signed.challenge,
      challenge_token: signed.challenge_token,
      consequence: "APPROVED_NOT_DISPATCHED",
    };
  }

  public inspectConfirmation(
    extensionOrigin: string,
    challenge: ChallengeBinding,
    challengeToken: string,
  ): ConfirmationSnapshot {
    const snapshot = this.#confirmationSnapshot(extensionOrigin, challenge, challengeToken);
    return { request: snapshot.request, card: snapshot.card };
  }

  public prepareConfirmation(input: PrepareConfirmationInput): JitConfirmationResponse {
    assertRevalidation(input.revalidation);
    const snapshot = this.#confirmationSnapshot(
      input.extension_origin,
      input.challenge,
      input.challenge_token,
    );
    const compiler = snapshot.request.compiler as JsonObject;
    if (snapshot.row.requested_authorization !== "IMPLEMENT") {
      throw new Error("BLOCKED_RECEIPT:JIT_AUTHORIZATION");
    }
    if (compiler.capability_digest !== input.revalidation.compiler_capability_digest) {
      throw new Error("BLOCKED_RECEIPT:JIT_COMPILER_DIGEST_DRIFT");
    }
    const identity = this.#existingIdentity();
    const issuedAt = this.#now();
    const issuedAtMs = Date.parse(issuedAt);
    if (!Number.isFinite(issuedAtMs)) {
      throw new Error("BLOCKED_RECEIPT:JIT_CLOCK_INVALID");
    }
    const binding: JitConfirmationBinding = {
      schema_version: "slice3b-jit-confirmation-binding/v0.1",
      original_challenge_id: input.challenge.challenge_id,
      original_challenge_digest: hashCanonical(input.challenge as unknown as JsonValue),
      original_challenge_token_digest: sha256Text(input.challenge_token),
      extension_origin: input.extension_origin,
      actor_id: identity.actor_id,
      card_digest: input.challenge.card_digest,
      capture_digest: input.challenge.capture_digest,
      compiler_candidate_digest: input.challenge.compiler_candidate_digest,
      request_id: input.challenge.request_id,
      request_digest: input.challenge.request_digest,
      nonce_digest: sha256Text(randomBytes(32)),
      revalidation: input.revalidation,
      issued_at: issuedAt,
      expires_at: new Date(issuedAtMs + this.#jitConfirmationTtlMs).toISOString(),
    };
    return signJitConfirmation(binding, identity);
  }

  public confirm(input: ConfirmInput): ApprovedIntake {
    const observed = this.#confirmationSnapshot(
      input.extension_origin,
      input.challenge,
      input.challenge_token,
    );
    const identity = this.#existingIdentity();
    if (input.jit_confirmation !== undefined) {
      const { binding, token, current_revalidation: currentRevalidation } = input.jit_confirmation;
      assertRevalidation(currentRevalidation);
      if (observed.row.requested_authorization !== "IMPLEMENT") {
        throw new Error("BLOCKED_RECEIPT:JIT_AUTHORIZATION");
      }
      if (!verifyJitConfirmationToken(binding, token, identity)) {
        throw new Error("BLOCKED_RECEIPT:JIT_AUTHENTICATION");
      }
      if (
        binding.schema_version !== "slice3b-jit-confirmation-binding/v0.1" ||
        binding.original_challenge_id !== input.challenge.challenge_id ||
        binding.original_challenge_digest !== hashCanonical(input.challenge as unknown as JsonValue) ||
        binding.original_challenge_token_digest !== sha256Text(input.challenge_token) ||
        binding.extension_origin !== input.extension_origin ||
        binding.actor_id !== identity.actor_id ||
        binding.card_digest !== input.challenge.card_digest ||
        binding.capture_digest !== input.challenge.capture_digest ||
        binding.compiler_candidate_digest !== input.challenge.compiler_candidate_digest ||
        binding.request_id !== input.challenge.request_id ||
        binding.request_digest !== input.challenge.request_digest ||
        !isDigest(binding.nonce_digest) ||
        canonicalJson(binding.revalidation as unknown as JsonObject) !==
          canonicalJson(currentRevalidation as unknown as JsonObject)
      ) {
        throw new Error("BLOCKED_RECEIPT:JIT_BINDING_MISMATCH");
      }
      const issuedAt = Date.parse(binding.issued_at);
      const expiresAt = Date.parse(binding.expires_at);
      const now = Date.parse(this.#now());
      if (
        !Number.isFinite(issuedAt) ||
        !Number.isFinite(expiresAt) ||
        !Number.isFinite(now) ||
        expiresAt - issuedAt !== this.#jitConfirmationTtlMs ||
        now < issuedAt ||
        now > expiresAt
      ) {
        throw new Error("BLOCKED_RECEIPT:JIT_EXPIRED");
      }
      const compiler = observed.request.compiler as JsonObject;
      if (compiler.capability_digest !== currentRevalidation.compiler_capability_digest) {
        throw new Error("BLOCKED_RECEIPT:JIT_COMPILER_DIGEST_DRIFT");
      }
    }
    let committed = false;
    try {
      const result = this.#transaction(() => {
        this.verifyEventChain();
        this.verifyProjectionConsistency();
        const row = this.#driver.get<ChallengeRow>(
          "SELECT * FROM intake_challenges WHERE challenge_id = ?",
          [input.challenge.challenge_id],
        );
        if (row === undefined || canonicalJson(bindingFromRow(row) as unknown as JsonObject) !== canonicalJson(input.challenge as unknown as JsonObject)) {
          throw new Error("BLOCKED_RECEIPT:CHALLENGE_BINDING");
        }
        if (row.consumed_at !== null) {
          return { ...this.#readApproved(row.request_digest), disposition: "DUPLICATE_RECONCILED" as const };
        }
        const now = this.#now();
        if (input.jit_confirmation === undefined && Date.parse(now) > Date.parse(row.expires_at)) {
          throw new Error("BLOCKED_RECEIPT:CHALLENGE_EXPIRED");
        }
        const receiptId = deterministicId("oar", {
          challenge_id: row.challenge_id,
          request_digest: row.request_digest,
          actor_id: row.actor_id,
        });
        const receipt: OwnerAuthorizationReceipt = {
          receipt_id: receiptId,
          actor_id: row.actor_id,
          authn_method: "local_extension_confirm",
          action: "approve_delivery",
          authorization: row.requested_authorization,
          approval_ref: `local-extension://challenge/${row.challenge_id}`,
          owner_turn_digest: row.owner_turn_digest,
          request_digest: row.request_digest,
          approved_at: now,
        };
        const draft: DeliveryRequestDraft = {
          request: JSON.parse(row.request_json) as JsonObject,
          request_id: row.request_id,
          request_digest: row.request_digest,
        };
        const request = finalizeDeliveryRequest(draft, receipt, new ContractValidator());
        const activationId = deterministicId("activation", {
          request_digest: row.request_digest,
          receipt_id: receiptId,
        });
        const eventId = deterministicId("intake-event", {
          activation_id: activationId,
          event_type: "INTAKE_APPROVED",
        });
        const previous = this.#driver.get<{ readonly event_digest: string }>(
          "SELECT event_digest FROM intake_events ORDER BY seq DESC LIMIT 1",
        )?.event_digest ?? null;
        const payload: JsonObject = {
          request_id: row.request_id,
          request_digest: row.request_digest,
          receipt_id: receiptId,
          activation_id: activationId,
          status: "APPROVED_NOT_DISPATCHED",
          capture_digest: row.capture_digest,
          compiler_candidate_digest: row.compiler_candidate_digest,
          request,
          receipt: receipt as unknown as JsonValue,
          activation: {
            activation_id: activationId,
            request_id: row.request_id,
            request_digest: row.request_digest,
            receipt_id: receiptId,
            status: "APPROVED_NOT_DISPATCHED",
            created_at: now,
            last_intake_event: eventId,
          },
        };
        const eventDigest = hashCanonical({
          event_id: eventId,
          activation_id: activationId,
          event_type: "INTAKE_APPROVED",
          occurred_at: now,
          previous_digest: previous,
          payload,
        });
        const event = this.#driver.run(
          `INSERT INTO intake_events(
            event_id, activation_id, event_type, occurred_at,
            previous_digest, event_digest, payload_json
          ) VALUES (?, ?, 'INTAKE_APPROVED', ?, ?, ?, ?)`,
          [eventId, activationId, now, previous, eventDigest, canonicalJson(payload)],
        );
        const seq = safeInteger(event.lastInsertRowid);
        this.#driver.run(
          `INSERT INTO approved_delivery_requests(
            request_id, request_digest, request_json, capture_digest,
            compiler_candidate_digest, created_at, last_intake_event
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [row.request_id, row.request_digest, canonicalJson(request), row.capture_digest, row.compiler_candidate_digest, now, seq],
        );
        this.#driver.run(
          `INSERT INTO intake_receipts(
            receipt_id, request_id, challenge_id, actor_id, authn_method,
            action, authorization, approval_ref, owner_turn_digest,
            request_digest, approved_at, last_intake_event
          ) VALUES (?, ?, ?, ?, 'local_extension_confirm', 'approve_delivery', ?, ?, ?, ?, ?, ?)`,
          [receiptId, row.request_id, row.challenge_id, row.actor_id, row.requested_authorization, receipt.approval_ref, row.owner_turn_digest, row.request_digest, now, seq],
        );
        this.#driver.run(
          `INSERT INTO activations(
            activation_id, request_id, request_digest, receipt_id,
            status, created_at, last_intake_event
          ) VALUES (?, ?, ?, ?, 'APPROVED_NOT_DISPATCHED', ?, ?)`,
          [activationId, row.request_id, row.request_digest, receiptId, now, seq],
        );
        this.#driver.run(
          "UPDATE intake_challenges SET consumed_at = ?, receipt_id = ? WHERE challenge_id = ? AND consumed_at IS NULL",
          [now, receiptId, row.challenge_id],
        );
        if (input.fault === "before_commit") {
          throw new Error("TEST_FAULT:BEFORE_COMMIT");
        }
        return {
          request,
          request_id: row.request_id,
          request_digest: row.request_digest,
          receipt,
          activation: {
            activation_id: activationId,
            request_id: row.request_id,
            request_digest: row.request_digest,
            receipt_id: receiptId,
            status: "APPROVED_NOT_DISPATCHED" as const,
            created_at: now,
            last_intake_event: eventId,
          },
          disposition: "CREATED" as const,
        };
      });
      committed = true;
      if (input.fault === "after_commit") {
        throw new Error("TEST_FAULT:AFTER_COMMIT");
      }
      this.verifyEventChain();
      this.verifyProjectionConsistency();
      return result;
    } catch (error) {
      if (committed) {
        throw error;
      }
      throw error;
    }
  }

  #readApproved(requestDigest: string): Omit<ApprovedIntake, "disposition"> {
    const row = this.#driver.get<{
      readonly request_id: string;
      readonly request_digest: string;
      readonly request_json: string;
      readonly receipt_id: string;
      readonly actor_id: string;
      readonly authorization: OwnerAuthorizationReceipt["authorization"];
      readonly approval_ref: string;
      readonly owner_turn_digest: string;
      readonly approved_at: string;
      readonly activation_id: string;
      readonly status: "APPROVED_NOT_DISPATCHED";
      readonly created_at: string;
      readonly event_id: string;
    }>(
      `SELECT r.request_id, r.request_digest, r.request_json,
        o.receipt_id, o.actor_id, o.authorization, o.approval_ref,
        o.owner_turn_digest, o.approved_at,
        a.activation_id, a.status, a.created_at, e.event_id
      FROM approved_delivery_requests r
      JOIN intake_receipts o ON o.request_id = r.request_id
      JOIN activations a ON a.request_id = r.request_id
      JOIN intake_events e ON e.seq = a.last_intake_event
      WHERE r.request_digest = ?`,
      [requestDigest],
    );
    if (row === undefined) {
      throw new Error(`INTAKE_NOT_FOUND:${requestDigest}`);
    }
    const request = JSON.parse(row.request_json) as JsonObject;
    const receipt = request.owner_authorization_receipt as unknown as OwnerAuthorizationReceipt;
    return {
      request,
      request_id: row.request_id,
      request_digest: row.request_digest,
      receipt,
      activation: {
        activation_id: row.activation_id,
        request_id: row.request_id,
        request_digest: row.request_digest,
        receipt_id: row.receipt_id,
        status: row.status,
        created_at: row.created_at,
        last_intake_event: row.event_id,
      },
    };
  }

  public status(requestDigest?: string): Omit<ApprovedIntake, "disposition"> | null {
    const digest = requestDigest ?? this.#driver.get<{ readonly request_digest: string }>(
      "SELECT request_digest FROM activations ORDER BY created_at DESC, activation_id DESC LIMIT 1",
    )?.request_digest;
    return digest === undefined ? null : this.#readApproved(digest);
  }

  public statusByActivation(activationId: string): Omit<ApprovedIntake, "disposition"> | null {
    const digest = this.#driver.get<{ readonly request_digest: string }>(
      "SELECT request_digest FROM activations WHERE activation_id = ?",
      [activationId],
    )?.request_digest;
    return digest === undefined ? null : this.#readApproved(digest);
  }

  public counts(): { readonly challenges: number; readonly requests: number; readonly receipts: number; readonly activations: number; readonly events: number } {
    const count = (table: string): number => Number(this.#driver.get<{ readonly count: number }>(`SELECT count(*) AS count FROM ${table}`)?.count ?? 0);
    return {
      challenges: count("intake_challenges"),
      requests: count("approved_delivery_requests"),
      receipts: count("intake_receipts"),
      activations: count("activations"),
      events: count("intake_events"),
    };
  }

  public verifyIntegrity(): void {
    if (String(this.#driver.pragma("quick_check", true)) !== "ok" || String(this.#driver.pragma("integrity_check", true)) !== "ok") {
      throw new Error("INTAKE_DATABASE_INTEGRITY_FAILED");
    }
  }

  public verifySchema(): void {
    const required = new Set(["intake_challenges", "intake_events", "approved_delivery_requests", "intake_receipts", "activations"]);
    const tables = this.#driver.all<{ readonly name: string; readonly sql: string }>(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    for (const table of tables) {
      if (required.has(table.name)) {
        required.delete(table.name);
        if (!/\)\s*STRICT\s*;?$/iu.test(table.sql)) {
          throw new Error(`INTAKE_SCHEMA_NOT_STRICT:${table.name}`);
        }
      }
    }
    if (required.size !== 0) {
      throw new Error(`INTAKE_SCHEMA_MISSING:${[...required].join(",")}`);
    }
    const columns = this.#driver.all<{ readonly name: string }>("PRAGMA table_info(activations)").map((row) => row.name);
    if (columns.some((name) => /objective|run_|work_item|candidate_state/iu.test(name))) {
      throw new Error("INTAKE_SCHEMA_COPIES_DYNAMIC_OBJECTIVE_STATE");
    }
  }

  public verifyEventChain(): void {
    const events = this.#driver.all<EventRow>("SELECT * FROM intake_events ORDER BY seq");
    let previous: string | null = null;
    for (const event of events) {
      const expected = hashCanonical({
        event_id: event.event_id,
        activation_id: event.activation_id,
        event_type: event.event_type,
        occurred_at: event.occurred_at,
        previous_digest: previous,
        payload: JSON.parse(event.payload_json) as JsonValue,
      });
      if (event.previous_digest !== previous || event.event_digest !== expected) {
        throw new Error(`INTAKE_EVENT_CHAIN_INVALID:${event.event_id}`);
      }
      previous = event.event_digest;
    }
  }

  public rebuildProjectionSnapshot(): readonly Omit<ApprovedIntake, "disposition">[] {
    return this.#driver.all<EventRow>("SELECT * FROM intake_events ORDER BY seq").map((event) => {
      const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
      const request = payload.request as JsonObject | undefined;
      const receipt = payload.receipt as unknown as OwnerAuthorizationReceipt | undefined;
      const activation = payload.activation as ApprovedIntake["activation"] | undefined;
      if (
        request === undefined ||
        receipt === undefined ||
        activation === undefined ||
        activation.last_intake_event !== event.event_id ||
        activation.activation_id !== event.activation_id ||
        receipt.receipt_id !== activation.receipt_id ||
        receipt.request_digest !== activation.request_digest ||
        request.request_id !== activation.request_id ||
        request.request_digest !== activation.request_digest
      ) {
        throw new Error(`INTAKE_EVENT_REBUILD_INVALID:${event.event_id}`);
      }
      return {
        request,
        request_id: activation.request_id,
        request_digest: activation.request_digest,
        receipt,
        activation,
      };
    });
  }

  public verifyProjectionConsistency(): void {
    const rebuilt = this.rebuildProjectionSnapshot();
    const actual = rebuilt.map((item) => this.#readApproved(item.request_digest));
    if (
      canonicalJson(rebuilt as unknown as JsonValue) !==
      canonicalJson(actual as unknown as JsonValue)
    ) {
      throw new Error("INTAKE_PROJECTION_DRIFT");
    }
  }

  public async backup(destinationPath: string): Promise<void> {
    mkdirSync(dirname(destinationPath), { recursive: true });
    await this.#driver.backup(destinationPath);
    const backup = new BetterSqlite3Driver(destinationPath, { readonly: true, fileMustExist: true });
    try {
      if (String(backup.pragma("integrity_check", true)) !== "ok") {
        throw new Error("BLOCKED_INTAKE_BACKUP:INTEGRITY");
      }
    } finally {
      backup.close();
    }
  }
}

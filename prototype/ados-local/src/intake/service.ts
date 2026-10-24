import { spawnSync } from "node:child_process";
import { compilerPackForCapture, validateCapturePack } from "../capture/profile.js";
import type { ConversationEvidencePack, AcceptedCompilerCandidate, FrozenCompilerProfile } from "../compiler/types.js";
import { frozenProfile, runFrozenCompilerOnce } from "../compiler/profile.js";
import { hashCanonical } from "../canonical/index.js";
import { ContractValidator } from "../contracts/validator.js";
import { readRunningObjective } from "../profiles/forge-profile.js";
import {
  FIXTURE_BASE_SHA,
  FIXTURE_OBJECTIVE_REF,
  resolveSoleRunningFixtureObjective,
} from "../resolver/fixture-single-running-objective.js";
import { buildDeliveryCard, deliveryCardDigest } from "./card.js";
import { buildDeliveryRequestDraft } from "./request.js";
import {
  IntakeStore,
  slice3aExtensionOrigin,
  type ConfirmInput,
} from "./store.js";
import type {
  ApprovedIntake,
  ChallengeBinding,
  ConfirmationRevalidation,
  DeliveryCard,
  DurableReadyCardIdentity,
  JitConfirmationBinding,
  JitConfirmationResponse,
  ReadyCardRehydrationResponse,
} from "./types.js";
import type { JsonObject, JsonValue } from "../types.js";

export interface DeliveryRequestBinderResult {
  readonly draft: import("./types.js").DeliveryRequestDraft;
  readonly card_binding: NonNullable<DeliveryCard["repair_binding"]>;
}

export type DeliveryRequestBinder = (
  pack: ConversationEvidencePack,
  candidate: AcceptedCompilerCandidate,
  draft: import("./types.js").DeliveryRequestDraft,
) => DeliveryRequestBinderResult;

export interface IntakeCompilerResult {
  readonly candidate: AcceptedCompilerCandidate;
  readonly profile: FrozenCompilerProfile;
  readonly evidence: {
    readonly prompt_digest: string;
    readonly tool_items: 0;
    readonly server_requests: number;
    readonly cleanup: "PASS";
    readonly residual_process_status: "ABSENT";
  };
}

export interface IntakeCompilerPort {
  compile(pack: ConversationEvidencePack): Promise<IntakeCompilerResult>;
}

export interface ConfirmationRevalidator {
  revalidate(request: JsonObject): ConfirmationRevalidation;
}

// Derived from fixtures/public-bindings.json. This is a synthetic identity, not a live receipt.
export const durableReadyCardIdentity: DurableReadyCardIdentity = {
  "challenge_id": "challenge-6c4c8e85d18ae0df754215f3e2b767ac",
  "selected_turn_digest": "sha256:0b0d145fe9ae74d179ac4875f7b225b2350bc19f7dc57ebc0aba1ba6c9774fd4",
  "owner_turn_digest": "sha256:9db970c832091b69fcb2e7c92d60d4010ebe859c2b0fdb8a31eba5b336d19dd3",
  "compiler_candidate_digest": "sha256:b5dcf7f61e7bd22d77e5fef292fba027778f5c05df997c473dcccfb232a92dc4",
  "request_id": "dr-dd11fad04ee0623e4cc82232cd429205",
  "request_digest": "sha256:e6c3fd17c3bc9e3f9400f78d8f9a4040eda03d0ef69066f98f185915d122be41",
  "card_digest": "sha256:87957bdf1e831b5c4367dfc710e3e084e970e8fd8a059ab50a7bf0b2630c5201",
  "capture_digest": "sha256:7b79a06a56a69ce71dd7020de301b36decbfc85a8377fda21ad4dcc577efef56",
  "compiler_profile_id": "compiler.codex-app-server.gate0a-no-tools",
  "compiler_profile_version": "0.3.1-public.1",
  "compiler_profile_digest": "sha256:712be97b949b77c5f08b90d33d0b5bd3ffd65f22a440e2469ade45ea0a53f986",
  "compiler_capability_digest": "sha256:eca12affed7f7e7f418f833fecab0eb74faec495651048ba2674696e4ca84d75",
  "local_objective_digest": "sha256:febfa6143fe3e42102b5935978165291bda6a066f4f486231e01ad977f771eaa",
  "target_objective_digest": "sha256:03858ec2629c12de0523ff47fa8f0ec44b9e4dde8e9ebcd2838bc7b0231e5319",
  "target_resolution_digest": "sha256:5160ed789212ef6abd1a8d00691565168ae070a1d59fed7cd2ebba58e5518bb2",
  "target_harness_digest": "sha256:13c28e03bdbee36042ace9618f057673503cc1dac96cf7884069f364831967bd"
};

function readyCardForgeEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    "APPDATA", "COMSPEC", "GH_CONFIG_DIR", "GH_ENTERPRISE_TOKEN", "GH_HOST", "GH_TOKEN",
    "GITHUB_TOKEN", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "OS", "PATH", "PATHEXT",
    "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "SYSTEMDRIVE", "SYSTEMROOT",
    "TEMP", "TMP", "USERPROFILE", "WINDIR",
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) =>
      allowed.has(name.toUpperCase()) && value !== undefined),
  );
}

function readBlockedLocalObjective(): Record<string, unknown> {
  const child = spawnSync("gh", [
    "issue", "view", "9", "--repo", "fixture.invalid/ados-local", "--json", "body,state,url",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: readyCardForgeEnvironment(),
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (child.error !== undefined || child.status !== 0 || child.signal !== null) {
    throw new Error("BLOCKED_READY_CARD_RESTORE:LOCAL_OBJECTIVE_READ");
  }
  let issue: Record<string, unknown>;
  try {
    issue = JSON.parse(child.stdout) as Record<string, unknown>;
  } catch {
    throw new Error("BLOCKED_READY_CARD_RESTORE:LOCAL_OBJECTIVE_READ");
  }
  if (issue.state !== "OPEN" || typeof issue.body !== "string") {
    throw new Error("BLOCKED_READY_CARD_RESTORE:LOCAL_OBJECTIVE_STATE");
  }
  const matches = [...issue.body.matchAll(/```ados-objective\s*\r?\n([\s\S]*?)\r?\n```/g)];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new Error("BLOCKED_READY_CARD_RESTORE:LOCAL_OBJECTIVE_FENCE");
  }
  try {
    return JSON.parse(matches[0][1]) as Record<string, unknown>;
  } catch {
    throw new Error("BLOCKED_READY_CARD_RESTORE:LOCAL_OBJECTIVE_FENCE");
  }
}

export const jitConfirmationAllowedScope = [
  "src/intake/** only for a stateless device-signed JIT confirmation binding, exact live revalidation of the existing immutable Card/Candidate/draft Request, and atomic one-time consumption of the original durable Challenge; no recapture, recompile, request/card rewrite, schema migration or authorization escalation",
  "existing src/native/** and browser-extension/** scope only to perform the internal prepare-confirm -> confirm two-message protocol under one visible Owner click and render precise blockers",
  "existing focused intake/native/browser/Slice 3A/Slice 3B tests and docs/HARNESS.md, docs/SLICE3B_REPORT.md, docs/SLICE3B_OWNER_DEMO.md only for identities, commands and evidence",
] as const;

export class Slice3BConfirmationRevalidator implements ConfirmationRevalidator {
  public revalidate(request: JsonObject): ConfirmationRevalidation {
    const local = readRunningObjective(process.cwd(), "fixture.invalid/ados-local", 9);
    const validation = new ContractValidator().validateSchema("objective-record", local.objective);
    const allowedScope = local.objective.allowed_scope;
    if (
      !validation.valid ||
      local.issue_ref !== "fixture.invalid/ados-local#9" ||
      local.objective.objective_id !== "ados-public-slice3b-activation-v0.1" ||
      local.objective.project_id !== "ados-local" ||
      local.objective.contract_ref !==
        "ian-721/agentic-delivery-os@72f2d1ffbe86030d9f92a6629f4992111a7d6702#contracts/OBJECTIVE_CONTRACT.md" ||
      local.objective.project_harness_ref !==
        "fixture.invalid/ados-local@eb908c7ad58846f0d35d5a9989555203435ffbc9#docs/HARNESS.md" ||
      local.objective.authorization !== "IMPLEMENT" ||
      local.objective.status !== "RUNNING" ||
      !Array.isArray(allowedScope) ||
      jitConfirmationAllowedScope.some((entry) => !allowedScope.includes(entry))
    ) {
      throw new Error("BLOCKED_RECEIPT:JIT_LOCAL_OBJECTIVE_DRIFT");
    }

    const profile = frozenProfile();
    const compiler = request.compiler as JsonObject | undefined;
    if (
      profile.profile_id !== "compiler.codex-app-server.gate0a-no-tools" ||
      profile.profile_version !== "0.3.1-public.1" ||
      profile.profile_digest !== "sha256:712be97b949b77c5f08b90d33d0b5bd3ffd65f22a440e2469ade45ea0a53f986" ||
      profile.capability_digest !== "sha256:eca12affed7f7e7f418f833fecab0eb74faec495651048ba2674696e4ca84d75" ||
      compiler === undefined ||
      compiler.profile_id !== profile.profile_id ||
      compiler.profile_version !== profile.profile_version ||
      compiler.capability_digest !== profile.capability_digest
    ) {
      throw new Error("BLOCKED_RECEIPT:JIT_COMPILER_DIGEST_DRIFT");
    }

    const resolution = resolveSoleRunningFixtureObjective(request as Record<string, JsonValue>);
    if (resolution.objective_ref !== FIXTURE_OBJECTIVE_REF || resolution.base_sha !== FIXTURE_BASE_SHA) {
      throw new Error("BLOCKED_RECEIPT:JIT_TARGET_DRIFT");
    }
    return {
      schema_version: "slice3b-confirmation-revalidation/v0.1",
      local_objective_ref: "fixture.invalid/ados-local#9",
      local_objective_digest: hashCanonical(local.objective as JsonValue),
      target_objective_ref: FIXTURE_OBJECTIVE_REF,
      target_objective_digest: resolution.objective_digest,
      target_resolution_digest: resolution.resolution_digest,
      target_harness_digest: resolution.harness_digest,
      target_base_sha: FIXTURE_BASE_SHA,
      compiler_profile_digest: profile.profile_digest,
      compiler_capability_digest: profile.capability_digest,
    };
  }
}

export class DurableReadyCardRehydrationRevalidator implements ConfirmationRevalidator {
  public revalidate(request: JsonObject): ConfirmationRevalidation {
    const localObjective = readBlockedLocalObjective();
    const validation = new ContractValidator().validateSchema("objective-record", localObjective);
    if (
      !validation.valid ||
      localObjective.objective_id !== "ados-public-slice3b-activation-v0.1" ||
      localObjective.project_id !== "ados-local" ||
      localObjective.contract_ref !==
        "ian-721/agentic-delivery-os@72f2d1ffbe86030d9f92a6629f4992111a7d6702#contracts/OBJECTIVE_CONTRACT.md" ||
      localObjective.project_harness_ref !==
        "fixture.invalid/ados-local@eb908c7ad58846f0d35d5a9989555203435ffbc9#docs/HARNESS.md" ||
      localObjective.authorization !== "IMPLEMENT" ||
      localObjective.status !== "BLOCKED" ||
      hashCanonical(localObjective as JsonValue) !== durableReadyCardIdentity.local_objective_digest
    ) {
      throw new Error("BLOCKED_READY_CARD_RESTORE:LOCAL_OBJECTIVE_DRIFT");
    }

    const profile = frozenProfile();
    const compiler = request.compiler as JsonObject | undefined;
    if (
      profile.profile_id !== durableReadyCardIdentity.compiler_profile_id ||
      profile.profile_version !== durableReadyCardIdentity.compiler_profile_version ||
      profile.profile_digest !== durableReadyCardIdentity.compiler_profile_digest ||
      profile.capability_digest !== durableReadyCardIdentity.compiler_capability_digest ||
      compiler === undefined ||
      compiler.profile_id !== profile.profile_id ||
      compiler.profile_version !== profile.profile_version ||
      compiler.capability_digest !== profile.capability_digest
    ) {
      throw new Error("BLOCKED_READY_CARD_RESTORE:COMPILER_PROFILE_DRIFT");
    }

    const resolution = resolveSoleRunningFixtureObjective(request as Record<string, JsonValue>);
    if (
      resolution.objective_ref !== FIXTURE_OBJECTIVE_REF ||
      resolution.base_sha !== FIXTURE_BASE_SHA ||
      resolution.objective_digest !== durableReadyCardIdentity.target_objective_digest ||
      resolution.resolution_digest !== durableReadyCardIdentity.target_resolution_digest ||
      resolution.harness_digest !== durableReadyCardIdentity.target_harness_digest
    ) {
      throw new Error("BLOCKED_READY_CARD_RESTORE:TARGET_DRIFT");
    }
    return {
      schema_version: "slice3b-confirmation-revalidation/v0.1",
      local_objective_ref: "fixture.invalid/ados-local#9",
      local_objective_digest: durableReadyCardIdentity.local_objective_digest,
      target_objective_ref: FIXTURE_OBJECTIVE_REF,
      target_objective_digest: resolution.objective_digest,
      target_resolution_digest: resolution.resolution_digest,
      target_harness_digest: resolution.harness_digest,
      target_base_sha: FIXTURE_BASE_SHA,
      compiler_profile_digest: profile.profile_digest,
      compiler_capability_digest: profile.capability_digest,
    };
  }
}

export class FrozenGate0ACompilerPort implements IntakeCompilerPort {
  public async compile(pack: ConversationEvidencePack): Promise<IntakeCompilerResult> {
    const result = await runFrozenCompilerOnce(pack);
    if (
      result.tool_items !== 0 ||
      result.server_requests !== 0 ||
      result.app_server_shutdown.status !== "PASS" ||
      result.app_server_shutdown.residual_process_status !== "ABSENT"
    ) {
      throw new Error("BLOCKED_COMPILER_PATH:INTAKE_PROFILE_CLEANUP");
    }
    return {
      candidate: result.candidate,
      profile: result.profile,
      evidence: {
        prompt_digest: result.prompt_digest,
        tool_items: 0,
        server_requests: 0,
        cleanup: "PASS",
        residual_process_status: "ABSENT",
      },
    };
  }
}

export interface CompileResponse {
  readonly status: "READY_FOR_CONFIRMATION";
  readonly request: JsonObject;
  readonly card: DeliveryCard;
  readonly card_digest: string;
  readonly challenge: ChallengeBinding;
  readonly challenge_token: string;
  readonly compiler_evidence: IntakeCompilerResult["evidence"];
  readonly consequence: "APPROVED_NOT_DISPATCHED";
}

export class IntakeService {
  public constructor(
    private readonly store: IntakeStore,
    private readonly compiler: IntakeCompilerPort = new FrozenGate0ACompilerPort(),
    private readonly confirmationRevalidator: ConfirmationRevalidator = new Slice3BConfirmationRevalidator(),
    private readonly readyCardRevalidator: ConfirmationRevalidator = new DurableReadyCardRehydrationRevalidator(),
    private readonly readyCardIdentity: DurableReadyCardIdentity = durableReadyCardIdentity,
  ) {}

  public async compile(
    captureValue: unknown,
    extensionOrigin: string,
    binder?: DeliveryRequestBinder,
  ): Promise<CompileResponse> {
    if (extensionOrigin !== slice3aExtensionOrigin) {
      throw new Error("BLOCKED_NATIVE_ORIGIN");
    }
    const capture = validateCapturePack(captureValue);
    const compilerPack = compilerPackForCapture(capture);
    const compiled = await this.compiler.compile(compilerPack);
    const genericDraft = buildDeliveryRequestDraft(capture, compiled.candidate, compiled.profile);
    const bound = binder?.(compilerPack, compiled.candidate, genericDraft);
    const draft = bound?.draft ?? genericDraft;
    const card = buildDeliveryCard(
      draft,
      capture,
      compiled.candidate,
      compiled.profile,
      bound?.card_binding,
    );
    const challenge = this.store.issueChallenge({
      extension_origin: extensionOrigin,
      draft,
      card,
      owner_turn_digest: capture.owner_turn_digest,
      requested_authorization: compiled.candidate.requested_authorization!,
      capture_profile_id: capture.pack.capture_profile_id,
      capture_profile_version: capture.pack.capture_profile_version,
      compiler_profile_id: compiled.profile.profile_id,
      compiler_profile_version: compiled.profile.profile_version,
      compiler_candidate_digest: compiled.candidate.candidate_digest,
      capture_digest: capture.capture_digest,
    });
    return {
      status: "READY_FOR_CONFIRMATION",
      request: draft.request,
      card,
      card_digest: deliveryCardDigest(card),
      challenge: challenge.challenge,
      challenge_token: challenge.challenge_token,
      compiler_evidence: compiled.evidence,
      consequence: "APPROVED_NOT_DISPATCHED",
    };
  }

  public confirm(
    extensionOrigin: string,
    challenge: ChallengeBinding,
    challengeToken: string,
    fault?: ConfirmInput["fault"],
    jitConfirmation?: { readonly binding: JitConfirmationBinding; readonly token: string },
  ): ApprovedIntake {
    let jit: ConfirmInput["jit_confirmation"];
    if (jitConfirmation !== undefined) {
      const snapshot = this.store.inspectConfirmation(extensionOrigin, challenge, challengeToken);
      jit = {
        binding: jitConfirmation.binding,
        token: jitConfirmation.token,
        current_revalidation: this.confirmationRevalidator.revalidate(snapshot.request),
      };
    }
    const input: ConfirmInput = {
      extension_origin: extensionOrigin,
      challenge,
      challenge_token: challengeToken,
      ...(jit === undefined ? {} : { jit_confirmation: jit }),
      ...(fault === undefined ? {} : { fault }),
    };
    return this.store.confirm(input);
  }

  public prepareConfirm(
    extensionOrigin: string,
    challenge: ChallengeBinding,
    challengeToken: string,
  ): JitConfirmationResponse {
    const snapshot = this.store.inspectConfirmation(extensionOrigin, challenge, challengeToken);
    const revalidation = this.confirmationRevalidator.revalidate(snapshot.request);
    return this.store.prepareConfirmation({
      extension_origin: extensionOrigin,
      challenge,
      challenge_token: challengeToken,
      revalidation,
    });
  }

  public restoreReadyCard(extensionOrigin: string): ReadyCardRehydrationResponse {
    const snapshot = this.store.inspectReadyCardCandidate(extensionOrigin, this.readyCardIdentity);
    const revalidation = this.readyCardRevalidator.revalidate(snapshot.request);
    return this.store.restoreReadyCard({
      extension_origin: extensionOrigin,
      revalidation,
      identity: this.readyCardIdentity,
    });
  }

  public status(requestDigest?: string) {
    return this.store.status(requestDigest);
  }
}

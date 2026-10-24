import { spawnSync } from "node:child_process";
import { hashCanonical } from "../../canonical/index.js";
import { frozenProfile } from "../../compiler/profile.js";
import { normalizeSourceText } from "../../compiler/validator.js";
import type {
  AcceptedCompilerCandidate,
  ConversationEvidencePack,
} from "../../compiler/types.js";
import { ContractValidator } from "../../contracts/validator.js";
import { computeDeliveryRequestDigest } from "../../contracts/validator.js";
import type {
  ConfirmationRevalidation,
  DeliveryCard,
  DeliveryRequestDraft,
} from "../../intake/types.js";
import type { ConfirmationRevalidator } from "../../intake/service.js";
import { readRunningObjective } from "../../profiles/forge-profile.js";
import type { JsonObject, JsonValue } from "../../types.js";
import {
  SLICE4_CENTRAL_SHA,
  SLICE4_CONTRACT_SHA,
  SLICE4_FIXTURE_BASE_SHA,
  SLICE4_LOCAL_BASE_SHA,
} from "./profile.js";
import {
  SLICE4_FIXTURE_OBJECTIVE_REF,
  resolveSoleRunningSlice4FixtureObjective,
} from "./resolver.js";

export class Slice4ConfirmationRevalidator implements ConfirmationRevalidator {
  public revalidate(request: JsonObject): ConfirmationRevalidation {
    const local = readRunningObjective(process.cwd(), "fixture.invalid/ados-local", 11);
    const validation = new ContractValidator().validateSchema("objective-record", local.objective);
    const sources = local.objective.sources;
    const hasRepairPlanSource = Array.isArray(sources) && sources.some((source) =>
      source !== null && typeof source === "object" && !Array.isArray(source) &&
      (source as Record<string, unknown>).ref ===
        `fixture.invalid/control@${SLICE4_CENTRAL_SHA}#docs/ados-personal/implementation/SLICE4_REPAIR_AMENDMENT_PLAN_V0.1.md`);
    if (
      !validation.valid ||
      local.issue_ref !== "fixture.invalid/ados-local#11" ||
      local.objective.objective_id !== "ados-public-slice4-safety-v0.1" ||
      local.objective.project_id !== "ados-local" ||
      local.objective.contract_ref !==
        `ian-721/agentic-delivery-os@${SLICE4_CONTRACT_SHA}#contracts/OBJECTIVE_CONTRACT.md` ||
      local.objective.project_harness_ref !==
        `fixture.invalid/ados-local@${SLICE4_LOCAL_BASE_SHA}#docs/HARNESS.md` ||
      local.objective.authorization !== "IMPLEMENT" ||
      local.objective.status !== "RUNNING" ||
      !hasRepairPlanSource ||
      local.objective.owner_approval_ref !==
        "synthetic://ados-public/v1/slice4-approval"
    ) {
      throw new Error("BLOCKED_RECEIPT:JIT_LOCAL_OBJECTIVE_DRIFT");
    }
    const profile = frozenProfile();
    const compiler = request.compiler as JsonObject | undefined;
    if (
      compiler === undefined ||
      compiler.profile_id !== profile.profile_id ||
      compiler.profile_version !== profile.profile_version ||
      compiler.capability_digest !== profile.capability_digest
    ) {
      throw new Error("BLOCKED_RECEIPT:JIT_COMPILER_DIGEST_DRIFT");
    }
    const resolution = resolveSoleRunningSlice4FixtureObjective(request as Record<string, JsonValue>);
    if (
      resolution.objective_ref !== SLICE4_FIXTURE_OBJECTIVE_REF ||
      resolution.base_sha !== SLICE4_FIXTURE_BASE_SHA
    ) {
      throw new Error("BLOCKED_RECEIPT:JIT_TARGET_DRIFT");
    }
    return {
      schema_version: "slice3b-confirmation-revalidation/v0.1",
      local_objective_ref: "fixture.invalid/ados-local#11",
      local_objective_digest: hashCanonical(local.objective as JsonValue),
      target_objective_ref: SLICE4_FIXTURE_OBJECTIVE_REF,
      target_objective_digest: resolution.objective_digest,
      target_resolution_digest: resolution.resolution_digest,
      target_harness_digest: resolution.harness_digest,
      target_base_sha: SLICE4_FIXTURE_BASE_SHA,
      compiler_profile_digest: profile.profile_digest,
      compiler_capability_digest: profile.capability_digest,
    };
  }
}

export const SLICE4_REPAIR_SELECTED_CONTEXT_QUOTE =
  "This synthetic repair fixture requires a separate IMPLEMENT decision before any repair Run, candidate revision or evidence update.";
export const SLICE4_REPAIR_OWNER_DECISION = "Approve IMPLEMENT for this synthetic fixture only; do not merge, release or deploy.";

const localRevision1 = "6bfbb7b8b74bad18144c97d439260a98e11384f3" as const;
const fixtureRevision1 = "710bd4c9e1ba5912219ba401e205e9cec91268d4" as const;
const localBranch = "fixture/public-local-safety-v1" as const;
const fixtureBranch = "fixture/public-target-safety-v1" as const;
const evidenceComment = "fixture.invalid/ados-fixture-delivery#6:issuecomment-1000001" as const;
const centralPlanRef =
  `fixture.invalid/control@${SLICE4_CENTRAL_SHA}#docs/ados-personal/implementation/SLICE4_REPAIR_AMENDMENT_PLAN_V0.1.md`;

interface PullRequestReadback {
  readonly number: number;
  readonly url: string;
  readonly state: string;
  readonly isDraft: boolean;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly headRefOid: string;
}

function forgeEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    "APPDATA", "COMSPEC", "GH_CONFIG_DIR", "GH_ENTERPRISE_TOKEN", "GH_HOST", "GH_TOKEN",
    "GITHUB_TOKEN", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "OS", "PATH", "PATHEXT",
    "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "SYSTEMDRIVE", "SYSTEMROOT",
    "TEMP", "TMP", "USERPROFILE", "WINDIR",
  ]);
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) =>
    allowed.has(name.toUpperCase()) && value !== undefined));
}

function readForgeJson(args: readonly string[]): Record<string, unknown> {
  const child = spawnSync("gh", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: forgeEnvironment(),
    shell: false,
    timeout: 120_000,
    windowsHide: true,
  });
  if (child.error !== undefined || child.status !== 0) {
    throw new Error("BLOCKED_INTAKE:SLICE4_TARGET_READBACK");
  }
  try {
    return JSON.parse(child.stdout) as Record<string, unknown>;
  } catch {
    throw new Error("BLOCKED_INTAKE:SLICE4_TARGET_READBACK");
  }
}

function exactPullRequest(
  repository: string,
  number: 6 | 12,
  branch: string,
  head: string,
): PullRequestReadback {
  const value = readForgeJson([
    "pr", "view", String(number), "--repo", repository,
    "--json", "number,url,state,isDraft,baseRefName,headRefName,headRefOid",
  ]);
  if (
    value.number !== number ||
    value.url !== `https://github.com/${repository}/pull/${number}` ||
    value.state !== "OPEN" ||
    value.isDraft !== true ||
    value.baseRefName !== "main" ||
    value.headRefName !== branch ||
    value.headRefOid !== head
  ) {
    throw new Error("BLOCKED_INTAKE:SLICE4_PR_IDENTITY_DRIFT");
  }
  return value as unknown as PullRequestReadback;
}

function assertEvidenceIdentity(): void {
  const value = readForgeJson([
    "api", "repos/fixture.invalid/ados-fixture-delivery/issues/comments/1000001",
  ]);
  if (
    value.id !== 1000001 ||
    value.html_url !==
      "https://github.com/fixture.invalid/ados-fixture-delivery/pull/6#issuecomment-1000001" ||
    typeof value.body !== "string" ||
    !value.body.includes("<!-- ados-evidence:ados-fixture-delivery:run-public-slice4-safety-0001:1 -->")
  ) {
    throw new Error("BLOCKED_INTAKE:SLICE4_EVIDENCE_IDENTITY_DRIFT");
  }
}

export interface BoundSlice4RepairDelivery {
  readonly draft: DeliveryRequestDraft;
  readonly card_binding: NonNullable<DeliveryCard["repair_binding"]>;
}

export type Slice4RepairIdentityReadback = (
  request: JsonObject,
) => ConfirmationRevalidation;

function liveSlice4RepairIdentityReadback(request: JsonObject): ConfirmationRevalidation {
  exactPullRequest("fixture.invalid/ados-local", 12, localBranch, localRevision1);
  exactPullRequest("fixture.invalid/ados-fixture-delivery", 6, fixtureBranch, fixtureRevision1);
  assertEvidenceIdentity();
  return new Slice4ConfirmationRevalidator().revalidate(request);
}

export function bindSlice4RepairDelivery(
  pack: ConversationEvidencePack,
  candidate: AcceptedCompilerCandidate,
  draft: DeliveryRequestDraft,
  readback: Slice4RepairIdentityReadback = liveSlice4RepairIdentityReadback,
): BoundSlice4RepairDelivery {
  const selected = pack.selected_turn_ids.map((id) =>
    pack.turns.find((turn) => turn.turn_id === id));
  const assistant = selected[0];
  const owner = selected[1];
  if (
    selected.length !== 2 ||
    assistant === undefined ||
    owner === undefined ||
    assistant.role !== "assistant" ||
    owner.role !== "owner"
  ) {
    throw new Error("BLOCKED_INTAKE:SLICE4_SELECTED_WINDOW");
  }
  const assistantText = normalizeSourceText(assistant.text);
  const ownerText = normalizeSourceText(owner.text);
  const requiredContext = [
    SLICE4_REPAIR_SELECTED_CONTEXT_QUOTE,
    "ADOS Local Objective #11",
    "Fixture Objective #5",
    "ADOS Local PR #12",
    "Fixture PR #6",
    localRevision1,
    fixtureRevision1,
  ];
  if (
    ownerText !== SLICE4_REPAIR_OWNER_DECISION ||
    !new RegExp(`当前中央 main\\s*:\\s*${SLICE4_CENTRAL_SHA}`, "u").test(assistantText) ||
    requiredContext.some((value) => !assistantText.includes(value)) ||
    candidate.requested_authorization !== "IMPLEMENT" ||
    candidate.readiness !== "READY" ||
    candidate.owner_decisions.length !== 1 ||
    candidate.owner_decisions[0]?.decision !== ownerText ||
    candidate.owner_decisions[0]?.source_turn_id !== owner.turn_id
  ) {
    throw new Error("BLOCKED_INTAKE:SLICE4_REPAIR_AUTHORITY_GROUNDING");
  }

  const revalidation = readback(draft.request);
  const authorizedEffects = [
    "After local_extension_confirm Receipt, immutable Activation and exact binding: create one new repair Run and reuse one persistent Codex session.",
    "Use safety.fixture-dogfood-gate@0.1.1 with authenticated cancel_run and the production N2/N4 admission guards.",
    "Create one tree-identical fixture revision 2 on the existing branch and update only existing Draft PR #6.",
    "Create one superseding ADOS Local commit on the existing branch and update only existing Draft PR #12.",
    "Update Evidence comment 1000001 in place, derive READY|BLOCKED from evidence, then return Objectives #11/#5 to OWNER_REVIEW.",
  ];
  const forbiddenEffects = [
    "No new Objective, branch, PR or Evidence identity; no force-push.",
    "No Ready, Merge, Release, Deploy, Slice 5, real product repository or architecture expansion.",
  ];
  const request = structuredClone(draft.request);
  request.outcome =
    "Execute the accepted Slice 4 Repair Amendment through the exact existing Objectives, Draft PRs, revision-1 lineage and Evidence identity.";
  request.why_now = SLICE4_REPAIR_SELECTED_CONTEXT_QUOTE;
  request.owner_decisions = candidate.owner_decisions.map((item) => item.decision);
  request.assumptions = [];
  request.open_decisions = [];
  request.requested_authorization = "IMPLEMENT";
  request.readiness = "READY";
  request.target_hint = {
    delivery_class: "software_delivery",
    project_id: "ados-fixture-delivery",
    repository: "fixture.invalid/ados-fixture-delivery",
  };
  request.allowed_scope_hints = [
    "Objectives: fixture.invalid/ados-local#11 and fixture.invalid/ados-fixture-delivery#5.",
    "Draft PRs: fixture.invalid/ados-local#12 and fixture.invalid/ados-fixture-delivery#6 on their existing branches.",
    `Retain revision 1 as REJECTED_CAUSAL_EVIDENCE_GAP: ADOS Local ${localRevision1}; fixture ${fixtureRevision1}.`,
    `Retain and update only Evidence comment ${evidenceComment}.`,
    ...authorizedEffects,
  ];
  request.forbidden_scope_hints = forbiddenEffects;
  request.quality_bar = [
    "No protected effect occurs before the authenticated Receipt, immutable Activation and exact Activation-to-repair-Run binding.",
    "Every Objective, Harness, base, branch, PR, revision and Evidence identity must read back exactly before mutation.",
  ];
  request.acceptance = {
    engineering: [
      "The confirmed Request creates one authenticated Receipt, one immutable Activation and one exact repair binding before one repair Run.",
      "The fixture revision 2 is tree-identical to revision 1 and all publication identities remain the existing Draft PRs and Evidence comment.",
    ],
    product: [
      "The evidence-derived Safety Card is exactly READY_FOR_ONE_REAL_DOGFOOD or BLOCKED with one exact blocker.",
    ],
    owner_artifact: {
      kind: "delivery_card",
      description: "Trusted Side Panel Card showing the exact approved Slice 4 Repair contract and existing identities before confirmation.",
    },
  };
  request.risk_flags = ["multi_repository", "sensitive_data"];
  request.request_digest = `sha256:${"0".repeat(64)}`;
  const requestDigest = computeDeliveryRequestDigest(request);
  request.request_digest = requestDigest;
  return {
    draft: {
      request,
      request_id: draft.request_id,
      request_digest: requestDigest,
    },
    card_binding: {
      selected_context: {
        authority: "NON_AUTHORITATIVE_SELECTED_ASSISTANT_CONTEXT",
        source_turn_id: assistant.turn_id,
        source_quote: SLICE4_REPAIR_SELECTED_CONTEXT_QUOTE,
      },
      central_plan_ref: centralPlanRef,
      local: {
        objective_ref: "fixture.invalid/ados-local#11",
        objective_digest: revalidation.local_objective_digest,
        draft_pr: "fixture.invalid/ados-local#12",
        branch: localBranch,
        revision_1_sha: localRevision1,
      },
      fixture: {
        objective_ref: "fixture.invalid/ados-fixture-delivery#5",
        objective_digest: revalidation.target_objective_digest,
        resolution_digest: revalidation.target_resolution_digest,
        draft_pr: "fixture.invalid/ados-fixture-delivery#6",
        branch: fixtureBranch,
        revision_1_sha: fixtureRevision1,
      },
      evidence_comment: evidenceComment,
      retained_lineage: "REJECTED_CAUSAL_EVIDENCE_GAP",
      execution_profile: "safety.fixture-dogfood-gate@0.1.1-public.1",
      authorized_effects: authorizedEffects,
      forbidden_effects: forbiddenEffects,
    },
  };
}

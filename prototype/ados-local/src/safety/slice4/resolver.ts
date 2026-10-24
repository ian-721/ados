import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { hashCanonical, sha256Text } from "../../canonical/index.js";
import { ContractValidator } from "../../contracts/validator.js";
import {
  readFixtureMainSha,
  readFixtureRepositoryFacts,
  readOpenFixtureObjectives,
} from "../../profiles/forge-profile.js";
import { runGit } from "../../profiles/workspace-profile.js";
import type { JsonValue } from "../../types.js";
import {
  SLICE4_CENTRAL_SHA,
  SLICE4_CONTRACT_SHA,
  SLICE4_FIXTURE_BASE_SHA,
} from "./profile.js";

export const SLICE4_RESOLVER_ID = "resolver.fixture-single-running-objective" as const;
export const SLICE4_RESOLVER_VERSION = "0.1.1-public.1" as const;
export const SLICE4_FIXTURE_REPOSITORY = "fixture.invalid/ados-fixture-delivery" as const;
export const SLICE4_FIXTURE_OBJECTIVE_REF = "fixture.invalid/ados-fixture-delivery#5" as const;
export const SLICE4_FIXTURE_HARNESS_REF =
  `${SLICE4_FIXTURE_REPOSITORY}@${SLICE4_FIXTURE_BASE_SHA}#docs/HARNESS.md` as const;

export interface Slice4FixtureResolution {
  readonly resolver_profile_id: typeof SLICE4_RESOLVER_ID;
  readonly resolver_profile_version: typeof SLICE4_RESOLVER_VERSION;
  readonly resolver_capability_digest: string;
  readonly resolution_digest: string;
  readonly repository_full_name: typeof SLICE4_FIXTURE_REPOSITORY;
  readonly repository_id: string;
  readonly objective_ref: typeof SLICE4_FIXTURE_OBJECTIVE_REF;
  readonly objective_url: string;
  readonly objective: Record<string, unknown>;
  readonly objective_digest: string;
  readonly project_harness_ref: typeof SLICE4_FIXTURE_HARNESS_REF;
  readonly harness_digest: string;
  readonly harness_text: string;
  readonly base_sha: typeof SLICE4_FIXTURE_BASE_SHA;
}

export function slice4FixtureRepositoryPath(): string {
  const configured = process.env.ADOS_SLICE4_FIXTURE_REPO;
  return configured === undefined || configured.length === 0
    ? resolve(dirname(resolve(process.cwd())), "ados-fixture-delivery")
    : resolve(configured);
}

export function slice4ResolverCapabilityDigest(): string {
  return hashCanonical({
    profile_id: SLICE4_RESOLVER_ID,
    profile_version: SLICE4_RESOLVER_VERSION,
    repository_allowlist: [SLICE4_FIXTURE_REPOSITORY],
    objective_issue: 5,
    objective_cardinality: 1,
    required_authorization: "IMPLEMENT",
    required_status: "RUNNING",
    objective_creation: false,
    objective_transition: false,
    owner_repository_selection: false,
  });
}

function assertTargetHint(request: Record<string, JsonValue>): void {
  const hint = request.target_hint;
  if (hint === null || hint === undefined || typeof hint !== "object" || Array.isArray(hint)) return;
  if (
    (typeof hint.project_id === "string" && hint.project_id.length > 0 && hint.project_id !== "ados-fixture-delivery") ||
    (typeof hint.repository === "string" && hint.repository.length > 0 && hint.repository !== SLICE4_FIXTURE_REPOSITORY)
  ) {
    throw new Error("BLOCKED_TARGET_REQUEST_CONFLICT");
  }
}

export function resolveSoleRunningSlice4FixtureObjective(
  request: Record<string, JsonValue>,
): Slice4FixtureResolution {
  if (request.requested_authorization !== "IMPLEMENT") throw new Error("BLOCKED_DISPATCH_AUTHORIZATION");
  assertTargetHint(request);
  const fixtureRoot = slice4FixtureRepositoryPath();
  const repository = readFixtureRepositoryFacts(fixtureRoot);
  const running = readOpenFixtureObjectives(fixtureRoot)
    .filter((item) => item.objective.status === "RUNNING");
  if (running.length === 0) throw new Error("BLOCKED_TARGET_NONE");
  if (running.length !== 1) throw new Error(`BLOCKED_TARGET_AMBIGUOUS:${running.length}`);
  const candidate = running[0];
  const sources = candidate?.objective.sources;
  const hasRepairPlanSource = Array.isArray(sources) && sources.some((source) =>
    source !== null && typeof source === "object" && !Array.isArray(source) &&
    (source as Record<string, unknown>).ref ===
      `fixture.invalid/control@${SLICE4_CENTRAL_SHA}#docs/ados-personal/implementation/SLICE4_REPAIR_AMENDMENT_PLAN_V0.1.md`);
  const validator = new ContractValidator();
  const validation = candidate === undefined
    ? { valid: false, errors: ["missing"] }
    : validator.validateSchema("objective-record", candidate.objective);
  if (
    candidate === undefined ||
    candidate.issue_ref !== SLICE4_FIXTURE_OBJECTIVE_REF ||
    !validation.valid ||
    candidate.objective.objective_id !== "fixture-dogfood-safety-v0.1" ||
    candidate.objective.project_id !== "ados-fixture-delivery" ||
    candidate.objective.authorization !== "IMPLEMENT" ||
    candidate.objective.status !== "RUNNING" ||
    candidate.objective.owner_approval_ref !==
      "synthetic://ados-public/v1/slice4-approval" ||
    !hasRepairPlanSource ||
    candidate.objective.contract_ref !==
      `ian-721/agentic-delivery-os@${SLICE4_CONTRACT_SHA}#contracts/OBJECTIVE_CONTRACT.md` ||
    candidate.objective.project_harness_ref !== SLICE4_FIXTURE_HARNESS_REF
  ) {
    throw new Error(`BLOCKED_TARGET_OBJECTIVE_INVALID:${validation.errors.join("|")}`);
  }
  const remoteMain = readFixtureMainSha(fixtureRoot);
  const originMain = runGit(fixtureRoot, ["rev-parse", "origin/main"]);
  const localMain = runGit(fixtureRoot, ["rev-parse", "main"]);
  if (
    remoteMain !== SLICE4_FIXTURE_BASE_SHA ||
    originMain !== SLICE4_FIXTURE_BASE_SHA ||
    localMain !== SLICE4_FIXTURE_BASE_SHA
  ) {
    throw new Error("BLOCKED_TARGET_BASE_DRIFT");
  }
  const harnessText = readFileSync(join(fixtureRoot, "docs", "HARNESS.md"), "utf8");
  const committedHarness = runGit(fixtureRoot, ["show", `${SLICE4_FIXTURE_BASE_SHA}:docs/HARNESS.md`]);
  if (harnessText.replace(/\r\n/gu, "\n").trimEnd() !== committedHarness.replace(/\r\n/gu, "\n").trimEnd()) {
    throw new Error("BLOCKED_TARGET_HARNESS_DRIFT");
  }
  const objectiveDigest = hashCanonical(candidate.objective as JsonValue);
  const harnessDigest = sha256Text(harnessText.replace(/\r\n/gu, "\n"));
  const resolution = {
    resolver_profile_id: SLICE4_RESOLVER_ID,
    resolver_profile_version: SLICE4_RESOLVER_VERSION,
    resolver_capability_digest: slice4ResolverCapabilityDigest(),
    repository_full_name: SLICE4_FIXTURE_REPOSITORY,
    repository_id: repository.id,
    objective_ref: SLICE4_FIXTURE_OBJECTIVE_REF,
    objective_digest: objectiveDigest,
    project_harness_ref: SLICE4_FIXTURE_HARNESS_REF,
    harness_digest: harnessDigest,
    base_sha: SLICE4_FIXTURE_BASE_SHA,
  } as const;
  return {
    ...resolution,
    resolution_digest: hashCanonical(resolution),
    objective_url: candidate.issue_url,
    objective: candidate.objective,
    harness_text: harnessText,
  };
}

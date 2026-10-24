import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hashCanonical, sha256Text } from "../canonical/index.js";
import { ContractValidator } from "../contracts/validator.js";
import {
  readFixtureMainSha,
  readFixtureRepositoryFacts,
  readOpenFixtureObjectives,
} from "../profiles/forge-profile.js";
import { runGit } from "../profiles/workspace-profile.js";
import type { JsonValue } from "../types.js";

export const FIXTURE_RESOLVER_ID = "resolver.fixture-single-running-objective" as const;
export const FIXTURE_RESOLVER_VERSION = "0.1.0-public.1" as const;
export const FIXTURE_REPOSITORY = "fixture.invalid/ados-fixture-delivery" as const;
export const FIXTURE_OBJECTIVE_REF = "fixture.invalid/ados-fixture-delivery#3" as const;
export const FIXTURE_BASE_SHA = "e75d162750acf4775a7a1ba1d1955ca9d60bc73f" as const;
export const FIXTURE_HARNESS_REF = `${FIXTURE_REPOSITORY}@${FIXTURE_BASE_SHA}#docs/HARNESS.md` as const;

const expectedContractRef = "ian-721/agentic-delivery-os@72f2d1ffbe86030d9f92a6629f4992111a7d6702#contracts/OBJECTIVE_CONTRACT.md";
const expectedOutcome = "Add one deterministic --owner-review CLI output exactly equal to `Order SO-1001 is ready for owner review: 3 items; total AUD 42.50.` while preserving the exact existing --machine and --owner-summary outputs, zero third-party dependencies and the frozen three-file scope.";

export interface FixtureResolution {
  readonly resolver_profile_id: typeof FIXTURE_RESOLVER_ID;
  readonly resolver_profile_version: typeof FIXTURE_RESOLVER_VERSION;
  readonly resolver_capability_digest: string;
  readonly resolution_digest: string;
  readonly repository_full_name: typeof FIXTURE_REPOSITORY;
  readonly repository_id: string;
  readonly objective_ref: typeof FIXTURE_OBJECTIVE_REF;
  readonly objective_url: string;
  readonly objective: Record<string, unknown>;
  readonly objective_digest: string;
  readonly project_harness_ref: typeof FIXTURE_HARNESS_REF;
  readonly harness_digest: string;
  readonly harness_text: string;
  readonly base_sha: typeof FIXTURE_BASE_SHA;
}

function fixtureRepositoryPath(): string {
  const configured = process.env.ADOS_SLICE3B_FIXTURE_REPO;
  return configured === undefined || configured.length === 0
    ? resolve(process.cwd(), "..", "ados-fixture-delivery")
    : resolve(configured);
}

function assertTargetHintCompatible(request: Record<string, JsonValue>): void {
  const hint = request.target_hint;
  if (hint === null || hint === undefined || typeof hint !== "object" || Array.isArray(hint)) {
    return;
  }
  const project = hint.project_id;
  const repository = hint.repository;
  if (
    (typeof project === "string" && project.length > 0 && project !== "ados-fixture-delivery") ||
    (typeof repository === "string" && repository.length > 0 && repository !== FIXTURE_REPOSITORY)
  ) {
    throw new Error("BLOCKED_TARGET_REQUEST_CONFLICT");
  }
}

export function fixtureResolverCapabilityDigest(): string {
  return hashCanonical({
    profile_id: FIXTURE_RESOLVER_ID,
    profile_version: FIXTURE_RESOLVER_VERSION,
    repository_allowlist: [FIXTURE_REPOSITORY],
    objective_cardinality: 1,
    objective_issue: 3,
    required_authorization: "IMPLEMENT",
    required_status: "RUNNING",
    objective_creation: false,
    objective_transition: false,
    owner_repository_selection: false,
  });
}

export function resolveSoleRunningFixtureObjective(
  request: Record<string, JsonValue>,
): FixtureResolution {
  if (request.requested_authorization !== "IMPLEMENT") {
    throw new Error("BLOCKED_DISPATCH_AUTHORIZATION");
  }
  assertTargetHintCompatible(request);
  const fixturePath = fixtureRepositoryPath();
  const repository = readFixtureRepositoryFacts(fixturePath);
  const candidates = readOpenFixtureObjectives(fixturePath);
  if (candidates.length === 0) {
    throw new Error("BLOCKED_TARGET_NONE");
  }
  if (candidates.length !== 1) {
    throw new Error(`BLOCKED_TARGET_AMBIGUOUS:${candidates.length}`);
  }
  const candidate = candidates[0];
  if (candidate === undefined || candidate.issue_ref !== FIXTURE_OBJECTIVE_REF) {
    throw new Error("BLOCKED_TARGET_OBJECTIVE_INVALID");
  }
  const validator = new ContractValidator();
  const validation = validator.validateSchema("objective-record", candidate.objective);
  if (!validation.valid) {
    throw new Error(`BLOCKED_TARGET_OBJECTIVE_INVALID:${validation.errors.join("|")}`);
  }
  if (candidate.objective.authorization !== "IMPLEMENT" || candidate.objective.status !== "RUNNING") {
    throw new Error("BLOCKED_TARGET_NOT_RUNNING");
  }
  if (
    candidate.objective.objective_id !== "fixture-owner-review-v0.1" ||
    candidate.objective.project_id !== "ados-fixture-delivery" ||
    candidate.objective.contract_ref !== expectedContractRef ||
    candidate.objective.project_harness_ref !== FIXTURE_HARNESS_REF ||
    candidate.objective.outcome !== expectedOutcome
  ) {
    throw new Error("BLOCKED_TARGET_OBJECTIVE_INVALID");
  }
  const remoteMain = readFixtureMainSha(fixturePath);
  const localOriginMain = runGit(fixturePath, ["rev-parse", "origin/main"]);
  const localMain = runGit(fixturePath, ["rev-parse", "main"]);
  if (remoteMain !== FIXTURE_BASE_SHA || localOriginMain !== FIXTURE_BASE_SHA || localMain !== FIXTURE_BASE_SHA) {
    throw new Error("BLOCKED_TARGET_BASE_DRIFT");
  }
  const harnessPath = join(fixturePath, "docs", "HARNESS.md");
  const harnessText = readFileSync(harnessPath, "utf8");
  const committedHarness = runGit(fixturePath, ["show", `${FIXTURE_BASE_SHA}:docs/HARNESS.md`]);
  if (harnessText.replace(/\r\n/g, "\n").trimEnd() !== committedHarness.replace(/\r\n/g, "\n").trimEnd()) {
    throw new Error("BLOCKED_TARGET_HARNESS_DRIFT");
  }
  const harnessDigest = sha256Text(harnessText.replace(/\r\n/g, "\n"));
  const objectiveDigest = hashCanonical(candidate.objective as JsonValue);
  const resolverCapabilityDigest = fixtureResolverCapabilityDigest();
  const resolution = {
    resolver_profile_id: FIXTURE_RESOLVER_ID,
    resolver_profile_version: FIXTURE_RESOLVER_VERSION,
    resolver_capability_digest: resolverCapabilityDigest,
    repository_full_name: repository.full_name,
    repository_id: repository.id,
    objective_ref: candidate.issue_ref,
    objective_digest: objectiveDigest,
    project_harness_ref: FIXTURE_HARNESS_REF,
    harness_digest: harnessDigest,
    base_sha: FIXTURE_BASE_SHA,
  };
  return {
    ...resolution,
    resolution_digest: hashCanonical(resolution),
    objective_url: candidate.issue_url,
    objective: candidate.objective,
    harness_text: harnessText,
  };
}

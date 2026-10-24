import { hashCanonical } from "../../canonical/index.js";
import type { JsonValue } from "../../types.js";

export const SLICE4_PROFILE_ID = "safety.fixture-dogfood-gate";
export const SLICE4_PROFILE_VERSION = "0.1.0-public.1";
export const SLICE4_CAPABILITY_DIGEST = "sha256:1be6e8e84e11bc6415e1b819b4b69f7f05c97d4a6f4b52e552c28352cd25f4a4";
export const SLICE4_CENTRAL_SHA = "3f5801451f991226704f7b141ddbd6fbcb7e31ac";
export const SLICE4_CONTRACT_SHA = "39ca6bdaff6e6609bfbae99db18384bcb7ff4d2a";
export const SLICE4_LOCAL_BASE_SHA = "6c7c5c32832eadc8dd9261d9fc637fb15ee0e1a1";
export const SLICE4_FIXTURE_BASE_SHA = "4e772e775cbc843420c8580fcff8a85c92754bdd";
export const SLICE4_LOCAL_HARNESS_BLOB = "6538508ebeaa2d0888353393cc5a191bdadfc5cb";
export const SLICE4_FIXTURE_HARNESS_BLOB = "8633374fa4563be68c46fdde5e0fffbe2a977a86";
export const SLICE4_REPAIR_PROFILE_VERSION = "0.1.1-public.1" as const;

export const slice4Cases = Object.freeze([
  { id: "P1", outcome: "one positive Run survives the fixed interruption sequence with one candidate identity" },
  { id: "P2", outcome: "duplicate resume creates zero new protected identity" },
  { id: "N1", outcome: "authenticated cancellation is terminal and prevents later uncommitted effect" },
  { id: "N2", outcome: "execution-surface identity drift fails before effect" },
  { id: "N3", outcome: "authority or immutable delivery identity drift fails before effect" },
  { id: "N4", outcome: "Objective, Harness or base drift fails before effect" },
  { id: "N5", outcome: "scope or dependency drift fails before publication" },
] as const);

export const slice4P1Sequence = Object.freeze([
  "AFTER_CANDIDATE_DURABLE_BEFORE_VERIFY",
  "GITHUB_UNAVAILABLE_BEFORE_PUSH",
  "AFTER_PUSH_ACK_LOST",
  "AFTER_DRAFT_PR_ACK_LOST",
  "AFTER_EVIDENCE_ACK_LOST",
] as const);

export const slice4Profile = Object.freeze({
  profile_id: SLICE4_PROFILE_ID,
  profile_version: SLICE4_PROFILE_VERSION,
  capability_digest: SLICE4_CAPABILITY_DIGEST,
  cases: slice4Cases,
  p1_sequence: slice4P1Sequence,
  target: Object.freeze({
    repository: "fixture.invalid/ados-fixture-delivery",
    objective_ref: "fixture.invalid/ados-fixture-delivery#5",
    base_sha: SLICE4_FIXTURE_BASE_SHA,
    branch: "fixture/public-target-safety-v1",
    allowed_paths: Object.freeze(["README.md", "src/index.js", "test/summary.test.js"] as const),
    dependencies: 0,
  }),
  evidence: Object.freeze({
    redact: Object.freeze(["credentials", "raw_conversation", "database_contents", "local_paths", "hidden_reasoning"] as const),
    card_headline: "ADOS Dogfood Safety Gate: READY_FOR_ONE_REAL_DOGFOOD.",
    stop_state: "OWNER_REVIEW",
  }),
});

export function assertFrozenSlice4Profile(): void {
  if (
    slice4Profile.profile_id !== SLICE4_PROFILE_ID ||
    slice4Profile.profile_version !== SLICE4_PROFILE_VERSION ||
    slice4Profile.capability_digest !== SLICE4_CAPABILITY_DIGEST ||
    slice4Profile.cases.map((row) => row.id).join(",") !== "P1,P2,N1,N2,N3,N4,N5" ||
    slice4Profile.p1_sequence.join(",") !== [
      "AFTER_CANDIDATE_DURABLE_BEFORE_VERIFY",
      "GITHUB_UNAVAILABLE_BEFORE_PUSH",
      "AFTER_PUSH_ACK_LOST",
      "AFTER_DRAFT_PR_ACK_LOST",
      "AFTER_EVIDENCE_ACK_LOST",
    ].join(",") ||
    slice4Profile.target.allowed_paths.join(",") !== "README.md,src/index.js,test/summary.test.js"
  ) {
    throw new Error("BLOCKED_SAFETY_PROFILE_DRIFT");
  }
}

export function slice4ProfileDefinitionDigest(): string {
  return hashCanonical({
    profile_id: slice4Profile.profile_id,
    profile_version: slice4Profile.profile_version,
    cases: slice4Profile.cases,
    p1_sequence: slice4Profile.p1_sequence,
    target: slice4Profile.target,
    evidence: slice4Profile.evidence,
  } as unknown as JsonValue);
}

export interface EvidenceSemanticError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

const authorizationRank = new Map([
  ["DISCOVERY", 0],
  ["PLAN", 1],
  ["IMPLEMENT", 2],
  ["MERGE", 3],
  ["RELEASE", 4],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, code: string, message: string): EvidenceSemanticError {
  return { path, code, message };
}

function artifactIsInsufficient(artifact: Record<string, unknown>): boolean {
  const text = `${String(artifact.location ?? "")} ${String(artifact.description ?? "")}`.toLowerCase();
  const tokens = new Set(text.match(/[a-z0-9]+/g) ?? []);
  const engineeringOnly = new Set([
    "all",
    "build",
    "checks",
    "check",
    "ci",
    "engineering",
    "green",
    "pass",
    "passed",
    "success",
    "successful",
    "test",
    "tests",
  ]);
  return tokens.size > 0 && [...tokens].every((token) => engineeringOnly.has(token));
}

function requiresCandidate(state: string): boolean {
  return ["VERIFIED", "DRAFT_OPEN", "MERGED", "RELEASED"].includes(state);
}

function requiresDraftIdentity(state: string): boolean {
  return ["DRAFT_OPEN", "MERGED", "RELEASED"].includes(state);
}

export function validateEvidenceSemantics(manifest: unknown): readonly EvidenceSemanticError[] {
  if (!isRecord(manifest)) {
    return [issue("$", "E_TYPE", "evidence manifest must be an object")];
  }
  const errors: EvidenceSemanticError[] = [];
  const artifact = manifest.owner_artifact;
  if (isRecord(artifact) && artifactIsInsufficient(artifact)) {
    errors.push(issue(
      "$.owner_artifact",
      "E_OWNER_ARTIFACT",
      "Owner artifact must be directly reviewable and cannot consist only of engineering checks passing",
    ));
  }

  const acceptanceStatus = manifest.product_acceptance_status;
  const acceptanceRef = manifest.owner_acceptance_ref;
  if (acceptanceStatus === "ACCEPTED" && !acceptanceRef) {
    errors.push(issue(
      "$.owner_acceptance_ref",
      "E_PRODUCT_ACCEPTANCE_MASQUERADE",
      "engineering evidence cannot declare product acceptance without an explicit Owner acceptance reference",
    ));
  } else if (acceptanceStatus === "REJECTED" && !acceptanceRef) {
    errors.push(issue(
      "$.owner_acceptance_ref",
      "E_OWNER_ACCEPTANCE_REQUIRED",
      "an Owner rejection status requires an explicit Owner decision reference",
    ));
  } else if (acceptanceStatus === "PENDING_OWNER" && acceptanceRef) {
    errors.push(issue(
      "$.owner_acceptance_ref",
      "E_PRODUCT_ACCEPTANCE_MASQUERADE",
      "PENDING_OWNER must not carry a product acceptance reference",
    ));
  }

  const changes = manifest.changes;
  const accounting = manifest.change_accounting;
  if (Array.isArray(changes) && isRecord(accounting)) {
    const measured = changes.reduce((total, change) =>
      total + (
        isRecord(change) &&
        typeof change.bytes_changed === "number" &&
        Number.isInteger(change.bytes_changed)
          ? change.bytes_changed
          : 0
      ), 0);
    if (accounting.method !== "staged_patch_bytes") {
      errors.push(issue(
        "$.change_accounting.method",
        "E_CHANGED_BYTE_ACCOUNTING",
        "changed bytes must be measured from the exact staged patch, not complete post-change file or blob size",
      ));
    }
    if (accounting.total_changed_bytes !== measured) {
      errors.push(issue(
        "$.change_accounting.total_changed_bytes",
        "E_CHANGED_BYTE_ACCOUNTING",
        `declared total does not equal the sum of per-change patch bytes (${measured})`,
      ));
    }
    if (
      typeof accounting.limit_bytes === "number" &&
      Number.isInteger(accounting.limit_bytes) &&
      measured > accounting.limit_bytes
    ) {
      errors.push(issue(
        "$.change_accounting.total_changed_bytes",
        "E_CHANGE_LIMIT_EXCEEDED",
        `exact staged patch bytes ${measured} exceed the approved limit ${String(accounting.limit_bytes)}`,
      ));
    }
  }

  const posture = manifest.execution_posture;
  if (isRecord(posture)) {
    const temporary = posture.temporary_activation;
    const postRunState = posture.post_run_state;
    const restorationRef = posture.restoration_evidence_ref;
    if (temporary === true && (postRunState !== "DISABLED" || !restorationRef)) {
      errors.push(issue(
        "$.execution_posture",
        "E_EXECUTION_POSTURE",
        "a temporary execution activation must finish in DISABLED state with restoration evidence",
      ));
    }
    if (temporary === false && postRunState === "ENABLED") {
      errors.push(issue(
        "$.execution_posture.post_run_state",
        "E_EXECUTION_POSTURE",
        "an evidence manifest cannot leave an unapproved execution surface enabled",
      ));
    }
    if (postRunState === "NOT_APPLICABLE" && restorationRef !== null) {
      errors.push(issue(
        "$.execution_posture.restoration_evidence_ref",
        "E_EXECUTION_POSTURE",
        "NOT_APPLICABLE must not carry restoration evidence",
      ));
    }
  }

  const publication = manifest.publication;
  if (!isRecord(publication)) {
    return errors;
  }
  if (publication.identity_key !== manifest.candidate_id) {
    errors.push(issue(
      "$.publication.identity_key",
      "E_CANDIDATE_IDENTITY",
      "publication identity must equal candidate_id so recovery reconciles one stable candidate",
    ));
  }
  for (const field of ["branch_refs", "candidate_refs", "pull_request_refs"] as const) {
    const refs = publication[field];
    if (Array.isArray(refs) && refs.length > 1) {
      errors.push(issue(
        `$.publication.${field}`,
        "E_DUPLICATE_CANDIDATE",
        "one objective candidate may reconcile at most one branch, candidate commit, and Draft PR identity",
      ));
    }
  }

  const state = typeof publication.state === "string" ? publication.state : "";
  const branchRefs = Array.isArray(publication.branch_refs) ? publication.branch_refs : [];
  const candidateRefs = Array.isArray(publication.candidate_refs) ? publication.candidate_refs : [];
  const pullRequestRefs = Array.isArray(publication.pull_request_refs) ? publication.pull_request_refs : [];
  if (state === "NOT_STARTED") {
    if (branchRefs.length > 0 || candidateRefs.length > 0 || pullRequestRefs.length > 0 || publication.state_writeback_ref) {
      errors.push(issue(
        "$.publication",
        "E_PUBLICATION_STATE",
        "NOT_STARTED cannot carry publication identities or a state writeback reference",
      ));
    }
  } else if (!publication.state_writeback_ref) {
    errors.push(issue(
      "$.publication.state_writeback_ref",
      "E_STATE_WRITEBACK_INCOMPLETE",
      "every started, blocked, verified, or published candidate must record its trusted state writeback",
    ));
  }
  if (requiresCandidate(state) && candidateRefs.length !== 1) {
    errors.push(issue(
      "$.publication.candidate_refs",
      "E_PUBLICATION_IDENTITY",
      `${state} requires exactly one verified candidate reference`,
    ));
  }
  if (requiresDraftIdentity(state)) {
    if (branchRefs.length !== 1) {
      errors.push(issue(
        "$.publication.branch_refs",
        "E_PUBLICATION_IDENTITY",
        `${state} requires exactly one deterministic branch reference`,
      ));
    }
    if (pullRequestRefs.length !== 1) {
      errors.push(issue(
        "$.publication.pull_request_refs",
        "E_PUBLICATION_IDENTITY",
        `${state} requires exactly one Draft PR reference`,
      ));
    }
  }

  const merged = publication.merged;
  const released = publication.released;
  const authRank = authorizationRank.get(String(manifest.authorization)) ?? -1;
  if (["MERGED", "RELEASED"].includes(state) && merged !== true) {
    errors.push(issue("$.publication.merged", "E_PUBLICATION_STATE", `${state} requires merged=true`));
  }
  if (state === "RELEASED" && released !== true) {
    errors.push(issue("$.publication.released", "E_PUBLICATION_STATE", "RELEASED requires released=true"));
  }
  if (released === true && merged !== true) {
    errors.push(issue("$.publication.released", "E_PUBLICATION_STATE", "release cannot precede merge"));
  }
  if (merged === true && !["MERGED", "RELEASED"].includes(state)) {
    errors.push(issue(
      "$.publication.state",
      "E_PUBLICATION_STATE",
      "merged=true requires MERGED or RELEASED state",
    ));
  }
  if (released === true && state !== "RELEASED") {
    errors.push(issue("$.publication.state", "E_PUBLICATION_STATE", "released=true requires RELEASED state"));
  }
  if (merged === true) {
    if (authRank < (authorizationRank.get("MERGE") ?? 3)) {
      errors.push(issue(
        "$.authorization",
        "E_AUTHORIZATION_BOUNDARY",
        "candidate was merged without MERGE authorization",
      ));
    }
    if (!publication.merge_approval_ref) {
      errors.push(issue(
        "$.publication.merge_approval_ref",
        "E_OWNER_APPROVAL_REQUIRED",
        "merged publication requires an explicit Owner merge approval reference",
      ));
    }
  }
  if (released === true) {
    if (authRank < (authorizationRank.get("RELEASE") ?? 4)) {
      errors.push(issue(
        "$.authorization",
        "E_AUTHORIZATION_BOUNDARY",
        "candidate was released without RELEASE authorization",
      ));
    }
    if (!publication.release_approval_ref) {
      errors.push(issue(
        "$.publication.release_approval_ref",
        "E_OWNER_APPROVAL_REQUIRED",
        "released publication requires an explicit Owner release approval reference",
      ));
    }
  }

  return errors.filter((value, index, all) =>
    all.findIndex((candidate) =>
      candidate.path === value.path && candidate.code === value.code && candidate.message === value.message) === index);
}

export function renderEvidenceSemanticErrors(errors: readonly EvidenceSemanticError[]): string {
  return errors.map((error) => `ERROR [${error.code}] ${error.path}: ${error.message}`).join("|");
}

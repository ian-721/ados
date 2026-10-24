import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { hashCanonical } from "../canonical/index.js";
import { inspectCandidate, inspectCandidateCommit, runGit } from "./workspace-profile.js";
import { slice2FixtureTask, type FixtureTaskSpecification } from "./fixture-task.js";

export interface RepositoryFacts {
  readonly id: string;
  readonly full_name: "fixture.invalid/ados-fixture-delivery";
  readonly default_branch: "main";
  readonly private: true;
}

export interface CommitResult {
  readonly disposition: "CREATED" | "REUSED";
  readonly candidate_sha: string;
}

export interface PushResult {
  readonly disposition: "PUSHED" | "REUSED";
  readonly candidate_sha: string;
  readonly remote_ref: string;
  readonly readback_digest: string;
}

export interface DraftPullRequest {
  readonly disposition: "CREATED" | "REUSED";
  readonly number: number;
  readonly url: string;
  readonly is_draft: true;
  readonly head_sha: string;
  readonly readback_digest: string;
}

export interface EvidencePublication {
  readonly disposition: "CREATED" | "UPDATED" | "REUSED";
  readonly comment_id: number;
  readonly url: string;
  readonly identity_key: string;
  readonly readback_digest: string;
}

export interface Slice4RepairEvidencePublication extends EvidencePublication {
  readonly body: string;
}

function evidenceCommentBody(
  candidateSha: string,
  evidenceDigest: string,
  identityKey: string,
  task: FixtureTaskSpecification,
): string {
  return [
    `<!-- ados-evidence:${identityKey} -->`,
    task.task_id === "fixture-owner-summary-v0.1"
      ? "## ADOS Slice 2 Candidate Evidence"
      : task.task_id === "fixture-owner-review-v0.1"
        ? "## ADOS Slice 3B Candidate Evidence"
        : "## ADOS Slice 4 Dogfood Safety Candidate Evidence",
    "",
    `- candidate: \`${candidateSha}\``,
    `- evidence digest: \`${evidenceDigest}\``,
    "- target checks: PASS",
    "- Evidence semantics: PASS (`staged_patch_bytes`; stable candidate identity)",
    "- product acceptance: PENDING_OWNER",
    "- merge/release/deploy: not authorized",
  ].join("\n");
}

export interface RunningObjective {
  readonly issue_ref: string;
  readonly issue_url: string;
  readonly objective: Record<string, unknown>;
}

interface GhPullRequest {
  readonly number: number;
  readonly isDraft: boolean;
  readonly headRefOid: string;
  readonly url: string;
  readonly state: string;
}

function forgeEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    "APPDATA",
    "COMSPEC",
    "GH_CONFIG_DIR",
    "GH_ENTERPRISE_TOKEN",
    "GH_HOST",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "OS",
    "PATH",
    "PATHEXT",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) =>
      allowed.has(name.toUpperCase()) && value !== undefined),
  );
}

function runForge(executable: string, args: readonly string[], cwd: string, timeout = 120_000): string {
  const child = spawnSync(executable, [...args], {
    cwd,
    encoding: "utf8",
    env: forgeEnvironment(),
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (child.error !== undefined) {
    throw new Error(`FORGE_PROCESS_ERROR:${basename(executable)}:${child.error.name}`);
  }
  if (child.status !== 0 || child.signal !== null) {
    const sanitized = child.stderr
      .replace(/(?:gh[oprsu]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, "<redacted-token>")
      .trim()
      .slice(0, 500);
    throw new Error(`FORGE_PROCESS_FAILED:${basename(executable)}:${child.status ?? "signal"}:${sanitized}`);
  }
  return child.stdout.trim();
}

function runForgeGit(cwd: string, args: readonly string[], timeout = 120_000): string {
  return runForge(
    "git",
    ["-c", `safe.directory=${cwd.replaceAll("\\", "/")}`, "-C", cwd, ...args],
    cwd,
    timeout,
  );
}

export function readFixtureRepositoryFacts(cwd: string): RepositoryFacts {
  const raw = runForge("gh", ["api", "repos/fixture.invalid/ados-fixture-delivery"], cwd);
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (
    String(value.full_name) !== "fixture.invalid/ados-fixture-delivery" ||
    String(value.default_branch) !== "main" ||
    value.private !== true ||
    !Number.isSafeInteger(value.id)
  ) {
    throw new Error("FORGE_REPOSITORY_IDENTITY_DRIFT");
  }
  return {
    id: String(value.id),
    full_name: "fixture.invalid/ados-fixture-delivery",
    default_branch: "main",
    private: true,
  };
}

export function readFixtureMainSha(cwd: string): string {
  const raw = runForge("gh", [
    "api",
    "repos/fixture.invalid/ados-fixture-delivery/commits/main",
    "--jq",
    ".sha",
  ], cwd);
  if (!/^[0-9a-f]{40}$/.test(raw)) {
    throw new Error("FORGE_FIXTURE_MAIN_SHA_INVALID");
  }
  return raw;
}

function parseObjectiveIssue(
  repository: "fixture.invalid/ados-local" | "fixture.invalid/ados-fixture-delivery",
  issueNumber: number,
  issue: Record<string, unknown>,
): RunningObjective {
  if (issue.state !== "OPEN" || typeof issue.body !== "string" || typeof issue.url !== "string") {
    throw new Error(`OBJECTIVE_ISSUE_STATE_INVALID:${repository}#${issueNumber}`);
  }
  const matches = [...issue.body.matchAll(/```ados-objective\s*\r?\n([\s\S]*?)\r?\n```/g)];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new Error(`OBJECTIVE_FENCE_COUNT:${repository}#${issueNumber}:${matches.length}`);
  }
  if (/<[A-Z][A-Z0-9_]*>/.test(matches[0][1])) {
    throw new Error(`OBJECTIVE_PLACEHOLDER_REMAINS:${repository}#${issueNumber}`);
  }
  const objective = JSON.parse(matches[0][1]) as Record<string, unknown>;
  return {
    issue_ref: `${repository}#${issueNumber}`,
    issue_url: issue.url,
    objective,
  };
}

export function readRunningObjective(
  cwd: string,
  repository: "fixture.invalid/ados-local" | "fixture.invalid/ados-fixture-delivery",
  issueNumber: number,
): RunningObjective {
  const raw = runForge("gh", [
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repository,
    "--json",
    "body,state,url",
  ], cwd);
  const issue = JSON.parse(raw) as Record<string, unknown>;
  const parsed = parseObjectiveIssue(repository, issueNumber, issue);
  const objective = parsed.objective;
  if (objective.authorization !== "IMPLEMENT" || objective.status !== "RUNNING") {
    throw new Error(`OBJECTIVE_NOT_RUNNING:${repository}#${issueNumber}`);
  }
  return parsed;
}

export function readOpenFixtureObjectives(cwd: string): readonly RunningObjective[] {
  const raw = runForge("gh", [
    "issue",
    "list",
    "--repo",
    "fixture.invalid/ados-fixture-delivery",
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,body,state,url",
  ], cwd);
  const issues = JSON.parse(raw) as Array<Record<string, unknown>>;
  return issues
    .filter((issue) => typeof issue.body === "string" && issue.body.includes("```ados-objective"))
    .map((issue) => {
      const issueNumber = Number(issue.number);
      if (!Number.isSafeInteger(issueNumber)) {
        throw new Error("OBJECTIVE_ISSUE_NUMBER_INVALID");
      }
      return parseObjectiveIssue("fixture.invalid/ados-fixture-delivery", issueNumber, issue);
    });
}

export function commitFixtureCandidate(
  worktreePath: string,
  baseSha: string,
  task: FixtureTaskSpecification = slice2FixtureTask,
): CommitResult {
  const branch = runGit(worktreePath, ["branch", "--show-current"]);
  if (branch !== task.target_branch || baseSha !== task.base_sha) {
    throw new Error("FORGE_COMMIT_BRANCH_DRIFT");
  }
  const head = runGit(worktreePath, ["rev-parse", "HEAD"]);
  const status = runGit(worktreePath, ["status", "--porcelain"]);
  if (head !== baseSha && status.length === 0) {
    return { disposition: "REUSED", candidate_sha: inspectCandidateCommit(worktreePath, baseSha) };
  }
  inspectCandidate(worktreePath, baseSha);
  runForgeGit(worktreePath, ["add", "--", "README.md", "src/index.js", "test/summary.test.js"]);
  const staged = runForgeGit(worktreePath, ["diff", "--cached", "--name-only"])
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  if (staged.join("\n") !== ["README.md", "src/index.js", "test/summary.test.js"].sort().join("\n")) {
    throw new Error(`FORGE_STAGED_SCOPE_DRIFT:${staged.join(",")}`);
  }
  runForgeGit(worktreePath, ["commit", "-m", task.commit_message]);
  const candidateSha = inspectCandidateCommit(worktreePath, baseSha);
  if (runGit(worktreePath, ["status", "--porcelain"]).length !== 0) {
    throw new Error("FORGE_COMMIT_LEFT_DIRTY_WORKTREE");
  }
  return { disposition: "CREATED", candidate_sha: candidateSha };
}

export function classifyPushReadback(remoteSha: string | null, candidateSha: string): "PUSH" | "REUSE" {
  if (remoteSha === null) {
    return "PUSH";
  }
  if (remoteSha === candidateSha) {
    return "REUSE";
  }
  throw new Error(`PUSH_REMOTE_DRIFT:${remoteSha}:${candidateSha}`);
}

function remoteBranchSha(worktreePath: string, branch: string): string | null {
  const raw = runForgeGit(worktreePath, ["ls-remote", "--heads", "origin", branch]);
  if (raw.length === 0) {
    return null;
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) {
    throw new Error("PUSH_REMOTE_BRANCH_MULTIPLE");
  }
  const sha = lines[0]?.split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("PUSH_REMOTE_READBACK_INVALID");
  }
  return sha;
}

export function pushFixtureCandidate(
  worktreePath: string,
  candidateSha: string,
  task: FixtureTaskSpecification = slice2FixtureTask,
): PushResult {
  const branch = task.target_branch;
  const before = classifyPushReadback(remoteBranchSha(worktreePath, branch), candidateSha);
  if (before === "PUSH") {
    runForgeGit(worktreePath, ["push", "-u", "origin", branch], 180_000);
  }
  const readback = remoteBranchSha(worktreePath, branch);
  if (readback !== candidateSha) {
    throw new Error(`PUSH_READBACK_MISMATCH:${readback ?? "missing"}:${candidateSha}`);
  }
  return {
    disposition: before === "PUSH" ? "PUSHED" : "REUSED",
    candidate_sha: candidateSha,
    remote_ref: `refs/heads/${branch}`,
    readback_digest: hashCanonical({ repository: "fixture.invalid/ados-fixture-delivery", branch, sha: readback }),
  };
}

export function selectExistingDraftPr(
  pullRequests: readonly GhPullRequest[],
  candidateSha: string,
): GhPullRequest | null {
  if (pullRequests.length === 0) {
    return null;
  }
  if (pullRequests.length !== 1) {
    throw new Error(`DRAFT_PR_COLLISION:${pullRequests.length}`);
  }
  const pullRequest = pullRequests[0];
  if (
    pullRequest === undefined ||
    pullRequest.state !== "OPEN" ||
    pullRequest.isDraft !== true ||
    pullRequest.headRefOid !== candidateSha
  ) {
    throw new Error("DRAFT_PR_READBACK_DRIFT");
  }
  return pullRequest;
}

function listTargetPullRequests(
  worktreePath: string,
  task: FixtureTaskSpecification = slice2FixtureTask,
): GhPullRequest[] {
  const raw = runForge("gh", [
    "pr",
    "list",
    "--repo",
    "fixture.invalid/ados-fixture-delivery",
    "--head",
    task.target_branch,
    "--state",
    "open",
    "--json",
    "number,isDraft,headRefOid,url,state",
  ], worktreePath);
  return JSON.parse(raw) as GhPullRequest[];
}

export function createOrReuseFixtureDraftPr(
  worktreePath: string,
  candidateSha: string,
  task: FixtureTaskSpecification = slice2FixtureTask,
): DraftPullRequest {
  let pullRequest = selectExistingDraftPr(listTargetPullRequests(worktreePath, task), candidateSha);
  let disposition: "CREATED" | "REUSED" = "REUSED";
  if (pullRequest === null) {
    runForge("gh", [
      "pr",
      "create",
      "--repo",
      "fixture.invalid/ados-fixture-delivery",
      "--base",
      "main",
      "--head",
      task.target_branch,
      "--draft",
      "--title",
      task.pull_request_title,
      "--body",
      task.pull_request_body,
    ], worktreePath, 180_000);
    disposition = "CREATED";
    pullRequest = selectExistingDraftPr(listTargetPullRequests(worktreePath, task), candidateSha);
  }
  if (pullRequest === null) {
    throw new Error("DRAFT_PR_READBACK_MISSING");
  }
  return {
    disposition,
    number: pullRequest.number,
    url: pullRequest.url,
    is_draft: true,
    head_sha: pullRequest.headRefOid,
    readback_digest: hashCanonical(pullRequest as unknown as Record<string, never>),
  };
}

export function readExistingFixtureDraftPr(
  worktreePath: string,
  candidateSha: string,
  task: FixtureTaskSpecification = slice2FixtureTask,
): DraftPullRequest {
  const pullRequest = selectExistingDraftPr(listTargetPullRequests(worktreePath, task), candidateSha);
  if (pullRequest === null) {
    throw new Error("DRAFT_PR_CORRECTION_READBACK_MISSING");
  }
  return {
    disposition: "REUSED",
    number: pullRequest.number,
    url: pullRequest.url,
    is_draft: true,
    head_sha: pullRequest.headRefOid,
    readback_digest: hashCanonical(pullRequest as unknown as Record<string, never>),
  };
}

export function readExistingAdosLocalRepairDraftPr(
  worktreePath: string,
  candidateSha: string,
): DraftPullRequest {
  if (runGit(worktreePath, ["branch", "--show-current"]) !== "fixture/public-local-safety-v1") {
    throw new Error("REPAIR_LOCAL_PR_BRANCH_DRIFT");
  }
  const pullRequest = JSON.parse(runForge("gh", [
    "pr", "view", "12", "--repo", "fixture.invalid/ados-local",
    "--json", "number,isDraft,headRefName,headRefOid,baseRefName,url,state",
  ], worktreePath)) as Record<string, unknown>;
  if (
    pullRequest.number !== 12 ||
    pullRequest.state !== "OPEN" ||
    pullRequest.isDraft !== true ||
    pullRequest.headRefName !== "fixture/public-local-safety-v1" ||
    pullRequest.headRefOid !== candidateSha ||
    pullRequest.baseRefName !== "main" ||
    pullRequest.url !== "https://github.com/fixture.invalid/ados-local/pull/12"
  ) {
    throw new Error("REPAIR_LOCAL_PR_READBACK_DRIFT");
  }
  return {
    disposition: "REUSED",
    number: 12,
    url: "https://github.com/fixture.invalid/ados-local/pull/12",
    is_draft: true,
    head_sha: candidateSha,
    readback_digest: hashCanonical(pullRequest as Record<string, never>),
  };
}

export function publishOrReuseEvidenceComment(
  worktreePath: string,
  pullRequestNumber: number,
  candidateSha: string,
  evidenceDigest: string,
  identityKey: string,
  task: FixtureTaskSpecification = slice2FixtureTask,
): EvidencePublication {
  const marker = `<!-- ados-evidence:${identityKey} -->`;
  const endpoint = `repos/fixture.invalid/ados-fixture-delivery/issues/${pullRequestNumber}/comments`;
  const existingRaw = runForge("gh", ["api", endpoint, "--paginate"], worktreePath);
  const existing = JSON.parse(existingRaw) as Array<Record<string, unknown>>;
  const matches = existing.filter((comment) => String(comment.body).includes(marker));
  if (matches.length > 1) {
    throw new Error(`EVIDENCE_COMMENT_COLLISION:${matches.length}`);
  }
  let record = matches[0];
  let disposition: "CREATED" | "REUSED" = "REUSED";
  if (record === undefined) {
    const body = evidenceCommentBody(candidateSha, evidenceDigest, identityKey, task);
    record = JSON.parse(runForge("gh", [
      "api",
      "--method",
      "POST",
      endpoint,
      "--raw-field",
      `body=${body}`,
    ], worktreePath)) as Record<string, unknown>;
    disposition = "CREATED";
  }
  const commentId = Number(record.id);
  if (!Number.isSafeInteger(commentId)) {
    throw new Error("EVIDENCE_COMMENT_ID_INVALID");
  }
  const readback = JSON.parse(runForge(
    "gh",
    ["api", `repos/fixture.invalid/ados-fixture-delivery/issues/comments/${commentId}`],
    worktreePath,
  )) as Record<string, unknown>;
  const body = String(readback.body);
  if (
    !body.includes(marker) ||
    !body.includes(candidateSha) ||
    !body.includes(evidenceDigest) ||
    !body.includes("PENDING_OWNER")
  ) {
    throw new Error("EVIDENCE_COMMENT_READBACK_DRIFT");
  }
  return {
    disposition,
    comment_id: commentId,
    url: String(readback.html_url),
    identity_key: identityKey,
    readback_digest: hashCanonical({
      id: commentId,
      url: String(readback.html_url),
      body_digest: hashCanonical({ body }),
    }),
  };
}

export function updateExistingEvidenceComment(
  worktreePath: string,
  pullRequestNumber: number,
  commentId: number,
  candidateSha: string,
  evidenceDigest: string,
  identityKey: string,
): EvidencePublication {
  if (!Number.isSafeInteger(commentId) || commentId !== 1000004) {
    throw new Error("EVIDENCE_CORRECTION_COMMENT_ID_DRIFT");
  }
  const marker = `<!-- ados-evidence:${identityKey} -->`;
  const endpoint = `repos/fixture.invalid/ados-fixture-delivery/issues/${pullRequestNumber}/comments`;
  const listed = JSON.parse(
    runForge("gh", ["api", endpoint, "--paginate"], worktreePath),
  ) as Array<Record<string, unknown>>;
  const matches = listed.filter((comment) => String(comment.body).includes(marker));
  if (matches.length !== 1 || Number(matches[0]?.id) !== commentId) {
    throw new Error(`EVIDENCE_CORRECTION_COMMENT_COLLISION:${matches.length}`);
  }
  const expectedBody = evidenceCommentBody(candidateSha, evidenceDigest, identityKey, slice2FixtureTask);
  let disposition: "UPDATED" | "REUSED" = "REUSED";
  if (String(matches[0]?.body) !== expectedBody) {
    runForge("gh", [
      "api",
      "--method",
      "PATCH",
      `repos/fixture.invalid/ados-fixture-delivery/issues/comments/${commentId}`,
      "--raw-field",
      `body=${expectedBody}`,
    ], worktreePath);
    disposition = "UPDATED";
  }
  const readback = JSON.parse(runForge(
    "gh",
    ["api", `repos/fixture.invalid/ados-fixture-delivery/issues/comments/${commentId}`],
    worktreePath,
  )) as Record<string, unknown>;
  const url = String(readback.html_url);
  const body = String(readback.body);
  if (
    Number(readback.id) !== commentId ||
    url !== `https://github.com/fixture.invalid/ados-fixture-delivery/pull/${pullRequestNumber}#issuecomment-${commentId}` ||
    body !== expectedBody
  ) {
    throw new Error("EVIDENCE_CORRECTION_COMMENT_READBACK_DRIFT");
  }
  return {
    disposition,
    comment_id: commentId,
    url,
    identity_key: identityKey,
    readback_digest: hashCanonical({
      id: commentId,
      url,
      body_digest: hashCanonical({ body }),
    }),
  };
}

export function createOrReuseSlice4CausalAttestationCommit(
  worktreePath: string,
  revision1Sha: string,
): CommitResult & { readonly parent_sha: string; readonly tree_sha: string } {
  const expectedBranch = "fixture/public-target-safety-v1";
  if (runGit(worktreePath, ["branch", "--show-current"]) !== expectedBranch) {
    throw new Error("REPAIR_COMMIT_BRANCH_DRIFT");
  }
  if (runGit(worktreePath, ["status", "--porcelain"]).length !== 0) {
    throw new Error("REPAIR_COMMIT_WORKTREE_DIRTY");
  }
  let head = runGit(worktreePath, ["rev-parse", "HEAD"]);
  let disposition: "CREATED" | "REUSED" = "REUSED";
  if (head === revision1Sha) {
    runForgeGit(worktreePath, [
      "commit", "--allow-empty", "-m", "chore: attest Slice 4 repair binding",
    ]);
    head = runGit(worktreePath, ["rev-parse", "HEAD"]);
    disposition = "CREATED";
  }
  const parent = runGit(worktreePath, ["rev-parse", `${head}^`]);
  const revision1Tree = runGit(worktreePath, ["rev-parse", `${revision1Sha}^{tree}`]);
  const revision2Tree = runGit(worktreePath, ["rev-parse", `${head}^{tree}`]);
  if (
    parent !== revision1Sha ||
    revision1Tree !== revision2Tree ||
    runGit(worktreePath, ["status", "--porcelain"]).length !== 0
  ) {
    throw new Error("REPAIR_CAUSAL_ATTESTATION_DRIFT");
  }
  return { disposition, candidate_sha: head, parent_sha: parent, tree_sha: revision2Tree };
}

export function pushExistingSlice4RepairCandidate(
  worktreePath: string,
  candidateSha: string,
  revision1Sha: string,
): PushResult {
  const branch = "fixture/public-target-safety-v1";
  const before = remoteBranchSha(worktreePath, branch);
  if (before !== revision1Sha && before !== candidateSha) {
    throw new Error(`PUSH_REMOTE_DRIFT:${before ?? "missing"}:${candidateSha}`);
  }
  if (before === revision1Sha) {
    runForgeGit(worktreePath, ["push", "origin", branch], 180_000);
  }
  const readback = remoteBranchSha(worktreePath, branch);
  if (readback !== candidateSha) throw new Error(`PUSH_READBACK_MISMATCH:${readback ?? "missing"}:${candidateSha}`);
  return {
    disposition: before === candidateSha ? "REUSED" : "PUSHED",
    candidate_sha: candidateSha,
    remote_ref: `refs/heads/${branch}`,
    readback_digest: hashCanonical({ repository: "fixture.invalid/ados-fixture-delivery", branch, sha: readback }),
  };
}

export function updateSlice4RepairEvidenceComment(
  worktreePath: string,
  candidateSha: string,
  body: string,
): Slice4RepairEvidencePublication {
  const commentId = 1000001;
  const identityKey = "ados-fixture-delivery:run-public-slice4-safety-0001:1";
  const marker = `<!-- ados-evidence:${identityKey} -->`;
  if (
    body.length > 16_000 ||
    body.split(marker).length !== 2 ||
    !body.includes(candidateSha) ||
    !body.includes("REJECTED_CAUSAL_EVIDENCE_GAP") ||
    !body.includes("PENDING_OWNER") ||
    /(?:[A-Z]:\\|gh[pousr]_[A-Za-z0-9]|Bearer\s+|Authorization:|USERPROFILE|hidden reasoning)/iu.test(body)
  ) {
    throw new Error("REPAIR_EVIDENCE_BODY_UNSAFE");
  }
  const endpoint = `repos/fixture.invalid/ados-fixture-delivery/issues/comments/${commentId}`;
  const prior = JSON.parse(runForge("gh", ["api", endpoint], worktreePath)) as Record<string, unknown>;
  if (Number(prior.id) !== commentId || !String(prior.body).includes(marker)) {
    throw new Error("REPAIR_EVIDENCE_IDENTITY_DRIFT");
  }
  let disposition: "UPDATED" | "REUSED" = "REUSED";
  if (String(prior.body) !== body) {
    runForge("gh", ["api", "--method", "PATCH", endpoint, "--raw-field", `body=${body}`], worktreePath);
    disposition = "UPDATED";
  }
  const readback = JSON.parse(runForge("gh", ["api", endpoint], worktreePath)) as Record<string, unknown>;
  const url = String(readback.html_url);
  if (
    Number(readback.id) !== commentId ||
    url !== `https://github.com/fixture.invalid/ados-fixture-delivery/pull/6#issuecomment-${commentId}` ||
    String(readback.body) !== body
  ) {
    throw new Error("REPAIR_EVIDENCE_READBACK_DRIFT");
  }
  return {
    disposition,
    comment_id: commentId,
    url,
    identity_key: identityKey,
    readback_digest: hashCanonical({ id: commentId, url, body_digest: hashCanonical({ body }) }),
    body,
  };
}

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { hashCanonical, sha256Text } from "../canonical/index.js";
import { ScopePolicy } from "../policy/index.js";
import type { FixtureTaskSpecification } from "./fixture-task.js";

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface WorktreeBinding {
  readonly disposition: "CREATED" | "REUSED";
  readonly repository_full_name: "fixture.invalid/ados-fixture-delivery";
  readonly base_sha: string;
  readonly branch_name: FixtureTaskSpecification["target_branch"];
  readonly worktree_path: string;
  readonly worktree_path_digest: string;
}

export interface CandidateInspection {
  readonly changed_paths: readonly string[];
  readonly changed_lines: number;
  readonly changed_bytes: number;
  readonly diff_digest: string;
}

export interface StagedPatchAccounting {
  readonly method: "staged_patch_bytes";
  readonly changes: ReadonlyArray<{
    readonly path: string;
    readonly bytes_changed: number;
  }>;
  readonly total_changed_bytes: number;
}

function boundedEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    "COMSPEC",
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
      allowed.has(name.toUpperCase()) &&
      !/(?:TOKEN|KEY|SECRET|AUTH|COOKIE|PASSWORD)/.test(name.toUpperCase()) &&
      value !== undefined),
  );
}

export function runProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  timeout = 120_000,
  environment = boundedEnvironment(),
): ProcessResult {
  const windowsCommand = process.platform === "win32" && executable.toLowerCase().endsWith(".cmd");
  const commandShell = environment.ComSpec ?? environment.COMSPEC;
  if (windowsCommand && (commandShell === undefined || commandShell.length === 0)) {
    throw new Error(`PROCESS_ERROR:${basename(executable)}:COMSPEC_MISSING`);
  }
  const child = spawnSync(
    windowsCommand ? commandShell! : executable,
    windowsCommand ? ["/d", "/s", "/c", executable, ...args] : [...args],
    {
    cwd,
    encoding: "utf8",
    env: environment,
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (child.error !== undefined) {
    throw new Error(`PROCESS_ERROR:${basename(executable)}:${child.error.name}`);
  }
  if (child.status !== 0 || child.signal !== null) {
    const stderr = child.stderr.trim().slice(0, 500);
    throw new Error(
      `PROCESS_FAILED:${basename(executable)}:${child.status ?? "signal"}:${stderr}`,
    );
  }
  return { stdout: child.stdout, stderr: child.stderr };
}

export function runGit(cwd: string, args: readonly string[], timeout = 120_000): string {
  return runProcess(
    "git",
    ["-c", `safe.directory=${cwd.replaceAll("\\", "/")}`, "-C", cwd, ...args],
    cwd,
    timeout,
  ).stdout.trim();
}

function currentBranch(worktreePath: string): string {
  return runGit(worktreePath, ["branch", "--show-current"]);
}

function currentHead(worktreePath: string): string {
  return runGit(worktreePath, ["rev-parse", "HEAD"]);
}

export function ensureIsolatedWorktree(
  sourceRepositoryPath: string,
  worktreePath: string,
  baseSha: string,
  branchName: FixtureTaskSpecification["target_branch"] = "ados/slice2-owner-summary-v0.1",
): WorktreeBinding {
  const source = resolve(sourceRepositoryPath);
  const worktree = resolve(worktreePath);
  if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    throw new Error("WORKTREE_BASE_SHA_INVALID");
  }
  const sourceRoot = resolve(runGit(source, ["rev-parse", "--show-toplevel"]));
  if (sourceRoot.toLowerCase() !== source.toLowerCase()) {
    throw new Error("WORKTREE_SOURCE_ROOT_DRIFT");
  }
  if (runGit(source, ["status", "--porcelain"]).length !== 0) {
    throw new Error("WORKTREE_SOURCE_DIRTY");
  }
  const originMain = runGit(source, ["rev-parse", "origin/main"]);
  if (originMain !== baseSha) {
    throw new Error(`WORKTREE_BASE_DRIFT:${originMain}:${baseSha}`);
  }

  let disposition: "CREATED" | "REUSED" = "REUSED";
  if (!existsSync(worktree)) {
    const branchExists = runGit(source, ["branch", "--list", branchName]);
    if (branchExists.length !== 0) {
      throw new Error("WORKTREE_BRANCH_EXISTS_WITHOUT_WORKTREE");
    }
    mkdirSync(dirname(worktree), { recursive: true });
    runGit(source, ["worktree", "add", worktree, "-b", branchName, baseSha]);
    disposition = "CREATED";
  }

  const worktreeRoot = resolve(runGit(worktree, ["rev-parse", "--show-toplevel"]));
  if (worktreeRoot.toLowerCase() !== worktree.toLowerCase()) {
    throw new Error("WORKTREE_ROOT_DRIFT");
  }
  if (currentBranch(worktree) !== branchName) {
    throw new Error("WORKTREE_BRANCH_DRIFT");
  }
  const ancestor = runProcess(
    "git",
    ["-c", `safe.directory=${worktree.replaceAll("\\", "/")}`, "-C", worktree, "merge-base", "--is-ancestor", baseSha, "HEAD"],
    worktree,
  );
  if (ancestor.stderr.trim().length !== 0) {
    throw new Error("WORKTREE_ANCESTRY_UNCERTAIN");
  }
  const listing = runGit(source, ["worktree", "list", "--porcelain"]);
  if (!listing.replaceAll("\\", "/").toLowerCase().includes(worktree.replaceAll("\\", "/").toLowerCase())) {
    throw new Error("WORKTREE_NOT_REGISTERED");
  }
  return {
    disposition,
    repository_full_name: "fixture.invalid/ados-fixture-delivery",
    base_sha: baseSha,
    branch_name: branchName,
    worktree_path: worktree,
    worktree_path_digest: sha256Text(worktree.toLowerCase()),
  };
}

export function verifyChangedPaths(paths: readonly string[]): readonly string[] {
  const policy = new ScopePolicy(
    ["README.md", "src/index.js", "test/summary.test.js"],
    ["package.json", "package-lock.json", "AGENTS.md", "docs/HARNESS.md", "fixtures/**"],
  );
  const normalized = [...new Set(paths)].sort();
  for (const path of normalized) {
    const decision = policy.evaluate(path);
    if (decision.effect !== "ALLOW") {
      throw new Error(`SCOPE_VIOLATION:${path}:${decision.reason}`);
    }
  }
  return normalized;
}

export function assertFrozenBase(observedSha: string, expectedSha: string): void {
  if (!/^[0-9a-f]{40}$/.test(observedSha) || !/^[0-9a-f]{40}$/.test(expectedSha)) {
    throw new Error("BASE_SHA_INVALID");
  }
  if (observedSha !== expectedSha) {
    throw new Error(`BASE_DRIFT_BLOCKED:${observedSha}:${expectedSha}`);
  }
}

function scanNestedGitDirectories(root: string, current = root): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name === ".git") {
      if (resolve(current).toLowerCase() !== resolve(root).toLowerCase()) {
        throw new Error(`NESTED_REPOSITORY_REJECTED:${relative(root, current)}`);
      }
      continue;
    }
    const path = resolve(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`SYMLINK_REJECTED:${relative(root, path)}`);
    }
    if (entry.isDirectory()) {
      scanNestedGitDirectories(root, path);
    }
  }
}

export function inspectCandidate(worktreePath: string, baseSha: string): CandidateInspection {
  const worktree = resolve(worktreePath);
  scanNestedGitDirectories(worktree);
  const changedPaths = verifyChangedPaths(
    runGit(worktree, ["diff", "--name-only", baseSha, "--"])
      .split(/\r?\n/)
      .filter(Boolean),
  );
  if (changedPaths.length === 0) {
    throw new Error("CANDIDATE_DIFF_EMPTY");
  }
  const raw = runGit(worktree, ["diff", "--raw", baseSha, "--"]);
  if (/(?:^|\s)160000(?:\s|$)/m.test(raw)) {
    throw new Error("SUBMODULE_CHANGE_REJECTED");
  }
  const summary = runGit(worktree, ["diff", "--summary", baseSha, "--"]);
  if (/mode change|create mode 120000|delete mode 120000/i.test(summary)) {
    throw new Error("MODE_OR_SYMLINK_CHANGE_REJECTED");
  }
  for (const path of changedPaths) {
    const absolute = resolve(worktree, path);
    if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
      throw new Error(`SYMLINK_REJECTED:${path}`);
    }
  }
  const numstat = runGit(worktree, ["diff", "--numstat", baseSha, "--"]);
  let changedLines = 0;
  for (const line of numstat.split(/\r?\n/).filter(Boolean)) {
    const [added, deleted] = line.split("\t");
    if (added === "-" || deleted === "-") {
      throw new Error("BINARY_CHANGE_REJECTED");
    }
    changedLines += Number(added) + Number(deleted);
  }
  const diff = runGit(worktree, ["diff", "--binary", baseSha, "--"]);
  const changedBytes = Buffer.byteLength(diff, "utf8");
  if (changedPaths.length > 3 || changedLines > 500 || changedBytes > 100_000) {
    throw new Error("CANDIDATE_CHANGE_LIMIT_EXCEEDED");
  }
  return {
    changed_paths: changedPaths,
    changed_lines: changedLines,
    changed_bytes: changedBytes,
    diff_digest: hashCanonical({ changed_paths: [...changedPaths], diff }),
  };
}

export function measureStagedPatchBytes(
  worktreePath: string,
  baseSha: string,
  candidateSha: string,
  paths: readonly string[],
): StagedPatchAccounting {
  if (!/^[0-9a-f]{40}$/.test(baseSha) || !/^[0-9a-f]{40}$/.test(candidateSha)) {
    throw new Error("STAGED_PATCH_SHA_INVALID");
  }
  const normalized = verifyChangedPaths(paths);
  const actual = verifyChangedPaths(
    runGit(worktreePath, ["diff", "--name-only", baseSha, candidateSha, "--"])
      .split(/\r?\n/)
      .filter(Boolean),
  );
  if (normalized.join("\n") !== actual.join("\n")) {
    throw new Error("STAGED_PATCH_SCOPE_DRIFT");
  }
  const gitArgs = (pathArguments: readonly string[]): readonly string[] => [
    "-c",
    `safe.directory=${resolve(worktreePath).replaceAll("\\", "/")}`,
    "-C",
    resolve(worktreePath),
    "diff",
    "--binary",
    baseSha,
    candidateSha,
    "--",
    ...pathArguments,
  ];
  const changes = normalized.map((path) => {
    const patch = runProcess("git", gitArgs([path]), worktreePath);
    if (patch.stderr.trim() !== "") {
      throw new Error(`STAGED_PATCH_STDERR:${path}`);
    }
    const bytesChanged = Buffer.byteLength(patch.stdout, "utf8");
    if (bytesChanged === 0) {
      throw new Error(`STAGED_PATCH_EMPTY:${path}`);
    }
    return { path, bytes_changed: bytesChanged };
  });
  const combined = runProcess("git", gitArgs(normalized), worktreePath);
  if (combined.stderr.trim() !== "") {
    throw new Error("STAGED_PATCH_COMBINED_STDERR");
  }
  const total = changes.reduce((sum, change) => sum + change.bytes_changed, 0);
  if (total !== Buffer.byteLength(combined.stdout, "utf8")) {
    throw new Error("STAGED_PATCH_SPLIT_ACCOUNTING_DRIFT");
  }
  return {
    method: "staged_patch_bytes",
    changes,
    total_changed_bytes: total,
  };
}

export function inspectCandidateCommit(worktreePath: string, baseSha: string): string {
  const head = currentHead(worktreePath);
  if (head === baseSha || !/^[0-9a-f]{40}$/.test(head)) {
    throw new Error("CANDIDATE_COMMIT_MISSING");
  }
  runGit(worktreePath, ["merge-base", "--is-ancestor", baseSha, head]);
  return head;
}

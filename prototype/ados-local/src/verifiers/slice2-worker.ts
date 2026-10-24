import { readFileSync } from "node:fs";
import { hashCanonical } from "../canonical/index.js";
import { inspectCandidate, runProcess } from "../profiles/workspace-profile.js";

interface Input {
  readonly worktree_path: string;
  readonly base_sha: string;
  readonly candidate_sha: string | null;
}

function parseInput(): Input {
  const text = readFileSync(0, "utf8");
  if (Buffer.byteLength(text, "utf8") > 16_384) {
    throw new Error("SLICE2_VERIFIER_INPUT_TOO_LARGE");
  }
  const value = JSON.parse(text) as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== "base_sha,candidate_sha,worktree_path" ||
    typeof value.worktree_path !== "string" ||
    !/^[0-9a-f]{40}$/.test(String(value.base_sha)) ||
    (value.candidate_sha !== null && !/^[0-9a-f]{40}$/.test(String(value.candidate_sha)))
  ) {
    throw new Error("SLICE2_VERIFIER_INPUT_INVALID");
  }
  return value as unknown as Input;
}

function checked(executable: string, args: readonly string[], cwd: string, timeout = 120_000): string {
  const result = runProcess(executable, args, cwd, timeout);
  if (result.stderr !== "") {
    throw new Error(`SLICE2_VERIFIER_STDERR:${executable}`);
  }
  return result.stdout;
}

const input = parseInput();
const inspection = inspectCandidate(input.worktree_path, input.base_sha);
const commandShell = process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe";
const testOutput = checked(commandShell, ["/d", "/s", "/c", "npm.cmd test"], input.worktree_path);
const checkOutput = checked(commandShell, ["/d", "/s", "/c", "npm.cmd run check"], input.worktree_path);
const machine = checked(
  process.execPath,
  ["src/index.js", "fixtures/order.json", "--machine"],
  input.worktree_path,
);
const owner = checked(
  process.execPath,
  ["src/index.js", "fixtures/order.json", "--owner-summary"],
  input.worktree_path,
);
const expectedMachine = '{"order_id":"SO-1001","currency":"AUD","item_count":3,"total":"42.50"}\n';
const expectedOwner = "Order SO-1001: 3 items; total AUD 42.50.\n";
if (machine !== expectedMachine) {
  throw new Error(`MACHINE_OUTPUT_DRIFT:${JSON.stringify(machine)}`);
}
if (owner !== expectedOwner) {
  throw new Error(`OWNER_SUMMARY_OUTPUT_DRIFT:${JSON.stringify(owner)}`);
}
const diffCheck = runProcess(
  "git",
  [
    "-c",
    `safe.directory=${input.worktree_path.replaceAll("\\", "/")}`,
    "-C",
    input.worktree_path,
    "diff",
    "--check",
    input.base_sha,
    "--",
  ],
  input.worktree_path,
);
const unexpectedDiffStderr = diffCheck.stderr
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((line) => !/^warning: in the working copy of '.+', LF will be replaced by CRLF the next time Git touches it$/.test(line));
if (unexpectedDiffStderr.length !== 0) {
  throw new Error(`SLICE2_DIFF_CHECK_STDERR:${unexpectedDiffStderr.join("|").slice(0, 500)}`);
}

const candidateDigest = hashCanonical({
  base_sha: input.base_sha,
  candidate_sha: input.candidate_sha,
  diff_digest: inspection.diff_digest,
  machine_output: machine.trimEnd(),
  owner_summary_output: owner.trimEnd(),
});
const result = {
  schema_version: "slice2-verifier-result/v0.1",
  status: "PASS",
  trust_level: "T2",
  candidate_sha: input.candidate_sha,
  candidate_digest: candidateDigest,
  changed_paths: inspection.changed_paths,
  changed_lines: inspection.changed_lines,
  changed_bytes: inspection.changed_bytes,
  diff_digest: inspection.diff_digest,
  checks: [
    { name: "fixture tests", command: "npm.cmd test", status: "PASS", output_digest: hashCanonical({ stdout: testOutput }) },
    { name: "fixture check", command: "npm.cmd run check", status: "PASS", output_digest: hashCanonical({ stdout: checkOutput }) },
    { name: "machine artifact", command: "node src/index.js fixtures/order.json --machine", status: "PASS", output_digest: hashCanonical({ stdout: machine }) },
    { name: "owner artifact", command: "node src/index.js fixtures/order.json --owner-summary", status: "PASS", output_digest: hashCanonical({ stdout: owner }) },
    { name: "diff whitespace", command: "git diff --check <base> --", status: "PASS", output_digest: hashCanonical({ stdout: "" }) },
  ],
  machine_output: machine.trimEnd(),
  owner_summary_output: owner.trimEnd(),
};
process.stdout.write(`${JSON.stringify(result)}\n`);

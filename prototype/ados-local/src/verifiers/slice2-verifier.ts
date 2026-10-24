import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface Slice2VerifierResult {
  readonly schema_version: "slice2-verifier-result/v0.1";
  readonly status: "PASS";
  readonly trust_level: "T2";
  readonly candidate_sha: string | null;
  readonly candidate_digest: string;
  readonly changed_paths: readonly ["README.md", "src/index.js", "test/summary.test.js"];
  readonly changed_lines: number;
  readonly changed_bytes: number;
  readonly diff_digest: string;
  readonly checks: ReadonlyArray<{
    readonly name: string;
    readonly command: string;
    readonly status: "PASS";
    readonly output_digest: string;
  }>;
  readonly machine_output: string;
  readonly owner_summary_output: string;
}

export function runSlice2Verifier(
  worktreePath: string,
  baseSha: string,
  candidateSha: string | null,
): Slice2VerifierResult {
  const worker = fileURLToPath(new URL("./slice2-worker.js", import.meta.url));
  const child = spawnSync(process.execPath, [worker], {
    input: JSON.stringify({
      worktree_path: worktreePath,
      base_sha: baseSha,
      candidate_sha: candidateSha,
    }),
    encoding: "utf8",
    env: {
      COMSPEC: process.env.COMSPEC,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      OS: process.env.OS,
      PATH: process.env.PATH,
      PATHEXT: process.env.PATHEXT,
      SYSTEMROOT: process.env.SYSTEMROOT,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      WINDIR: process.env.WINDIR,
    },
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (child.error !== undefined) {
    throw new Error(`SLICE2_VERIFIER_PROCESS_ERROR:${child.error.name}`);
  }
  if (child.status !== 0 || child.signal !== null || child.stderr.trim() !== "") {
    throw new Error(
      `SLICE2_VERIFIER_PROCESS_FAILED:${child.status ?? "signal"}:${child.stderr.trim().slice(0, 500)}`,
    );
  }
  const result = JSON.parse(child.stdout) as Slice2VerifierResult;
  if (
    result.schema_version !== "slice2-verifier-result/v0.1" ||
    result.status !== "PASS" ||
    result.trust_level !== "T2" ||
    result.candidate_sha !== candidateSha ||
    !/^sha256:[0-9a-f]{64}$/.test(result.candidate_digest) ||
    result.changed_paths.join(",") !== "README.md,src/index.js,test/summary.test.js" ||
    result.machine_output !== '{"order_id":"SO-1001","currency":"AUD","item_count":3,"total":"42.50"}' ||
    result.owner_summary_output !== "Order SO-1001: 3 items; total AUD 42.50." ||
    result.checks.length !== 5 ||
    result.checks.some((check) => check.status !== "PASS")
  ) {
    throw new Error("SLICE2_VERIFIER_RESULT_INVALID");
  }
  return result;
}

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { VerifierReceiptInput } from "../storage/event-store.js";

export interface T2VerifierInput {
  readonly obligation_id: string;
  readonly verifier_id: string;
  readonly candidate_digest: string;
}

function validateReceipt(value: unknown, input: T2VerifierInput): VerifierReceiptInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("VERIFIER_OUTPUT_INVALID");
  }
  const receipt = value as Record<string, unknown>;
  const expectedKeys = [
    "evidence_ref",
    "input_digest",
    "obligation_id",
    "result",
    "result_digest",
    "trust_level",
    "verifier_id",
    "verifier_receipt_id",
  ];
  if (Object.keys(receipt).sort().join(",") !== expectedKeys.join(",")) {
    throw new Error("VERIFIER_OUTPUT_KEYS_INVALID");
  }
  if (
    receipt.obligation_id !== input.obligation_id ||
    receipt.verifier_id !== input.verifier_id ||
    receipt.trust_level !== "T2" ||
    receipt.result !== "PASS" ||
    !/^sha256:[0-9a-f]{64}$/.test(String(receipt.input_digest)) ||
    !/^sha256:[0-9a-f]{64}$/.test(String(receipt.result_digest)) ||
    !String(receipt.evidence_ref).startsWith("fixture://verifier-process/")
  ) {
    throw new Error("VERIFIER_OUTPUT_SEMANTIC_INVALID");
  }
  return receipt as unknown as VerifierReceiptInput;
}

export function runT2Verifier(input: T2VerifierInput): VerifierReceiptInput {
  const workerPath = fileURLToPath(new URL("./fixture-worker.js", import.meta.url));
  const child = spawnSync(process.execPath, [workerPath], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { NODE_ENV: "production" },
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 65_536,
  });
  if (child.error !== undefined) {
    throw new Error(`VERIFIER_PROCESS_ERROR:${child.error.name}`);
  }
  if (child.status !== 0 || child.signal !== null || child.stderr.trim() !== "") {
    throw new Error(`VERIFIER_PROCESS_FAILED:${child.status ?? "signal"}`);
  }
  return validateReceipt(JSON.parse(child.stdout) as unknown, input);
}

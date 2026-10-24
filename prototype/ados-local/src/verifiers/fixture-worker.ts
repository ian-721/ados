import { readFileSync } from "node:fs";
import { hashCanonical } from "../canonical/index.js";

interface VerifierInput {
  readonly obligation_id: string;
  readonly verifier_id: string;
  readonly candidate_digest: string;
}

function parseInput(text: string): VerifierInput {
  if (Buffer.byteLength(text, "utf8") > 16_384) {
    throw new Error("VERIFIER_INPUT_TOO_LARGE");
  }
  const value = JSON.parse(text) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("VERIFIER_INPUT_INVALID");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "candidate_digest,obligation_id,verifier_id") {
    throw new Error("VERIFIER_INPUT_KEYS_INVALID");
  }
  for (const key of keys) {
    if (typeof record[key] !== "string" || String(record[key]).length === 0) {
      throw new Error(`VERIFIER_INPUT_FIELD_INVALID:${key}`);
    }
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(String(record.candidate_digest))) {
    throw new Error("VERIFIER_CANDIDATE_DIGEST_INVALID");
  }
  return record as unknown as VerifierInput;
}

const input = parseInput(readFileSync(0, "utf8"));
const inputDigest = hashCanonical({
  obligation_id: input.obligation_id,
  verifier_id: input.verifier_id,
  candidate_digest: input.candidate_digest,
});
const result = {
  verifier_receipt_id: `vr-${input.obligation_id}`,
  obligation_id: input.obligation_id,
  verifier_id: input.verifier_id,
  trust_level: "T2",
  result: "PASS",
  input_digest: inputDigest,
  result_digest: hashCanonical({
    obligation_id: input.obligation_id,
    verifier_id: input.verifier_id,
    candidate_digest: input.candidate_digest,
    result: "PASS",
    trust_level: "T2",
  }),
  evidence_ref: `fixture://verifier-process/${input.obligation_id}`,
};
process.stdout.write(`${JSON.stringify(result)}\n`);

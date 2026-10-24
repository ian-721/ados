import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonical } from "../src/canonical/index.js";
import { sanitizeAppServerText } from "../src/profiles/app-server-client.js";
import { runT2Verifier } from "../src/verifiers/process-verifier.js";

test("independent emitted verifier process returns a locally validated T2 receipt", () => {
  const receipt = runT2Verifier({
    obligation_id: "engineering-core",
    verifier_id: "verifier.core",
    candidate_digest: hashCanonical({ candidate: "test" }),
  });
  assert.equal(receipt.result, "PASS");
  assert.equal(receipt.trust_level, "T2");
  assert.equal(receipt.obligation_id, "engineering-core");
  assert.match(receipt.result_digest, /^sha256:[0-9a-f]{64}$/);
});

test("App Server evidence redaction removes Windows paths and token-like values", () => {
  const redacted = sanitizeAppServerText(
    "failure C:\\Private\\User\\secret.txt\nBearer synthetic-token\nsk-synthetic",
  );
  assert.doesNotMatch(redacted, /C:\\Private|synthetic-token|sk-synthetic/);
  assert.match(redacted, /<path>/);
  assert.match(redacted, /<redacted-token>/);
});

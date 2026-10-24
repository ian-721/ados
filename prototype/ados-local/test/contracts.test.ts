import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, hashCanonical } from "../src/canonical/index.js";
import { ContractValidator, computeDeliveryRequestDigest } from "../src/contracts/validator.js";
import {
  validDeliveryRequest,
  validEvidenceManifest,
  validObjective,
  validRunEnvelope,
} from "../src/contracts/fixture-data.js";
import type { JsonValue } from "../src/types.js";

test("complete contract fixtures pass schema and semantic validation without mutation", () => {
  const validator = new ContractValidator();
  const request = validDeliveryRequest();
  const objective = validObjective();
  const envelope = validRunEnvelope();
  const evidence = validEvidenceManifest();
  const before = canonicalJson(request);
  assert.deepEqual(validator.validateDeliveryRequest(request), {
    valid: true,
    errors: [],
    input_digest: hashCanonical(request),
  });
  assert.equal(validator.validateSchema("objective-record", objective).valid, true);
  assert.equal(validator.validateRunEnvelope(envelope).valid, true);
  assert.equal(validator.validateEvidenceBindings(evidence, objective, envelope).valid, true);
  assert.equal(canonicalJson(request), before);
});

test("Schema rejects added properties, open READY decisions, and missing receipts", () => {
  const validator = new ContractValidator();
  const extra = validDeliveryRequest() as Record<string, JsonValue>;
  extra.unapproved = true;
  assert.equal(validator.validateDeliveryRequest(extra).valid, false);

  const open = validDeliveryRequest() as Record<string, JsonValue>;
  open.open_decisions = ["Select a provider."];
  open.request_digest = computeDeliveryRequestDigest(open);
  const openReceipt = open.owner_authorization_receipt as Record<string, JsonValue>;
  openReceipt.request_digest = open.request_digest ?? "";
  assert.equal(validator.validateDeliveryRequest(open).valid, false);

  const missing = validDeliveryRequest() as Record<string, JsonValue>;
  delete missing.owner_authorization_receipt;
  assert.equal(validator.validateDeliveryRequest(missing).valid, false);
});

test("Owner receipt binds authorization, Owner turn, request digest, and mutation", () => {
  const validator = new ContractValidator();
  const fields = ["authorization", "owner_turn_digest", "request_digest"] as const;
  for (const field of fields) {
    const forged = validDeliveryRequest() as Record<string, JsonValue>;
    const receipt = forged.owner_authorization_receipt as Record<string, JsonValue>;
    receipt[field] = field === "authorization" ? "MERGE" : `sha256:${"f".repeat(64)}`;
    assert.equal(validator.validateDeliveryRequest(forged).valid, false, field);
  }

  const mutated = validDeliveryRequest() as Record<string, JsonValue>;
  mutated.outcome = "A materially changed synthetic outcome that invalidates the prior approval.";
  assert.equal(validator.validateDeliveryRequest(mutated).valid, false);
});

test("receipt replay against a different request is rejected", () => {
  const validator = new ContractValidator();
  const first = validDeliveryRequest();
  assert.equal(validator.validateDeliveryRequest(first, true).valid, true);
  const replay = validDeliveryRequest() as Record<string, JsonValue>;
  replay.request_id = "dr-walking-skeleton-0002";
  replay.request_digest = computeDeliveryRequestDigest(replay);
  const receipt = replay.owner_authorization_receipt as Record<string, JsonValue>;
  receipt.request_digest = replay.request_digest ?? "";
  assert.equal(validator.validateDeliveryRequest(replay, true).valid, false);
});

test("RFC 8785 is key-order invariant and rejects invalid I-JSON", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(hashCanonical({ b: 2, a: 1 }), hashCanonical({ a: 1, b: 2 }));
  assert.equal(
    canonicalJson({ z: [0.000001, 1e21, -0], a: "€" }),
    '{"a":"€","z":[0.000001,1e+21,0]}',
  );
  assert.throws(() => canonicalJson({ invalid: Number.NaN } as JsonValue), /I-JSON/);
  assert.throws(() => canonicalJson({ invalid: "\ud800" }), /I-JSON/);
});

test("Evidence cannot infer accepted product status without an Owner reference", () => {
  const validator = new ContractValidator();
  const evidence = validEvidenceManifest() as Record<string, unknown>;
  evidence.product_acceptance_status = "ACCEPTED";
  evidence.owner_acceptance_ref = null;
  assert.equal(
    validator.validateEvidenceBindings(evidence, validObjective(), validRunEnvelope()).valid,
    false,
  );
});

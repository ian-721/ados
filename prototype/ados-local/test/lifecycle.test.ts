import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonical } from "../src/canonical/index.js";
import { ScopePolicy } from "../src/policy/index.js";
import { runWalkingSkeleton } from "../src/coordinator/walking-skeleton.js";
import { createMinimalRun, isolatedStore } from "./helpers.js";

test("walking skeleton reaches OWNER_REVIEW with T0 separated from T2 and T4", () => {
  const fixture = isolatedStore("walking");
  try {
    const result = runWalkingSkeleton(fixture.store, false);
    assert.equal(result.final_state, "OWNER_REVIEW");
    assert.equal(result.fake_executor_trust, "T0");
    assert.equal(result.independent_verifier_trust, "T2");
    assert.equal(result.owner_acceptance_trust, "NOT_RUN");
    assert.equal(result.summary.obligations.find((item) => item.category === "owner")?.status, "PENDING");
  } finally {
    fixture.cleanup();
  }
});

test("only a T4 Owner verifier can close DONE", () => {
  const fixture = isolatedStore("owner-t4");
  try {
    const result = runWalkingSkeleton(fixture.store, true);
    assert.equal(result.state_before_owner_acceptance, "OWNER_REVIEW");
    assert.equal(result.final_state, "DONE");
    assert.equal(result.owner_acceptance_trust, "T4");
  } finally {
    fixture.cleanup();
  }
});

test("T0 claim cannot close a T2 obligation or false completion", () => {
  const fixture = isolatedStore("false-completion");
  try {
    const created = createMinimalRun(fixture.store);
    const runId = created.run.run_id;
    const holder = created.lease.holder_id;
    const token = created.lease.fencing_token;
    fixture.store.transition(runId, "PREPARED", "EXECUTING", holder, token, "to-executing");
    fixture.store.recordAgentClaim(runId, holder, token, "I am done", "agent-done");
    assert.throws(
      () => fixture.store.satisfyObligation(
        runId,
        holder,
        token,
        {
          verifier_receipt_id: "vr-agent-t0",
          obligation_id: "engineering-core",
          verifier_id: "verifier.core",
          trust_level: "T0",
          result: "PASS",
          input_digest: hashCanonical({ input: "t0" }),
          result_digest: hashCanonical({ result: "t0" }),
          evidence_ref: "fixture://agent/t0",
        },
        "agent-close",
      ),
      /OBLIGATION_TRUST_REJECTED/,
    );
    assert.throws(
      () => fixture.store.transition(runId, "EXECUTING", "DONE", holder, token, "false-done"),
      /INVALID_TRANSITION/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("invalid transition and stale fencing token are rejected", () => {
  const fixture = isolatedStore("invalid-transition");
  try {
    const created = createMinimalRun(fixture.store);
    assert.throws(
      () => fixture.store.transition(
        created.run.run_id,
        "PREPARED",
        "OWNER_REVIEW",
        created.lease.holder_id,
        created.lease.fencing_token,
        "invalid-transition",
      ),
      /INVALID_TRANSITION/,
    );
    assert.throws(
      () => fixture.store.heartbeat(
        created.run.run_id,
        created.lease.holder_id,
        created.lease.fencing_token + 1,
        300,
        "stale-heartbeat",
      ),
      /FENCING_REJECTED/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("CANCELLED is terminal and rejects later Agent mutation", () => {
  const fixture = isolatedStore("cancel");
  try {
    const created = createMinimalRun(fixture.store);
    const { run_id: runId } = created.run;
    const { holder_id: holder, fencing_token: token } = created.lease;
    fixture.store.transition(runId, "PREPARED", "CANCELLED", holder, token, "cancel");
    assert.throws(
      () => fixture.store.recordAgentClaim(runId, holder, token, "mutate", "post-cancel"),
      /FENCING_REJECTED|TERMINAL_RUN/,
    );
    assert.equal(fixture.store.getRun(runId).state, "CANCELLED");
  } finally {
    fixture.cleanup();
  }
});

test("scope policy is default-deny and blocks traversal", () => {
  const policy = new ScopePolicy(["src/**", "docs/OWNER_DEMO.md"], ["src/secrets/**"]);
  assert.equal(policy.evaluate("src/core.ts").effect, "ALLOW");
  assert.equal(policy.evaluate("src/secrets/token.txt").effect, "DENY");
  assert.equal(policy.evaluate("../outside.txt").reason, "PATH_ESCAPES_REPOSITORY");
  assert.equal(policy.evaluate("README.md").reason, "NOT_ALLOWLISTED");
});

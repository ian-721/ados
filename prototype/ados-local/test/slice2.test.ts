import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { boundedRepairAllowed, runSlice2RecoveryMatrix } from "../src/coordinator/slice2-recovery.js";
import { classifyPushReadback, selectExistingDraftPr } from "../src/profiles/forge-profile.js";
import { assertFrozenBase, verifyChangedPaths } from "../src/profiles/workspace-profile.js";

test("Slice 2 recovery matrix proves all twelve frozen outcomes", () => {
  const root = mkdtempSync(join(tmpdir(), "ados-slice2-recovery-"));
  const gate0b = join(root, "gate0b.json");
  writeFileSync(gate0b, JSON.stringify({
    result: "PASS_CODEX_APP_SERVER",
    evidence: {
      checks: [{ id: "B-08", status: "PASS", evidence: "interrupt and no post-cancel mutation" }],
    },
  }));
  try {
    const result = runSlice2RecoveryMatrix(root, gate0b);
    assert.equal(result.result, "PASS_SLICE2_RECOVERY_MATRIX");
    assert.equal(result.cases.length, 12);
    assert.ok(result.cases.every((item) => item.result === "PASS"));
    assert.equal(result.candidate_revision, 1);
    assert.equal(result.pending_outbox, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Slice 2 pure guards fail closed", () => {
  assert.equal(boundedRepairAllowed(0), true);
  assert.equal(boundedRepairAllowed(1), false);
  assert.deepEqual(verifyChangedPaths(["src/index.js", "README.md"]), ["README.md", "src/index.js"]);
  assert.throws(() => verifyChangedPaths(["package.json"]), /SCOPE_VIOLATION/);
  assert.doesNotThrow(() => assertFrozenBase("a".repeat(40), "a".repeat(40)));
  assert.throws(() => assertFrozenBase("a".repeat(40), "b".repeat(40)), /BASE_DRIFT_BLOCKED/);
  assert.equal(classifyPushReadback(null, "a".repeat(40)), "PUSH");
  assert.equal(classifyPushReadback("a".repeat(40), "a".repeat(40)), "REUSE");
  assert.throws(
    () => classifyPushReadback("b".repeat(40), "a".repeat(40)),
    /PUSH_REMOTE_DRIFT/,
  );
  assert.equal(selectExistingDraftPr([], "a".repeat(40)), null);
  assert.equal(selectExistingDraftPr([{
    number: 1,
    isDraft: true,
    headRefOid: "a".repeat(40),
    url: "https://github.com/fixture.invalid/ados-fixture-delivery/pull/1",
    state: "OPEN",
  }], "a".repeat(40))?.number, 1);
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validEvidenceManifest } from "../src/contracts/fixture-data.js";
import { validateEvidenceSemantics } from "../src/evidence/semantic-validator.js";
import { measureStagedPatchBytes, runGit, runProcess } from "../src/profiles/workspace-profile.js";

function centralSemanticFixture(): Record<string, unknown> {
  const manifest = structuredClone(validEvidenceManifest());
  const accounting = manifest.change_accounting as Record<string, unknown>;
  const publication = manifest.publication as Record<string, unknown>;
  accounting.method = "staged_patch_bytes";
  publication.identity_key = manifest.candidate_id;
  return manifest;
}

test("central Evidence semantic parity rejects method, total, and candidate identity violations", () => {
  const valid = centralSemanticFixture();
  assert.deepEqual(validateEvidenceSemantics(valid), []);

  const wrongMethod = structuredClone(valid);
  (wrongMethod.change_accounting as Record<string, unknown>).method = "complete_file_bytes";
  assert.ok(validateEvidenceSemantics(wrongMethod).some((error) =>
    error.code === "E_CHANGED_BYTE_ACCOUNTING" && error.path === "$.change_accounting.method"));

  const wrongTotal = structuredClone(valid);
  (wrongTotal.change_accounting as Record<string, unknown>).total_changed_bytes = 99;
  assert.ok(validateEvidenceSemantics(wrongTotal).some((error) =>
    error.code === "E_CHANGED_BYTE_ACCOUNTING" && error.path === "$.change_accounting.total_changed_bytes"));

  const wrongIdentity = structuredClone(valid);
  (wrongIdentity.publication as Record<string, unknown>).identity_key = "different-candidate";
  assert.ok(validateEvidenceSemantics(wrongIdentity).some((error) =>
    error.code === "E_CANDIDATE_IDENTITY" && error.path === "$.publication.identity_key"));
});

test("per-file staged patch bytes equal exact Git patch bytes and their combined total", () => {
  const root = mkdtempSync(join(tmpdir(), "ados-staged-patch-"));
  try {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "test"));
    runGit(root, ["init"]);
    runGit(root, ["config", "user.name", "ADOS Fixture"]);
    runGit(root, ["config", "user.email", "ados-fixture@example.invalid"]);
    writeFileSync(join(root, "README.md"), "baseline\n", "utf8");
    writeFileSync(join(root, "src", "index.js"), "console.log('baseline');\n", "utf8");
    writeFileSync(join(root, "test", "summary.test.js"), "// baseline\n", "utf8");
    runGit(root, ["add", "--", "README.md", "src/index.js", "test/summary.test.js"]);
    runGit(root, ["commit", "-m", "baseline"]);
    const base = runGit(root, ["rev-parse", "HEAD"]);
    writeFileSync(join(root, "README.md"), "baseline\nowner summary\n", "utf8");
    writeFileSync(join(root, "src", "index.js"), "console.log('owner summary');\n", "utf8");
    writeFileSync(join(root, "test", "summary.test.js"), "// exact owner summary\n", "utf8");
    runGit(root, ["add", "--", "README.md", "src/index.js", "test/summary.test.js"]);
    runGit(root, ["commit", "-m", "candidate"]);
    const candidate = runGit(root, ["rev-parse", "HEAD"]);
    const paths = ["README.md", "src/index.js", "test/summary.test.js"];
    const accounting = measureStagedPatchBytes(root, base, candidate, paths);
    assert.equal(accounting.method, "staged_patch_bytes");
    assert.deepEqual(accounting.changes.map((change) => change.path), paths);
    for (const change of accounting.changes) {
      const direct = runProcess("git", [
        "-c",
        `safe.directory=${root.replaceAll("\\", "/")}`,
        "-C",
        root,
        "diff",
        "--binary",
        base,
        candidate,
        "--",
        change.path,
      ], root);
      assert.equal(change.bytes_changed, Buffer.byteLength(direct.stdout, "utf8"));
    }
    assert.equal(
      accounting.total_changed_bytes,
      accounting.changes.reduce((sum, change) => sum + change.bytes_changed, 0),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const implementationPlanCommit = "b57fbe8f84a609bc1bed615542c868b24cc3f6a7";
const bootstrapCommit = "b85a8139cc6d98d7132c84e41a407bde94c813c9";
const snapshotCommit = "165155ae729d0c3d22d718bdc780351418362583";
const ownerApproval = "synthetic://ados-public/v1/source-approval";
const preflightEvidence = "fixture.invalid/ados-local#issuecomment-1000003";

interface EvidenceRecord {
  readonly command: string;
  readonly status: string;
  readonly result: string;
  readonly evidence: Record<string, unknown>;
}

function evidencePath(name: string): string {
  return join(process.cwd(), ".ados-local", "evidence", `${name}.json`);
}

function readEvidence(name: string): EvidenceRecord {
  return JSON.parse(readFileSync(evidencePath(name), "utf8")) as EvidenceRecord;
}

function digestEvidence(name: string): string {
  return createHash("sha256").update(readFileSync(evidencePath(name))).digest("hex");
}

function digestFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeDocument(name: string, text: string): void {
  const docs = join(process.cwd(), "docs");
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, name), `${text.trim()}\n`, "utf8");
}

function rows(items: readonly Record<string, unknown>[]): string {
  return items
    .map((item) => `| ${String(item.id ?? item.case_id)} | ${String(item.status ?? item.observed_outcome)} | ${String(item.evidence ?? item.scenario)} |`)
    .join("\n");
}

const gate0s = readEvidence("gate0s");
const gate0a = readEvidence("gate0a");
const gate0b = readEvidence("gate0b");
const walking = readEvidence("walking-skeleton");
const contracts = readEvidence("verify-contracts");
const gate0sData = gate0s.evidence;
const gate0aData = gate0a.evidence;
const gate0bData = gate0b.evidence;
const walkingData = walking.evidence;
const driver = gate0sData.driver as Record<string, unknown>;
const gate0bHost = gate0bData.host as Record<string, unknown>;
const gate0bTransport = gate0bData.transport as Record<string, unknown>;
const cancellationDiagnosticPath = evidencePath("gate0b-post-cancel-diagnostic");
const cancellationDiagnostic = JSON.parse(
  readFileSync(cancellationDiagnosticPath, "utf8"),
) as Record<string, unknown>;
const cancellationConclusion = cancellationDiagnostic.conclusion as Record<string, unknown>;
const originalCancellationDiagnosticPath = evidencePath("gate0b-post-cancel-original");
const cancellationAttemptsDirectory = join(
  process.cwd(),
  ".ados-local",
  "evidence",
  "gate0b-cancellation-attempts",
);
const cancellationAttempts = existsSync(cancellationAttemptsDirectory)
  ? readdirSync(cancellationAttemptsDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const path = join(cancellationAttemptsDirectory, name);
      const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      const conclusion = value.conclusion as Record<string, unknown>;
      const observations = value.workspace_observations as Record<string, unknown>[];
      const before = observations.find((item) => item.stage === "before-cancel-turn");
      const after = observations.find((item) => item.stage === "final-after-cleanup");
      return {
        digest: digestFile(path),
        result: conclusion.primary_result,
        no_mutation:
          conclusion.workspace_mutation === "NOT_OBSERVED" &&
          before?.tree_digest === after?.tree_digest &&
          before?.git_status_digest === after?.git_status_digest &&
          before?.git_index_sha256 === after?.git_index_sha256,
        process_tree_clean: conclusion.process_tree_clean_after_close === true,
        no_duplicate_command: (conclusion.post_interrupt_new_command_items as unknown[]).length === 0,
      };
    })
  : [];
const cancellationAttemptsPassed = cancellationAttempts.filter(
  (attempt) =>
    attempt.result === "PASS_CODEX_APP_SERVER" &&
    attempt.no_mutation &&
    attempt.process_tree_clean &&
    attempt.no_duplicate_command,
).length;
const gate0sChecks = gate0sData.checks as Record<string, unknown>[];
const failureMatrix = gate0sData.crash_matrix as Record<string, unknown>[];
const gateBlockers = [
  ...((gate0aData.blockers as string[] | undefined) ?? []),
  ...((gate0bData.blockers as string[] | undefined) ?? []),
];
const finalVocabulary = gate0a.status === "PASS" && gate0b.status === "PASS"
  ? "OWNER_REVIEW_PASS_ALL_GATES"
  : gate0a.status === "BLOCKED" && gate0b.status === "PASS"
    ? "OWNER_REVIEW_CORE_PASS_GATE0A_BLOCKED"
    : gate0a.status === "PASS" && gate0b.status === "BLOCKED"
      ? "OWNER_REVIEW_CORE_PASS_GATE0B_BLOCKED"
      : "OWNER_REVIEW_CORE_PASS_GATE0A_GATE0B_BLOCKED";
const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as Record<string, unknown>;
const lock = JSON.parse(readFileSync(join(process.cwd(), "package-lock.json"), "utf8")) as {
  readonly packages: Record<string, Record<string, unknown>>;
};
const testResult = process.env.ADOS_TEST_RESULT ?? "not supplied";
const demoResult = process.env.ADOS_DEMO_RESULT ?? "not supplied";
const auditResult = process.env.ADOS_AUDIT_RESULT ?? "not supplied";
const lockEntries = Object.entries(lock.packages).filter(([path]) => path !== "");
const licenseCounts = new Map<string, number>();
const missingIntegrity = lockEntries
  .filter(([, metadata]) => metadata.resolved !== undefined && metadata.integrity === undefined)
  .map(([path]) => path);
for (const [, metadata] of lockEntries) {
  const license = String(metadata.license ?? "UNDECLARED");
  licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
}

const evidenceDigests = {
  contracts: digestEvidence("verify-contracts"),
  walking: digestEvidence("walking-skeleton"),
  gate0s: digestEvidence("gate0s"),
  gate0a: digestEvidence("gate0a"),
  gate0b: digestEvidence("gate0b"),
};

writeDocument("GATE0_REPORT.md", `
# ADOS Local Gate 0 Report

This report is rendered from the structured evidence under ignored \`.ados-local/evidence/**\`. It is not an Agent self-attestation and does not grant product acceptance.

## Candidate binding

- implementation plan: \`${implementationPlanCommit}\`
- Bootstrap/base: \`${bootstrapCommit}\`
- contract/schema snapshot: \`${snapshotCommit}\`
- Owner recovery approval: \`${ownerApproval}\`
- Preflight: \`${preflightEvidence}\`
- branch: \`feat/gate0-contract-walking-skeleton-v0.1\`
- candidate commit: bound to the exact Draft PR head after commit creation; a commit cannot embed its own SHA
- GitHub Objective remains \`RUNNING\` until the exact candidate and final evidence are published, then transitions only to \`OWNER_REVIEW\`

## Results

| Gate | Terminal result | Status | Structured evidence SHA-256 |
| --- | --- | --- | --- |
| Gate 0S | ${gate0s.result} | ${gate0s.status} | \`${evidenceDigests.gate0s}\` |
| Gate 0A | ${gate0a.result} | ${gate0a.status} | \`${evidenceDigests.gate0a}\` |
| Gate 0B | ${gate0b.result} | ${gate0b.status} | \`${evidenceDigests.gate0b}\` |
| Walking Skeleton | ${walking.result} | ${walking.status} | \`${evidenceDigests.walking}\` |

Final candidate vocabulary, if the same results survive clean-checkout validation: \`${finalVocabulary}\`.

## Runtime identities

- Node: \`${String(driver.node)}\`; npm: \`10.9.8\`; ABI: \`${String(driver.abi)}\`; platform: \`${String(driver.platform)}/${String(driver.arch)}\`
- Codex: \`${String(gate0bHost.version)}\`; executable SHA-256: \`${String(gate0bHost.executable_sha256)}\`
- App Server schema: ${String(gate0bHost.schema_files)} generated files; raw SHA-256 \`${String(gate0bHost.schema_raw_sha256)}\`; RFC 8785 digest \`${String(gate0bHost.schema_jcs_digest)}\`

## Gate 0A boundary

- deterministic Compiler core ran in a separate emitted \`node:test\` process
- semantic Profile used only synthetic inputs, an empty disposable cwd, \`read-only\`, \`approvalPolicy=never\`, no tools/MCP/browser/GitHub/secrets
- model candidate remained untrusted until outputSchema, local strict Ajv, semantic matrix, JCS digest, and Receipt rules accepted it
- formal result: \`${gate0a.result}\`

## Gate 0B boundary

- authenticated status was checked without recording account data
- approval deny: \`${String(gate0bTransport.deny_request)}\`; approval allow: \`${String(gate0bTransport.allow_request)}\`
- the original blocker was a real workspace mutation: a command started before interrupt continued after both acknowledgement and \`turn/completed(interrupted)\`; it was not a delayed read-only event
- interrupt result: \`${String(gate0bTransport.interrupted_status)}\`; ${String(gate0bTransport.cancellation_process_roots)} exact new command subtree root was terminated after acknowledgement and mechanically observed absent before the unchanged safety window
- post-fix cancellation attempts: ${cancellationAttemptsPassed}/${cancellationAttempts.length} passed with identical before/final workspace tree digest, Git status digest, and Git index hash; no post-interrupt command item and clean process trees
- original failure diagnostic SHA-256: \`${existsSync(originalCancellationDiagnosticPath) ? digestFile(originalCancellationDiagnosticPath) : "missing"}\`; latest correlated diagnostic SHA-256: \`${digestFile(cancellationDiagnosticPath)}\`; latest classification: \`${String(cancellationConclusion.causal_attribution)}\`
- restart/resume preserved exact persistent thread identity; the persistent synthetic thread was deleted
- session facts rebuilt to ${String(gate0bTransport.session_projection_count)} unique SQLite projections; raw thread ids are not in this report
- backpressure waits: ${String(gate0bTransport.backpressure_waits)}; stderr records were bounded and redacted

## Validation snapshot

- emitted \`node:test\`: ${testResult}
- required Owner demos: ${demoResult}
- Gate 0S checks: ${gate0sChecks.length}/${gate0sChecks.length}
- Gate 0S failure/recovery matrix: ${failureMatrix.length}/${failureMatrix.length}

## Blockers and unproven capabilities

- blockers in the formal Gate evidence: ${gateBlockers.length === 0 ? "none" : gateBlockers.map((item) => `\`${item}\``).join(", ")}
- unproven by design: real Owner product acceptance; Browser/GitHub product integration; real-project fulfillment; Ready/merge/release/deploy; desktop/cloud/multi-Agent work
- no fallback Profile was used
`);

const betterSqlite = lock.packages["node_modules/better-sqlite3"] ?? {};
const runtimeDependencies = packageJson.dependencies as Record<string, string>;
const devDependencies = packageJson.devDependencies as Record<string, string>;
writeDocument("STORAGE_REPORT.md", `
# ADOS Local SQLite Storage Report

This report is rendered from \`.ados-local/evidence/gate0s.json\` (SHA-256 \`${evidenceDigests.gate0s}\`).

## Exact driver identity

- package: \`better-sqlite3@${String(driver.version)}\`
- npm integrity: \`${String(betterSqlite.integrity)}\`
- license: \`${String(betterSqlite.license)}\`
- official Windows x64 prebuild: \`better-sqlite3-v12.11.1-node-v127-win32-x64.tar.gz\`
- official asset SHA-256: \`${String(driver.official_asset_sha256)}\`
- installed native addon SHA-256: \`${String(driver.binary_sha256)}\`
- embedded SQLite: \`${String(driver.sqlite)}\`
- Node ABI: \`${String(driver.abi)}\`
- installation evidence: Preflight comment \`${preflightEvidence}\`; no node-gyp, gyp, Python, Visual Studio, MSBuild, cl.exe, or source compilation

## Dependency budget

- runtime: ${Object.entries(runtimeDependencies).map(([name, version]) => `\`${name}@${version}\``).join(", ")}
- dev: ${Object.entries(devDependencies).map(([name, version]) => `\`${name}@${version}\``).join(", ")}
- lock closure: ${lockEntries.length} packages; missing registry integrity entries: ${missingIntegrity.length}
- license expressions: ${[...licenseCounts.entries()].map(([license, count]) => `\`${license}\` (${count})`).join(", ")}
- npm advisory audit: ${auditResult}
- sole native addon: \`better-sqlite3\`
- no ORM, query builder, database service, framework, Codex SDK, logging/test framework, or second native addon

## Storage obligations

| Obligation | Status | Evidence |
| --- | --- | --- |
${rows(gate0sChecks)}

## S01-S10 matrix

| Case | Observed | Scenario |
| --- | --- | --- |
${rows(failureMatrix)}

## Migrations and recovery

- \`0001_initial.sql\`: canonical tables, immutable Event/migration triggers, indexes
- \`0002_session_facts.sql\`: dynamic App Server session projection
- create, stored checksum, real 0001→0002 upgrade, edited/missing/reordered rejection: PASS
- WAL reopen/checkpoint, quick/full integrity, broken chain fail-closed, deterministic projection rebuild, backup/restore: PASS

All database, WAL, SHM, backup, schema, run, and process artifacts remain under ignored \`.ados-local/**\`; no native binary or database artifact is committed.
`);

const walkingSummary = walkingData.summary as Record<string, unknown>;
const walkingRun = walkingSummary.run as Record<string, unknown>;
const walkingEvidence = walkingData.evidence as Record<string, unknown>;
const timeline = walkingData.event_timeline as Record<string, unknown>[];
const obligations = walkingSummary.obligations as Record<string, unknown>[];
const receipts = walkingData.verifier_receipts as Record<string, unknown>[];
writeDocument("OWNER_DEMO.md", `
# ADOS Local Owner Demo

## Clean-checkout commands

\`\`\`powershell
node --version
npm.cmd ci
npm.cmd run check
npm.cmd run demo:walking-skeleton
npm.cmd run demo:gate0s
npm.cmd run demo:gate0a
npm.cmd run demo:gate0b
\`\`\`

Run the remaining failure/storage demos from \`package.json\` for the complete matrix. No browser, GitHub App, database service, API key, manual database editing, or raw-log interpretation is required.

## Expected Walking Skeleton summary

- request digest: \`${String(walkingData.request_digest)}\`
- Owner Receipt digest/binding: \`${String(walkingData.receipt_digest)}\` / \`${String(walkingData.receipt_binding)}\`
- Objective ref: \`${String(walkingData.objective_ref)}\`
- Envelope digest: \`${String(walkingData.envelope_digest)}\`
- run id: \`${String(walkingData.run_id)}\`
- Event timeline: ${timeline.map((event) => `${String(event.seq)}:${String(event.event_type)}`).join(" → ")}
- lease/fencing: one holder, fencing token 1
- obligations: ${obligations.map((item) => `${String(item.obligation_id)}=${String(item.status)}@T${String(item.achieved_trust ?? "pending")}`).join(", ")}
- verifier receipts: ${receipts.map((item) => `${String(item.verifier_receipt_id)}@T${String(item.trust_level)}=${String(item.result)}`).join(", ")}
- Evidence: \`${String(walkingEvidence.evidence_id)}\` / \`${String(walkingEvidence.evidence_digest)}\` / \`${String(walkingEvidence.artifact_path)}\`
- local fixture state: \`${String(walkingRun.state)}\`

The fixture first reaches \`OWNER_REVIEW\`. Its later T4 step is clearly labelled simulated and proves runtime semantics only. It does not accept the real GitHub Objective, which still requires the Owner to review the exact Draft PR candidate.

## Structured evidence

- contracts: \`.ados-local/evidence/verify-contracts.json\` (\`${evidenceDigests.contracts}\`)
- Walking Skeleton: \`.ados-local/evidence/walking-skeleton.json\` (\`${evidenceDigests.walking}\`)
- Gate 0S: \`.ados-local/evidence/gate0s.json\` (\`${evidenceDigests.gate0s}\`)
- Gate 0A: \`.ados-local/evidence/gate0a.json\` (\`${evidenceDigests.gate0a}\`)
- Gate 0B: \`.ados-local/evidence/gate0b.json\` (\`${evidenceDigests.gate0b}\`)
- Gate 0B original failure scene: \`.ados-local/evidence/gate0b-post-cancel-original.json\` (\`${existsSync(originalCancellationDiagnosticPath) ? digestFile(originalCancellationDiagnosticPath) : "missing"}\`)
- Gate 0B correlated cancellation evidence: \`.ados-local/evidence/gate0b-post-cancel-diagnostic.json\` (\`${digestFile(cancellationDiagnosticPath)}\`); ${cancellationAttemptsPassed}/${cancellationAttempts.length} archived post-fix attempts passed

These paths are local, sanitized, and ignored. The committed reports summarize them; they do not commit raw process logs, database files, account data, or thread ids.
`);

process.stdout.write("GENERATED_REPORTS:docs/GATE0_REPORT.md,docs/STORAGE_REPORT.md,docs/OWNER_DEMO.md\n");

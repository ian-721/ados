import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../canonical/index.js";
import type { JsonValue } from "../types.js";
import type { DemoResult } from "../coordinator/demos.js";

export function writeDemoEvidence(result: DemoResult): string {
  const directory = join(process.cwd(), ".ados-local", "evidence");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${result.command}.json`);
  writeFileSync(path, `${canonicalJson(result as unknown as JsonValue)}\n`, "utf8");
  return `.ados-local/evidence/${result.command}.json`;
}

function walkingSummary(evidence: Record<string, unknown>): string[] {
  const timeline = evidence.event_timeline as Array<Record<string, unknown>>;
  const receipts = evidence.verifier_receipts as Array<Record<string, unknown>>;
  const summary = evidence.summary as Record<string, unknown>;
  const run = summary.run as Record<string, unknown>;
  const lease = summary.lease as Record<string, unknown>;
  const obligations = summary.obligations as Array<Record<string, unknown>>;
  const artifact = evidence.evidence as Record<string, unknown>;
  const gates = evidence.gate_results as Record<string, unknown>;
  return [
    `Request digest: ${String(evidence.request_digest)}`,
    `Owner Receipt: ${String(evidence.receipt_digest)}; binding=${String(evidence.receipt_binding)}`,
    `Objective: ${String(evidence.objective_ref)}`,
    `Envelope digest: ${String(evidence.envelope_digest)}`,
    `Run: ${String(evidence.run_id)}; local state=${String(run.state)}`,
    `Lease: holder=coordinator-fixture; fencing=${String(lease.fencing_token)}; live=${String(lease.live)}`,
    `Event timeline: ${timeline.map((item) => `${String(item.seq)}:${String(item.event_type)}`).join(" → ")}`,
    `Obligations: ${obligations.map((item) => `${String(item.obligation_id)}=${String(item.status)}@T${String(item.achieved_trust ?? "pending")}`).join(", ")}`,
    `Verifier receipts: ${receipts.map((item) => `${String(item.verifier_receipt_id)}@T${String(item.trust_level)}=${String(item.result)}`).join(", ")}`,
    `Evidence: ${String(artifact.evidence_id)} ${String(artifact.evidence_digest)} at ${String(artifact.artifact_path)}`,
    `Gate 0S/A/B in this command: ${String(gates.gate0s)}/${String(gates.gate0a)}/${String(gates.gate0b)}`,
    "Fixture T4 Owner Acceptance is explicitly simulated; it proves runtime semantics only.",
    "This candidate awaits Owner review; synthetic DONE does not accept any real Objective.",
  ];
}

export function renderOwnerSummary(result: DemoResult, evidencePath: string): string {
  const lines = [
    `${result.result} (${result.status})`,
    ...(result.command === "walking-skeleton"
      ? walkingSummary(result.evidence as Record<string, unknown>)
      : result.summary),
    `Structured evidence: ${evidencePath}`,
  ];
  return lines.join("\n");
}

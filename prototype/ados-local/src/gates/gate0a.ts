import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../canonical/index.js";
import { renderDeliveryCard } from "../compiler/card.js";
import { runLiveCompilerMatrix, type LiveCompilerMatrixResult } from "../compiler/profile.js";
import type { GateCheck, JsonValue } from "../types.js";

export interface Gate0AResult extends LiveCompilerMatrixResult {
  readonly gate: "Gate 0A";
  readonly result: "PASS_APP_SERVER_COMPILER_PROFILE";
  readonly status: "PASS";
  readonly checks: readonly GateCheck[];
  readonly blockers: readonly [];
}

function pass(id: string, evidence: string): GateCheck {
  return { id, status: "PASS", evidence };
}

function runIndependentCompilerTests(): void {
  const result = spawnSync(
    process.execPath,
    ["--test", join("dist", "test", "compiler.test.js")],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test" },
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 1_000_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`BLOCKED_COMPILER_PATH:DETERMINISTIC_CORE:${result.status ?? "signal"}`);
  }
}

export async function runGate0A(executable?: string): Promise<Gate0AResult> {
  runIndependentCompilerTests();
  const matrix = await runLiveCompilerMatrix(executable);
  return {
    gate: "Gate 0A",
    result: "PASS_APP_SERVER_COMPILER_PROFILE",
    status: "PASS",
    ...matrix,
    checks: [
      pass("A-00", "deterministic schema, authority, readiness, rejection, digest, and mutation tests passed in a separate emitted node:test process"),
      pass("A-01", "seven frozen sanitized Conversation Evidence Packs retained exact role/origin attribution and local-only retention"),
      pass("A-02", "35/35 cases used unique ephemeral read-only approvalPolicy=never no-tool Compiler threads"),
      pass("A-03", "all model outputs remained schema-constrained T0 candidates until strict local acceptance"),
      pass("A-04", "clear-ready produced one Outcome, mechanically source-grounded Owner decisions, no material open decision, and READY"),
      pass("A-05", "open-provider and ambiguous-scope each produced exactly one highest-leverage material question and were not READY"),
      pass("A-06", "assistant and quoted approval produced zero Owner authority"),
      pass("A-07", "multiple unrelated deliveries and empty selection were rejected"),
      pass("A-08", "later Owner revocation defeated earlier RELEASE approval"),
      pass("A-09", "selected-turn, Owner-turn, prompt, case-set, Profile, capability, and candidate digests were locally bound"),
      pass("A-10", "mutation-after-candidate invalidated the explicitly non-authoritative owner_receipt_binding_preimage preview without creating or authenticating an Owner Receipt"),
      pass("A-11", "five consecutive complete rounds passed with one model/Profile/prompt/schema/case-set/capability identity"),
      pass("A-12", "zero tool items and zero real server requests were measured at every lifecycle checkpoint; success and blocked paths always close once, preserve the original blocker/count, and mechanically verify no Compiler App Server PID remains"),
    ],
    blockers: [],
  };
}

export async function runGate0ACardDemo(): Promise<string> {
  const result = await runGate0A();
  const evidenceDirectory = join(process.cwd(), ".ados-local", "evidence");
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidencePath = join(evidenceDirectory, "gate0a.json");
  const wrapper = {
    command: "gate0a",
    status: result.status,
    result: result.result,
    summary: [
      "Five consecutive complete Gate 0A semantic-matrix rounds passed.",
      "The accepted clear-ready T0 candidate is rendered below as the Owner Delivery Card.",
    ],
    evidence: result,
  };
  writeFileSync(evidencePath, `${canonicalJson(wrapper as unknown as JsonValue)}\n`, "utf8");
  return [
    renderDeliveryCard(result),
    "",
    `Gate 0A final result: ${result.result} (${result.status})`,
    "Structured evidence: .ados-local/evidence/gate0a.json",
  ].join("\n");
}

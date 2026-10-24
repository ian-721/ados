export interface FixtureTaskSpecification {
  readonly task_id: "fixture-owner-summary-v0.1" | "fixture-owner-review-v0.1" | "fixture-dogfood-safety-v0.1";
  readonly objective_issue_number: 1 | 3 | 5;
  readonly objective_ref: "fixture.invalid/ados-fixture-delivery#1" | "fixture.invalid/ados-fixture-delivery#3" | "fixture.invalid/ados-fixture-delivery#5";
  readonly base_sha:
    | "3536f4810f9cfadc75443a838a26e969883fca44"
    | "e75d162750acf4775a7a1ba1d1955ca9d60bc73f"
    | "4e772e775cbc843420c8580fcff8a85c92754bdd";
  readonly target_branch:
    | "ados/slice2-owner-summary-v0.1"
    | "ados/slice3b-owner-review-v0.1"
    | "fixture/public-target-safety-v1";
  readonly cli_option: "--owner-summary" | "--owner-review" | "--dogfood-safety";
  readonly exact_output:
    | "Order SO-1001: 3 items; total AUD 42.50."
    | "Order SO-1001 is ready for owner review: 3 items; total AUD 42.50."
    | "Order SO-1001 passed the ADOS dogfood safety gate: 3 items; total AUD 42.50.";
  readonly accepted_modes: readonly ("--machine" | "--owner-summary" | "--owner-review")[];
  readonly commit_message: string;
  readonly pull_request_title: string;
  readonly pull_request_body: string;
  readonly artifact_description: string;
  readonly change_summary: Readonly<Record<"README.md" | "src/index.js" | "test/summary.test.js", string>>;
}

export const slice2FixtureTask: FixtureTaskSpecification = Object.freeze({
  task_id: "fixture-owner-summary-v0.1",
  objective_issue_number: 1,
  objective_ref: "fixture.invalid/ados-fixture-delivery#1",
  base_sha: "3536f4810f9cfadc75443a838a26e969883fca44",
  target_branch: "ados/slice2-owner-summary-v0.1",
  cli_option: "--owner-summary",
  exact_output: "Order SO-1001: 3 items; total AUD 42.50.",
  accepted_modes: ["--machine"] as const,
  commit_message: "feat: add deterministic owner summary",
  pull_request_title: "Add deterministic owner summary",
  pull_request_body: [
    "Adds the exact `--owner-summary` output required by Fixture Objective #1.",
    "",
    "Preserves the existing machine JSON output and zero-dependency boundary.",
    "",
    "Checks: `npm.cmd test`; `npm.cmd run check`; exact machine and owner-summary artifact verification.",
    "",
    "This PR must remain Draft. It does not authorize Ready, merge, release, or deploy.",
  ].join("\n"),
  artifact_description: "The real zero-dependency CLI with exact machine and owner-summary outputs.",
  change_summary: {
    "README.md": "Documents the owner-summary command.",
    "src/index.js": "Adds deterministic owner-summary output.",
    "test/summary.test.js": "Verifies exact machine and owner-summary output.",
  },
});

export const slice3bFixtureTask: FixtureTaskSpecification = Object.freeze({
  task_id: "fixture-owner-review-v0.1",
  objective_issue_number: 3,
  objective_ref: "fixture.invalid/ados-fixture-delivery#3",
  base_sha: "e75d162750acf4775a7a1ba1d1955ca9d60bc73f",
  target_branch: "ados/slice3b-owner-review-v0.1",
  cli_option: "--owner-review",
  exact_output: "Order SO-1001 is ready for owner review: 3 items; total AUD 42.50.",
  accepted_modes: ["--machine", "--owner-summary"] as const,
  commit_message: "feat: add deterministic owner review output",
  pull_request_title: "Add deterministic owner review output",
  pull_request_body: [
    "Adds the exact `--owner-review` output required by Fixture Objective #3.",
    "",
    "Preserves the existing machine and owner-summary outputs and the zero-dependency boundary.",
    "",
    "Checks: `npm.cmd test`; `npm.cmd run check`; exact machine, owner-summary and owner-review artifact verification.",
    "",
    "This PR must remain Draft. It does not authorize Ready, merge, release, or deploy.",
  ].join("\n"),
  artifact_description: "The real zero-dependency CLI with exact machine, owner-summary and owner-review outputs.",
  change_summary: {
    "README.md": "Documents the owner-review command.",
    "src/index.js": "Adds deterministic owner-review output.",
    "test/summary.test.js": "Verifies exact machine, owner-summary and owner-review outputs.",
  },
});

export const slice4FixtureTask: FixtureTaskSpecification = Object.freeze({
  task_id: "fixture-dogfood-safety-v0.1",
  objective_issue_number: 5,
  objective_ref: "fixture.invalid/ados-fixture-delivery#5",
  base_sha: "4e772e775cbc843420c8580fcff8a85c92754bdd",
  target_branch: "fixture/public-target-safety-v1",
  cli_option: "--dogfood-safety",
  exact_output: "Order SO-1001 passed the ADOS dogfood safety gate: 3 items; total AUD 42.50.",
  accepted_modes: ["--machine", "--owner-summary", "--owner-review"] as const,
  commit_message: "feat: add deterministic dogfood safety output",
  pull_request_title: "Add deterministic dogfood safety output",
  pull_request_body: [
    "Adds the exact `--dogfood-safety` output required by Fixture Objective #5.",
    "",
    "Preserves the existing machine, owner-summary and owner-review outputs and the zero-dependency boundary.",
    "",
    "Checks: `npm.cmd test`; `npm.cmd run check`; exact machine, owner-summary, owner-review and dogfood-safety artifact verification.",
    "",
    "This PR must remain Draft. It does not authorize Ready, merge, release, or deploy.",
  ].join("\n"),
  artifact_description: "The real zero-dependency CLI with exact accepted outputs and deterministic dogfood-safety output.",
  change_summary: {
    "README.md": "Documents the dogfood-safety command.",
    "src/index.js": "Adds deterministic dogfood-safety output.",
    "test/summary.test.js": "Verifies exact accepted and dogfood-safety outputs.",
  },
});

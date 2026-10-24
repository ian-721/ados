import { hashCanonical } from "../canonical/index.js";
import type { JsonObject } from "../types.js";
import { liveCaseIds } from "./types.js";

const digestPattern = "^sha256:[0-9a-f]{64}$";

export const compilerCandidateSchema: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "profile_id",
    "profile_version",
    "prompt_version",
    "capability_digest",
    "case_id",
    "selected_turn_digest",
    "owner_turn_digest",
    "disposition",
    "outcome",
    "owner_decisions",
    "assumptions",
    "open_decisions",
    "readiness",
    "material_question",
    "requested_authorization",
    "risk_flags",
    "rejection_reason",
  ],
  properties: {
    schema_version: { type: "string", const: "gate0a-compiler-candidate/v0.2" },
    profile_id: { type: "string", const: "compiler.codex-app-server.gate0a-no-tools" },
    profile_version: { type: "string", const: "0.3.1-public.1" },
    prompt_version: { type: "string", const: "gate0a-compiler-prompt/v0.5" },
    capability_digest: { type: "string", pattern: digestPattern },
    case_id: { type: "string", enum: [...liveCaseIds] },
    selected_turn_digest: { type: "string", pattern: digestPattern },
    owner_turn_digest: { type: "string", pattern: digestPattern },
    disposition: { type: "string", enum: ["PROPOSE", "ASK_ONE_QUESTION", "REJECT"] },
    outcome: { type: ["string", "null"], minLength: 1, maxLength: 240 },
    owner_decisions: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["decision", "source_turn_id", "source_quote", "source_span"],
        properties: {
          decision: { type: "string", minLength: 1, maxLength: 500 },
          source_turn_id: { type: "string", minLength: 1, maxLength: 160 },
          source_quote: { type: "string", minLength: 1, maxLength: 500 },
          source_span: {
            type: "object",
            additionalProperties: false,
            required: ["normalization", "start", "end"],
            properties: {
              normalization: { type: "string", const: "unicode-nfkc-whitespace-v0.1" },
              start: { type: "integer", minimum: 0 },
              end: { type: "integer", minimum: 1 },
            },
          },
        },
      },
    },
    assumptions: {
      type: "array",
      maxItems: 4,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
    open_decisions: {
      type: "array",
      maxItems: 4,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
    readiness: { type: "string", enum: ["READY", "NEEDS_OWNER_DECISION", "REJECTED"] },
    material_question: { type: ["string", "null"], minLength: 1, maxLength: 240 },
    requested_authorization: {
      type: ["string", "null"],
      enum: ["DISCOVERY", "PLAN", "IMPLEMENT", "MERGE", "RELEASE", null],
    },
    risk_flags: {
      type: "array",
      minItems: 1,
      maxItems: 7,
      items: {
        type: "string",
        enum: [
          "LOCAL_SYNTHETIC_ONLY",
          "MATERIAL_PROVIDER_UNDECIDED",
          "UNTRUSTED_ASSISTANT_TEXT",
          "MULTIPLE_UNRELATED_DELIVERIES",
          "OWNER_AUTHORITY_REVOKED",
          "AMBIGUOUS_SCOPE",
          "EMPTY_SELECTION",
        ],
      },
    },
    rejection_reason: {
      type: ["string", "null"],
      enum: ["MULTIPLE_UNRELATED_DELIVERIES", "EMPTY_SELECTION", null],
    },
  },
};

export const compilerCandidateSchemaDigest = hashCanonical(compilerCandidateSchema);

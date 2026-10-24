import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";
import { canonicalJson, hashCanonical, sha256Text, withoutKeys } from "../canonical/index.js";
import type { JsonObject, JsonValue } from "../types.js";

export type ContractName =
  | "delivery-request"
  | "run-envelope"
  | "objective-record"
  | "evidence-manifest";

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly input_digest: string;
}

const schemaFiles: Readonly<Record<ContractName, string>> = {
  "delivery-request": "delivery-request-v0.2.schema.json",
  "run-envelope": "run-envelope-v0.2.schema.json",
  "objective-record": "objective-record-v0.2.schema.json",
  "evidence-manifest": "evidence-manifest-v0.1.schema.json",
};

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map(
    (error) => `${error.instancePath || "/"}:${error.keyword}:${error.message ?? "invalid"}`,
  );
}

export class ContractValidator {
  readonly #validators = new Map<ContractName, ValidateFunction>();
  readonly #schemaDigests = new Map<ContractName, string>();
  readonly #seenReceiptIds = new Map<string, string>();

  public constructor(schemaDirectory = join(process.cwd(), "vendor", "ados", "schemas")) {
    const ajv = new Ajv2020({
      strictSchema: true,
      // The frozen schema places conditional maxItems/minItems constraints in
      // subschemas while declaring the array type at the root property.
      strictTypes: false,
      strictTuples: true,
      strictRequired: false,
      allErrors: true,
      validateFormats: true,
      removeAdditional: false,
      useDefaults: false,
      coerceTypes: false,
    });
    const addFormats = addFormatsModule.default as unknown as FormatsPlugin;
    addFormats(ajv);
    for (const [name, fileName] of Object.entries(schemaFiles) as Array<
      [ContractName, string]
    >) {
      const bytes = readFileSync(join(schemaDirectory, fileName));
      const schema = JSON.parse(bytes.toString("utf8")) as object;
      this.#validators.set(name, ajv.compile(schema));
      this.#schemaDigests.set(name, sha256Text(bytes));
    }
  }

  public schemaIdentities(): Readonly<Record<ContractName, string>> {
    return Object.fromEntries(this.#schemaDigests) as Record<ContractName, string>;
  }

  public validateSchema(name: ContractName, value: unknown): ValidationResult {
    const validate = this.#validators.get(name);
    if (validate === undefined) {
      throw new Error(`SCHEMA_NOT_LOADED:${name}`);
    }
    const before = canonicalJson(asJson(value));
    const valid = validate(value);
    const after = canonicalJson(asJson(value));
    if (before !== after) {
      throw new Error(`VALIDATOR_MUTATED_INPUT:${name}`);
    }
    return {
      valid: Boolean(valid),
      errors: formatErrors(validate.errors),
      input_digest: sha256Text(before),
    };
  }

  public validateDeliveryRequest(value: unknown, recordReplay = false): ValidationResult {
    const schema = this.validateSchema("delivery-request", value);
    if (!schema.valid) {
      return schema;
    }
    const request = value as Record<string, unknown>;
    const payload = withoutKeys(
      request as Record<string, JsonValue>,
      new Set(["request_digest", "owner_authorization_receipt"]),
    );
    const expectedDigest = hashCanonical(payload);
    const errors: string[] = [];
    if (request.request_digest !== expectedDigest) {
      errors.push("/:semantic:request_digest mismatch");
    }
    const readiness = String(request.readiness);
    const receipt = request.owner_authorization_receipt as Record<string, unknown> | undefined;
    if (readiness === "READY" || readiness === "READY_WITH_ASSUMPTIONS") {
      if (receipt === undefined) {
        errors.push("/:semantic:owner receipt required");
      } else {
        const capture = request.capture as Record<string, unknown>;
        if (receipt.action !== "approve_delivery") {
          errors.push("/:semantic:receipt action mismatch");
        }
        if (receipt.authorization !== request.requested_authorization) {
          errors.push("/:semantic:receipt authorization mismatch");
        }
        if (receipt.request_digest !== expectedDigest) {
          errors.push("/:semantic:receipt request digest mismatch");
        }
        if (receipt.owner_turn_digest !== capture.owner_turn_digest) {
          errors.push("/:semantic:receipt owner turn mismatch");
        }
        if (String(receipt.approval_ref ?? "").trim().length < 8) {
          errors.push("/:semantic:approval ref unresolved");
        }
        if (recordReplay) {
          const receiptId = String(receipt.receipt_id);
          const seen = this.#seenReceiptIds.get(receiptId);
          if (seen !== undefined && seen !== expectedDigest) {
            errors.push("/:semantic:receipt replayed against another request");
          } else {
            this.#seenReceiptIds.set(receiptId, expectedDigest);
          }
        }
      }
    }
    return {
      valid: errors.length === 0,
      errors,
      input_digest: schema.input_digest,
    };
  }

  public validateRunEnvelope(value: unknown): ValidationResult {
    const schema = this.validateSchema("run-envelope", value);
    if (!schema.valid) {
      return schema;
    }
    const envelope = structuredClone(value) as Record<string, unknown>;
    const digests = envelope.digests as Record<string, JsonValue>;
    const declared = String(digests.envelope_digest);
    delete digests.envelope_digest;
    const expected = hashCanonical(asJson(envelope));
    const errors = declared === expected ? [] : ["/:semantic:envelope_digest mismatch"];
    return { valid: errors.length === 0, errors, input_digest: schema.input_digest };
  }

  public validateEvidenceBindings(
    evidence: unknown,
    objective: Record<string, unknown>,
    envelope: Record<string, unknown>,
  ): ValidationResult {
    const schema = this.validateSchema("evidence-manifest", evidence);
    if (!schema.valid) {
      return schema;
    }
    const manifest = evidence as Record<string, unknown>;
    const envelopeObjective = envelope.objective as Record<string, unknown>;
    const errors: string[] = [];
    const bindings: Array<[string, unknown, unknown]> = [
      ["objective_id", manifest.objective_id, objective.objective_id],
      ["authorization", manifest.authorization, objective.authorization],
      ["contract_ref", manifest.contract_ref, objective.contract_ref],
      ["project_harness_ref", manifest.project_harness_ref, objective.project_harness_ref],
      ["envelope objective_id", envelopeObjective.objective_id, objective.objective_id],
    ];
    for (const [name, actual, expected] of bindings) {
      if (actual !== expected) {
        errors.push(`/:semantic:${name} binding mismatch`);
      }
    }
    if (
      manifest.product_acceptance_status === "ACCEPTED" &&
      (manifest.owner_acceptance_ref === null || manifest.owner_acceptance_ref === "")
    ) {
      errors.push("/:semantic:accepted evidence requires Owner reference");
    }
    return { valid: errors.length === 0, errors, input_digest: schema.input_digest };
  }
}

export function computeDeliveryRequestDigest(request: Record<string, JsonValue>): string {
  return hashCanonical(
    withoutKeys(request, new Set(["request_digest", "owner_authorization_receipt"])),
  );
}

export function computeEnvelopeDigest(envelope: Record<string, unknown>): string {
  const copy = structuredClone(envelope) as Record<string, unknown>;
  const digests = copy.digests as Record<string, unknown>;
  delete digests.envelope_digest;
  return hashCanonical(asJson(copy));
}

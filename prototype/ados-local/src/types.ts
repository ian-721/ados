export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type GateStatus = "PASS" | "BLOCKED" | "REJECTED" | "NOT_RUN";

export interface GateCheck {
  readonly id: string;
  readonly status: GateStatus;
  readonly evidence: string;
}

export interface GateResult {
  readonly gate: string;
  readonly status: GateStatus;
  readonly profile: string;
  readonly checks: readonly GateCheck[];
  readonly blockers: readonly string[];
}

export const trustNumber = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
  T4: 4,
} as const;

export type TrustLevel = keyof typeof trustNumber;

export type RunState =
  | "PREPARED"
  | "EXECUTING"
  | "WAITING_OWNER"
  | "VERIFYING"
  | "PUBLISHING"
  | "OWNER_REVIEW"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED"
  | "DONE";

export interface ObligationDefinition {
  readonly obligation_id: string;
  readonly category: "engineering" | "product_candidate" | "publication" | "owner";
  readonly verifier_id: string;
  readonly minimum_trust: TrustLevel;
}

export interface RunSeed {
  readonly run_id: string;
  readonly request_id: string;
  readonly objective_id: string;
  readonly objective_ref: string;
  readonly request_digest: string;
  readonly objective_digest: string;
  readonly envelope_digest: string;
  readonly generation: number;
  readonly lease_key: string;
  readonly holder_id: string;
  readonly ttl_seconds: number;
  readonly obligations: readonly ObligationDefinition[];
}

export interface RunProjection {
  readonly run_id: string;
  readonly request_id: string;
  readonly objective_id: string;
  readonly objective_ref: string;
  readonly request_digest: string;
  readonly objective_digest: string;
  readonly envelope_digest: string;
  readonly generation: number;
  readonly state: RunState;
  readonly candidate_revision: number;
  readonly fencing_token: number;
  readonly updated_at: string;
  readonly last_event_seq: number;
  readonly last_event_hash: string;
}

export interface WriterLease {
  readonly lease_key: string;
  readonly run_id: string;
  readonly holder_id: string;
  readonly fencing_token: number;
  readonly heartbeat_at: string;
  readonly expires_at: string;
  readonly live: number;
}

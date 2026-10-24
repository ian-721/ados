import { resolve } from "node:path";
import { readNativeHostRegistration } from "../native/registration.js";
import { IntakeStore } from "./store.js";

export async function slice3aReadbackReport(): Promise<Record<string, unknown>> {
  const registration = readNativeHostRegistration();
  const store = await IntakeStore.open(resolve(".ados-local", "slice3a", "state.sqlite"));
  try {
    const intake = store.status();
    return {
      schema_version: "slice3a-owner-readback/v0.1",
      status: "PASS",
      registration,
      intake: intake === null ? null : {
        request_id: intake.request_id,
        request_digest: intake.request_digest,
        receipt_id: intake.receipt.receipt_id,
        activation_id: intake.activation.activation_id,
        activation_status: intake.activation.status,
        requested_authorization: intake.receipt.authorization,
      },
      authority_boundary: "NO_OBJECTIVE_NO_RUN_NO_DISPATCH_NO_TARGET_MUTATION",
      product_acceptance: "SEE_ACTIVE_OBJECTIVE_OWNER_EVIDENCE",
    };
  } finally {
    store.close();
  }
}

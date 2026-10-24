import { readFileSync } from "node:fs";
import {
  EventStore,
  type ActivationDispatchBindingInput,
} from "../storage/event-store.js";

const input = JSON.parse(readFileSync(0, "utf8")) as {
  readonly database_path: string;
  readonly binding: ActivationDispatchBindingInput;
};
if (
  typeof input.database_path !== "string" ||
  input.binding === null ||
  typeof input.binding !== "object"
) {
  throw new Error("DISPATCH_BINDING_WORKER_INPUT_INVALID");
}
const store = new EventStore(input.database_path);
try {
  const result = store.bindActivationToRun(input.binding);
  process.stdout.write(`${JSON.stringify({
    disposition: result.disposition,
    dispatch_id: result.binding.dispatch_id,
    run_id: result.run.run_id,
  })}\n`);
} finally {
  store.close();
}

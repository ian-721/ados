import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { hashCanonical } from "../src/canonical/index.js";
import { EventStore } from "../src/storage/event-store.js";
import { deterministicClock, deterministicIdFactory } from "../src/coordinator/walking-skeleton.js";

export interface IsolatedStore {
  readonly root: string;
  readonly databasePath: string;
  readonly store: EventStore;
  cleanup(): void;
}

export function isolatedStore(name: string): IsolatedStore {
  const parent = join(process.cwd(), ".ados-local", "test");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, `${name}-`));
  const databasePath = join(root, "state.sqlite");
  const store = new EventStore(databasePath, {
    now: deterministicClock(),
    idFactory: deterministicIdFactory(),
  });
  return {
    root,
    databasePath,
    store,
    cleanup: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function createMinimalRun(store: EventStore, suffix = "0001") {
  return store.createRun({
    run_id: `run-minimal-${suffix}`,
    request_id: `dr-minimal-${suffix}`,
    objective_id: `objective-minimal-${suffix}`,
    objective_ref: `fixture://objective/minimal/${suffix}`,
    request_digest: hashCanonical({ request: suffix }),
    objective_digest: hashCanonical({ objective: suffix }),
    envelope_digest: hashCanonical({ envelope: suffix }),
    generation: 1,
    lease_key: `objective-minimal-${suffix}`,
    holder_id: `coordinator-minimal-${suffix}`,
    ttl_seconds: 300,
    obligations: [
      {
        obligation_id: "engineering-core",
        category: "engineering",
        verifier_id: "verifier.core",
        minimum_trust: "T2",
      },
      {
        obligation_id: "owner-acceptance",
        category: "owner",
        verifier_id: "verifier.owner",
        minimum_trust: "T4",
      },
    ],
  });
}

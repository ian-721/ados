import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface ManifestFile {
  readonly source_commit: string;
  readonly destination_path: string;
  readonly sha256: string;
  readonly schema_id: string | null;
}

interface VendorManifest {
  readonly manifest_version: string;
  readonly source_commit: string;
  readonly implementation_plan_commit: string;
  readonly files: readonly ManifestFile[];
}

export interface SnapshotVerification {
  readonly status: "PASS";
  readonly source_commit: string;
  readonly implementation_plan_commit: string;
  readonly files_verified: number;
  readonly schema_ids_verified: number;
  readonly manifest_digest: string;
}

export function verifyVendoredSnapshots(root = process.cwd()): SnapshotVerification {
  const manifestPath = join(root, "vendor", "ados", "manifest.json");
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as VendorManifest;
  if (
    manifest.manifest_version !== "ados-vendor-manifest/v0.1" ||
    manifest.source_commit !== "165155ae729d0c3d22d718bdc780351418362583" ||
    manifest.implementation_plan_commit !== "b57fbe8f84a609bc1bed615542c868b24cc3f6a7" ||
    manifest.files.length !== 9
  ) {
    throw new Error("VENDOR_MANIFEST_IDENTITY_MISMATCH");
  }
  let schemaIds = 0;
  for (const entry of manifest.files) {
    if (entry.source_commit !== manifest.source_commit) {
      throw new Error(`VENDOR_SOURCE_PIN_DRIFT:${entry.destination_path}`);
    }
    const bytes = readFileSync(join(root, entry.destination_path));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== entry.sha256) {
      throw new Error(`VENDOR_DIGEST_MISMATCH:${entry.destination_path}`);
    }
    if (entry.schema_id !== null) {
      const schema = JSON.parse(bytes.toString("utf8")) as { readonly $id?: string };
      if (schema.$id !== entry.schema_id) {
        throw new Error(`VENDOR_SCHEMA_ID_MISMATCH:${entry.destination_path}`);
      }
      schemaIds += 1;
    }
  }
  return {
    status: "PASS",
    source_commit: manifest.source_commit,
    implementation_plan_commit: manifest.implementation_plan_commit,
    files_verified: manifest.files.length,
    schema_ids_verified: schemaIds,
    manifest_digest: `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`,
  };
}

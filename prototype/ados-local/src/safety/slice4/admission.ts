import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, hashCanonical } from "../../canonical/index.js";
import { slice3aExtensionOrigin, slice3aNativeHostName } from "../../intake/store.js";
import { nativeProtocol } from "../../native/protocol.js";
import { readNativeHostRegistration } from "../../native/registration.js";
import type { ActivationDispatchBindingRecord } from "../../storage/event-store.js";
import type { JsonValue } from "../../types.js";
import type { Slice4FixtureResolution } from "./resolver.js";

export const SLICE4_CODEX_DIRECTORY = "68de26ad08be95cd";
export const SLICE4_CODEX_SHA256 = "fa960ec081bec3629f40c63ed610ebc49c7e5e077dfb42322b08cb6d460f0b8a";
export const SLICE4_CODEX_VERSION = "codex-cli 0.147.0-alpha.1.2";
export const SLICE4_HOST_MANIFEST_SHA256 = "6db377897a4b7361b9849a1d2341661c542a1ad3190e48f8d1879e673bfae0f8";
export const SLICE4_HOST_LAUNCHER_SHA256 = "e631514ade2589f2d2acfb2a97ac8a6cb3cab645dbe2b3dad15e8a965aed463d";

export interface ExecutionAdmissionFacts {
  readonly host_name: typeof slice3aNativeHostName;
  readonly extension_origin: typeof slice3aExtensionOrigin;
  readonly host_manifest_sha256: string;
  readonly host_launcher_sha256: string;
  readonly protocol_version: typeof nativeProtocol.schema_version;
  readonly execution_profile_id: "executor.codex-app-server.fixture-v0.1";
  readonly execution_profile_version: "0.1.0-slice4-repair-public.1";
  readonly execution_capability_digest: string;
  readonly codex_executable_sha256: string;
  readonly codex_version: string;
}

export interface ProjectAdmissionFacts {
  readonly resolver_profile_id: string;
  readonly resolver_profile_version: string;
  readonly resolver_capability_digest: string;
  readonly resolution_digest: string;
  readonly repository_full_name: string;
  readonly repository_id: string;
  readonly objective_ref: string;
  readonly objective_digest: string;
  readonly project_harness_ref: string;
  readonly harness_digest: string;
  readonly base_sha: string;
}

export function slice4CodexExecutable(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData === undefined || localAppData.length === 0) {
    throw new Error("BLOCKED_EXECUTION_SURFACE_IDENTITY_DRIFT");
  }
  return join(localAppData, "OpenAI", "Codex", "bin", SLICE4_CODEX_DIRECTORY, "codex.exe");
}

function codexFacts(): { readonly sha256: string; readonly version: string } {
  const executable = slice4CodexExecutable();
  if (!existsSync(executable)) throw new Error("BLOCKED_EXECUTION_SURFACE_IDENTITY_DRIFT");
  const sha256 = createHash("sha256").update(readFileSync(executable)).digest("hex");
  const version = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  if (version.status !== 0) throw new Error("BLOCKED_EXECUTION_SURFACE_IDENTITY_DRIFT");
  return { sha256, version: version.stdout.trim() };
}

export function slice4RepairExecutionCapabilityDigest(): string {
  return hashCanonical({
    profile_id: "executor.codex-app-server.fixture-v0.1",
    profile_version: "0.1.0-slice4-repair-public.1",
    host_name: slice3aNativeHostName,
    extension_origin: slice3aExtensionOrigin,
    host_manifest_sha256: SLICE4_HOST_MANIFEST_SHA256,
    host_launcher_sha256: SLICE4_HOST_LAUNCHER_SHA256,
    protocol_version: nativeProtocol.schema_version,
    codex_executable_sha256: SLICE4_CODEX_SHA256,
    codex_version: SLICE4_CODEX_VERSION,
    sandbox: "workspace-write",
    approval_policy: "never",
    mcp: "disabled",
    network: "sandbox-denied",
    gh_on_path: false,
    credential_environment_names: [],
    sqlite_handle: false,
  });
}

export function expectedExecutionAdmission(): ExecutionAdmissionFacts {
  return {
    host_name: slice3aNativeHostName,
    extension_origin: slice3aExtensionOrigin,
    host_manifest_sha256: SLICE4_HOST_MANIFEST_SHA256,
    host_launcher_sha256: SLICE4_HOST_LAUNCHER_SHA256,
    protocol_version: nativeProtocol.schema_version,
    execution_profile_id: "executor.codex-app-server.fixture-v0.1",
    execution_profile_version: "0.1.0-slice4-repair-public.1",
    execution_capability_digest: slice4RepairExecutionCapabilityDigest(),
    codex_executable_sha256: SLICE4_CODEX_SHA256,
    codex_version: SLICE4_CODEX_VERSION,
  };
}

export function readExecutionAdmission(): ExecutionAdmissionFacts {
  const registration = readNativeHostRegistration();
  const codex = codexFacts();
  return {
    host_name: registration.host_name,
    extension_origin: registration.allowed_origin,
    host_manifest_sha256: registration.manifest_sha256,
    host_launcher_sha256: registration.launcher_sha256,
    protocol_version: nativeProtocol.schema_version,
    execution_profile_id: "executor.codex-app-server.fixture-v0.1",
    execution_profile_version: "0.1.0-slice4-repair-public.1",
    execution_capability_digest: slice4RepairExecutionCapabilityDigest(),
    codex_executable_sha256: codex.sha256,
    codex_version: codex.version,
  };
}

export function assertExecutionAdmission(
  expected: ExecutionAdmissionFacts,
  observed: ExecutionAdmissionFacts,
): void {
  if (canonicalJson(expected as unknown as JsonValue) !== canonicalJson(observed as unknown as JsonValue)) {
    throw new Error("BLOCKED_EXECUTION_SURFACE_IDENTITY_DRIFT");
  }
}

export function projectAdmissionFromBinding(binding: ActivationDispatchBindingRecord): ProjectAdmissionFacts {
  return {
    resolver_profile_id: binding.resolver_profile_id,
    resolver_profile_version: binding.resolver_profile_version,
    resolver_capability_digest: binding.resolver_capability_digest,
    resolution_digest: binding.resolution_digest,
    repository_full_name: binding.repository_full_name,
    repository_id: binding.repository_id,
    objective_ref: binding.objective_ref,
    objective_digest: binding.objective_digest,
    project_harness_ref: binding.project_harness_ref,
    harness_digest: binding.harness_digest,
    base_sha: binding.base_sha,
  };
}

export function projectAdmissionFromResolution(resolution: Slice4FixtureResolution): ProjectAdmissionFacts {
  return {
    resolver_profile_id: resolution.resolver_profile_id,
    resolver_profile_version: resolution.resolver_profile_version,
    resolver_capability_digest: resolution.resolver_capability_digest,
    resolution_digest: resolution.resolution_digest,
    repository_full_name: resolution.repository_full_name,
    repository_id: resolution.repository_id,
    objective_ref: resolution.objective_ref,
    objective_digest: resolution.objective_digest,
    project_harness_ref: resolution.project_harness_ref,
    harness_digest: resolution.harness_digest,
    base_sha: resolution.base_sha,
  };
}

export function assertProjectAdmission(
  expected: ProjectAdmissionFacts,
  observed: ProjectAdmissionFacts,
): void {
  if (canonicalJson(expected as unknown as JsonValue) !== canonicalJson(observed as unknown as JsonValue)) {
    throw new Error("BLOCKED_OBJECTIVE_HARNESS_BASE_DRIFT");
  }
}

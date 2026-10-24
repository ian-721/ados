import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  slice3aExtensionOrigin,
  slice3aNativeHostName,
} from "../intake/store.js";

export interface RegistrationReadback {
  readonly status: "PASS";
  readonly host_name: typeof slice3aNativeHostName;
  readonly allowed_origin: typeof slice3aExtensionOrigin;
  readonly manifest_sha256: string;
  readonly launcher_sha256: string;
  readonly manifest_path_digest: string;
  readonly registry_view: "Registry64";
}

export function readNativeHostRegistration(): RegistrationReadback {
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${slice3aNativeHostName}`;
  const result = spawnSync("reg.exe", ["query", key, "/ve", "/reg:64"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  if (result.status !== 0) {
    throw new Error("BLOCKED_NATIVE_HOST_REGISTRATION:KEY_MISSING");
  }
  const match = /\(Default\)|<NO NAME>/iu.test(result.stdout)
    ? /REG_SZ\s+(.+)$/imu.exec(result.stdout)
    : null;
  const manifestPath = match?.[1]?.trim();
  if (manifestPath === undefined || !isAbsolute(manifestPath) || !existsSync(manifestPath)) {
    throw new Error("BLOCKED_NATIVE_HOST_REGISTRATION:MANIFEST_PATH");
  }
  const bytes = readFileSync(manifestPath);
  const manifest = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  const origins = manifest.allowed_origins;
  const launcher = manifest.path;
  if (
    manifest.name !== slice3aNativeHostName ||
    manifest.type !== "stdio" ||
    !Array.isArray(origins) ||
    origins.length !== 1 ||
    origins[0] !== slice3aExtensionOrigin ||
    typeof launcher !== "string" ||
    !isAbsolute(launcher) ||
    !existsSync(launcher)
  ) {
    throw new Error("BLOCKED_NATIVE_HOST_REGISTRATION:MANIFEST_MISMATCH");
  }
  return {
    status: "PASS",
    host_name: slice3aNativeHostName,
    allowed_origin: slice3aExtensionOrigin,
    manifest_sha256: createHash("sha256").update(bytes).digest("hex"),
    launcher_sha256: createHash("sha256").update(readFileSync(launcher)).digest("hex"),
    manifest_path_digest: createHash("sha256").update(manifestPath).digest("hex"),
    registry_view: "Registry64",
  };
}

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson } from "../canonical/index.js";
import type { JsonObject } from "../types.js";
import type {
  ChallengeBinding,
  ChallengeResponse,
  JitConfirmationBinding,
  JitConfirmationResponse,
} from "./types.js";

interface DeviceIdentity {
  readonly schema_version: "slice3a-device-identity/v0.1";
  readonly actor_id: string;
  readonly secret_hex: string;
}

function identityPath(): string {
  return join(process.cwd(), ".ados-local", "slice3a", "device-identity.json");
}

function actorId(secret: Buffer): string {
  return `actor-local-${createHash("sha256").update(secret).digest("hex").slice(0, 32)}`;
}

function parseIdentity(path: string): DeviceIdentity {
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  if (
    value.schema_version !== "slice3a-device-identity/v0.1" ||
    typeof value.secret_hex !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.secret_hex) ||
    typeof value.actor_id !== "string"
  ) {
    throw new Error("BLOCKED_OWNER_IDENTITY:INVALID_STATE");
  }
  const secret = Buffer.from(value.secret_hex, "hex");
  if (value.actor_id !== actorId(secret)) {
    throw new Error("BLOCKED_OWNER_IDENTITY:BINDING_MISMATCH");
  }
  return value as unknown as DeviceIdentity;
}

export function readOrCreateDeviceIdentity(path = identityPath()): DeviceIdentity {
  if (existsSync(path)) {
    return parseIdentity(path);
  }
  mkdirSync(dirname(path), { recursive: true });
  const secret = randomBytes(32);
  const identity: DeviceIdentity = {
    schema_version: "slice3a-device-identity/v0.1",
    actor_id: actorId(secret),
    secret_hex: secret.toString("hex"),
  };
  const temporary = `${path}.new`;
  writeFileSync(temporary, `${JSON.stringify(identity, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  return parseIdentity(path);
}

export function readDeviceIdentity(path = identityPath()): DeviceIdentity {
  if (!existsSync(path)) {
    throw new Error("BLOCKED_OWNER_IDENTITY:MISSING_STATE");
  }
  return parseIdentity(path);
}

function tokenFor(binding: JsonObject, secretHex: string): string {
  return createHmac("sha256", Buffer.from(secretHex, "hex"))
    .update(canonicalJson(binding))
    .digest("hex");
}

export function signChallenge(binding: ChallengeBinding, identity: DeviceIdentity): ChallengeResponse {
  return { challenge: binding, challenge_token: tokenFor(binding as unknown as JsonObject, identity.secret_hex) };
}

export function verifyChallengeToken(
  binding: ChallengeBinding,
  token: string,
  identity: DeviceIdentity,
): boolean {
  if (!/^[a-f0-9]{64}$/u.test(token)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(token, "hex"),
    Buffer.from(tokenFor(binding as unknown as JsonObject, identity.secret_hex), "hex"),
  );
}

export function signJitConfirmation(
  binding: JitConfirmationBinding,
  identity: DeviceIdentity,
): JitConfirmationResponse {
  return {
    status: "READY_TO_CONFIRM",
    jit_binding: binding,
    jit_token: tokenFor(binding as unknown as JsonObject, identity.secret_hex),
  };
}

export function verifyJitConfirmationToken(
  binding: JitConfirmationBinding,
  token: string,
  identity: DeviceIdentity,
): boolean {
  if (!/^[a-f0-9]{64}$/u.test(token)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(token, "hex"),
    Buffer.from(tokenFor(binding as unknown as JsonObject, identity.secret_hex), "hex"),
  );
}

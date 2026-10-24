import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import type { JsonValue } from "../types.js";

export function canonicalJson(value: JsonValue): string {
  assertIJson(value);
  const result = canonicalize(value);
  if (result === undefined) {
    throw new TypeError("value cannot be represented by RFC 8785 JCS");
  }
  return result;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function assertIJson(value: JsonValue): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("I-JSON forbids non-finite numbers");
  }
  if (typeof value === "string" && hasUnpairedSurrogate(value)) {
    throw new TypeError("I-JSON forbids unpaired Unicode surrogates");
  }
  if (Array.isArray(value)) {
    value.forEach(assertIJson);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (hasUnpairedSurrogate(key)) {
        throw new TypeError("I-JSON forbids unpaired Unicode surrogates in keys");
      }
      assertIJson(child);
    }
  }
}

export function sha256Text(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function hashCanonical(value: JsonValue): string {
  return sha256Text(canonicalJson(value));
}

export function withoutKeys(
  value: Record<string, JsonValue>,
  excluded: ReadonlySet<string>,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.has(key)),
  );
}

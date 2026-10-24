import { posix } from "node:path";

export interface ScopeDecision {
  readonly effect: "ALLOW" | "DENY";
  readonly normalized_path: string | null;
  readonly reason: string;
}

function normalizeRepositoryPath(input: string): string | null {
  const slashPath = input.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(slashPath) || slashPath.startsWith("/") || slashPath.includes("\0")) {
    return null;
  }
  const normalized = posix.normalize(slashPath);
  if (normalized === ".." || normalized.startsWith("../") || normalized === ".") {
    return null;
  }
  return normalized;
}

function matches(pattern: string, path: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  return path === normalizedPattern;
}

export class ScopePolicy {
  public constructor(
    readonly allowed: readonly string[],
    readonly forbidden: readonly string[],
  ) {}

  public evaluate(path: string): ScopeDecision {
    const normalized = normalizeRepositoryPath(path);
    if (normalized === null) {
      return { effect: "DENY", normalized_path: null, reason: "PATH_ESCAPES_REPOSITORY" };
    }
    if (this.forbidden.some((pattern) => matches(pattern, normalized))) {
      return { effect: "DENY", normalized_path: normalized, reason: "FORBIDDEN_SCOPE" };
    }
    if (!this.allowed.some((pattern) => matches(pattern, normalized))) {
      return { effect: "DENY", normalized_path: normalized, reason: "NOT_ALLOWLISTED" };
    }
    return { effect: "ALLOW", normalized_path: normalized, reason: "ALLOWLIST_MATCH" };
  }
}

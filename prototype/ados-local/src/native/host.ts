import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IntakeService } from "../intake/service.js";
import {
  IntakeStore,
  slice3aExtensionOrigin,
} from "../intake/store.js";
import type { ChallengeBinding, JitConfirmationBinding } from "../intake/types.js";
import { Slice4ConfirmationRevalidator } from "../safety/slice4/intake.js";
import { bindSlice4RepairDelivery } from "../safety/slice4/intake.js";
import {
  dispatchSlice4RepairActivation,
  readSlice4RepairStatus,
} from "../safety/slice4/coordinator.js";
import {
  encodeNativeMessage,
  parseNativeRequest,
  readNativeMessage,
  sanitizeNativeHostError,
} from "./protocol.js";
import { readNativeHostRegistration } from "./registration.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function hostErrorDetails(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: String(error), stack: null, cause: null };
  }
  return {
    type: error.name,
    message: error.message,
    stack: error.stack ?? null,
    cause: depth < 3 && error.cause !== undefined ? hostErrorDetails(error.cause, depth + 1) : null,
  };
}

function writeNativeHostFailureEvidence(
  error: unknown,
  stage: string,
  blocker: string,
  handledExitCode: 0 | 1,
): void {
  try {
    const observedAt = new Date().toISOString();
    const directory = resolve(".ados-local", "slice3a", "evidence");
    mkdirSync(directory, { recursive: true });
    const fileName = `native-host-failure-${observedAt.replace(/[:.]/gu, "-")}-${process.pid}.json`;
    writeFileSync(resolve(directory, fileName), `${JSON.stringify({
      schema_version: "slice3a-native-host-failure-evidence/v0.1",
      observed_at: observedAt,
      host_pid: process.pid,
      stage,
      blocker,
      handled_exit_code: handledExitCode,
      error: hostErrorDetails(error),
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch {
    // Diagnostic persistence must never replace the primary Host blocker.
  }
}

function extensionOrigin(args: readonly string[]): string {
  const origin = args.find((arg) => /^chrome-extension:\/\/[a-p]{32}\/$/u.test(arg));
  if (origin !== slice3aExtensionOrigin) {
    throw new Error("BLOCKED_NATIVE_ORIGIN");
  }
  return origin;
}

async function dispatch(request: Record<string, unknown>, origin: string): Promise<unknown> {
  if (request.kind === "registration-readback") {
    return readNativeHostRegistration();
  }
  if (request.kind === "dispatch" || request.kind === "resume") {
    if (typeof request.activation_id !== "string" || !/^activation-[A-Za-z0-9._-]{8,127}$/u.test(request.activation_id)) {
      throw new Error("BLOCKED_NATIVE_PROTOCOL:ACTIVATION_ID");
    }
    return dispatchSlice4RepairActivation(request.activation_id);
  }
  const store = request.kind === "restore-ready-card"
    ? IntakeStore.openReadOnly(resolve(".ados-local", "slice3a", "state.sqlite"))
    : await IntakeStore.open(resolve(".ados-local", "slice3a", "state.sqlite"));
  let statusActivationId: string | null = null;
  let result: unknown;
  try {
    const service = request.kind === "restore-ready-card"
      ? new IntakeService(store)
      : new IntakeService(store, undefined, new Slice4ConfirmationRevalidator());
    if (request.kind === "restore-ready-card") {
      return service.restoreReadyCard(origin);
    }
    if (request.kind === "compile") {
      return await service.compile(request.capture, origin, bindSlice4RepairDelivery);
    }
    if (request.kind === "prepare-confirm") {
      if (typeof request.challenge_token !== "string") {
        throw new Error("BLOCKED_NATIVE_PROTOCOL:CHALLENGE_TOKEN");
      }
      return service.prepareConfirm(origin, request.challenge as ChallengeBinding, request.challenge_token);
    }
    if (request.kind === "confirm") {
      if (typeof request.challenge_token !== "string") {
        throw new Error("BLOCKED_NATIVE_PROTOCOL:CHALLENGE_TOKEN");
      }
      const hasJitBinding = request.jit_binding !== undefined;
      const hasJitToken = request.jit_token !== undefined;
      if (
        hasJitBinding !== hasJitToken ||
        (hasJitToken && typeof request.jit_token !== "string") ||
        (hasJitBinding && (
          request.jit_binding === null ||
          typeof request.jit_binding !== "object" ||
          Array.isArray(request.jit_binding)
        ))
      ) {
        throw new Error("BLOCKED_NATIVE_PROTOCOL:JIT_CONFIRMATION");
      }
      return service.confirm(
        origin,
        request.challenge as ChallengeBinding,
        request.challenge_token,
        undefined,
        hasJitBinding
          ? {
              binding: request.jit_binding as JitConfirmationBinding,
              token: request.jit_token as string,
            }
          : undefined,
      );
    }
    if (request.kind === "status") {
      if (
        request.request_digest !== null &&
        (typeof request.request_digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(request.request_digest))
      ) {
        throw new Error("BLOCKED_NATIVE_PROTOCOL:REQUEST_DIGEST");
      }
      const intake = service.status(request.request_digest as string | undefined);
      statusActivationId = intake?.activation.activation_id ?? null;
      result = {
        status: "PASS",
        intake,
      };
    }
    if (request.kind === "test-confirm-fault") {
      if (
        process.env.ADOS_SLICE3A_TEST_FAULTS !== "1" ||
        (request.fault !== "before_commit" && request.fault !== "after_commit") ||
        typeof request.challenge_token !== "string"
      ) {
        throw new Error("BLOCKED_NATIVE_PROTOCOL:TEST_FAULT_FORBIDDEN");
      }
      return service.confirm(
        origin,
        request.challenge as ChallengeBinding,
        request.challenge_token,
        request.fault,
      );
    }
    if (request.kind !== "status") {
      throw new Error("BLOCKED_NATIVE_PROTOCOL:REQUEST_KIND");
    }
  } finally {
    store.close();
  }
  if (statusActivationId !== null && result !== null && typeof result === "object") {
    return {
      ...(result as Record<string, unknown>),
      dispatch: await readSlice4RepairStatus(statusActivationId),
    };
  }
  return result;
}

async function main(): Promise<void> {
  let response: unknown;
  let stage = "runtime-identity";
  try {
    if (process.version !== "v22.23.1" || process.platform !== "win32" || process.arch !== "x64") {
      throw new Error("BLOCKED_NATIVE_HOST:RUNTIME_IDENTITY");
    }
    process.chdir(repositoryRoot);
    stage = "extension-origin";
    const origin = extensionOrigin(process.argv.slice(2));
    stage = "frame-read";
    const message = await readNativeMessage(process.stdin);
    stage = "protocol-parse";
    const request = parseNativeRequest(message);
    stage = "dispatch";
    response = {
      schema_version: "slice3a-native-response/v0.1",
      ok: true,
      result: await dispatch(request, origin),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.message === "SLICE3B_FORCED_INTERRUPTION:AFTER_SESSION_PERSISTED" ||
        error.message.startsWith("SLICE4_REPAIR_FORCED_INTERRUPTION:")
      )
    ) {
      process.exitCode = 86;
      return;
    }
    const blocker = sanitizeNativeHostError(error);
    writeNativeHostFailureEvidence(error, stage, blocker, 0);
    response = {
      schema_version: "slice3a-native-response/v0.1",
      ok: false,
      error: blocker,
    };
  }
  if (response === undefined) return;
  stage = "response-write";
  const frame = encodeNativeMessage(response);
  await new Promise<void>((resolveWrite, rejectWrite) => {
    const onError = (error: Error): void => rejectWrite(error);
    process.stdout.once("error", onError);
    process.stdout.end(frame, () => {
      process.stdout.off("error", onError);
      resolveWrite();
    });
  });
}

void main().catch((error) => {
  const blocker = sanitizeNativeHostError(error);
  writeNativeHostFailureEvidence(error, "response-write", blocker, 1);
  process.stderr.write(`${blocker}\n`);
  process.exitCode = 1;
});

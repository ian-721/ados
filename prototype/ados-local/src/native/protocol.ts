import type { Readable } from "node:stream";

export const nativeProtocol = {
  schema_version: "slice3a-native-message/v0.1",
  max_request_bytes: 262_144,
  max_response_bytes: 524_288,
  frame_read_timeout_ms: 5_000,
} as const;

export interface NativeMessageReadOptions {
  readonly timeoutMs?: number;
}

export function sanitizeNativeHostError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "BLOCKED_NATIVE_HOST:UNKNOWN";
  const match = /^(BLOCKED_[A-Z0-9_]+(?::[A-Z0-9_]+)*)/u.exec(raw);
  if (match !== null) return match[0].slice(0, 180);
  const validation = /^GATE0A_LOCAL_VALIDATION_REJECTED:([A-Z0-9_]+)/u.exec(raw);
  if (validation !== null) {
    return `BLOCKED_COMPILER_PATH:GATE0A_LOCAL_VALIDATION_REJECTED:${validation[1]}`.slice(0, 180);
  }
  const appServer = /^(APP_SERVER_[A-Z0-9_]+)(?::([A-Za-z0-9_/-]+))?/u.exec(raw);
  if (appServer !== null) {
    const detail = appServer[2]
      ?.toUpperCase()
      .replace(/[^A-Z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "");
    return `BLOCKED_COMPILER_PATH:${appServer[1]}${detail === undefined || detail.length === 0 ? "" : `:${detail}`}`.slice(0, 180);
  }
  return "BLOCKED_NATIVE_HOST:UNKNOWN";
}

interface NativeMessageReadState {
  buffered: Buffer;
}

async function readExactly(
  input: Readable,
  length: number,
  eofCode: "HEADER_EOF" | "PAYLOAD_EOF",
  deadline: number,
  state: NativeMessageReadState,
): Promise<Buffer> {
  return new Promise<Buffer>((resolveRead, rejectRead) => {
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timeout);
      input.off("readable", drain);
      input.off("end", onEnd);
      input.off("error", onError);
    };
    const fail = (code: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectRead(new Error(`BLOCKED_NATIVE_PROTOCOL:${code}`));
    };
    const succeed = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      const result = Buffer.from(state.buffered.subarray(0, length));
      state.buffered = Buffer.from(state.buffered.subarray(length));
      resolveRead(result);
    };
    function drain(): void {
      while (state.buffered.byteLength < length) {
        const chunk = input.read() as Buffer | Uint8Array | string | null;
        if (chunk === null) break;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        state.buffered = Buffer.concat([state.buffered, bytes]);
      }
      if (state.buffered.byteLength >= length) {
        succeed();
      } else if (input.readableEnded) {
        fail(eofCode);
      }
    }
    function onEnd(): void {
      drain();
      if (state.buffered.byteLength < length) fail(eofCode);
    }
    function onError(): void {
      fail("FRAME_READ");
    }

    const remainingMs = Math.max(1, deadline - Date.now());
    const timeout = setTimeout(() => fail("FRAME_READ_TIMEOUT"), remainingMs);
    input.on("readable", drain);
    input.once("end", onEnd);
    input.once("error", onError);
    drain();
  });
}

export async function readNativeMessage(
  input: Readable,
  options: NativeMessageReadOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? nativeProtocol.frame_read_timeout_ms;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("BLOCKED_NATIVE_PROTOCOL:FRAME_READ_TIMEOUT");
  }
  const deadline = Date.now() + timeoutMs;
  const state: NativeMessageReadState = { buffered: Buffer.alloc(0) };
  try {
    const header = await readExactly(input, 4, "HEADER_EOF", deadline, state);
    const length = header.readUInt32LE(0);
    if (length === 0 || length > nativeProtocol.max_request_bytes) {
      throw new Error("BLOCKED_NATIVE_PROTOCOL:FRAME_LENGTH_INVALID");
    }
    const payload = await readExactly(input, length, "PAYLOAD_EOF", deadline, state);
    let value: unknown;
    try {
      value = JSON.parse(payload.toString("utf8")) as unknown;
    } catch {
      throw new Error("BLOCKED_NATIVE_PROTOCOL:JSON");
    }
    return value;
  } finally {
    input.destroy();
  }
}

export function encodeNativeMessage(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.byteLength === 0 || payload.byteLength > nativeProtocol.max_response_bytes) {
    throw new Error("BLOCKED_NATIVE_PROTOCOL:RESPONSE_TOO_LARGE");
  }
  const frame = Buffer.allocUnsafe(payload.byteLength + 4);
  frame.writeUInt32LE(payload.byteLength, 0);
  payload.copy(frame, 4);
  return frame;
}

export function parseNativeRequest(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BLOCKED_NATIVE_PROTOCOL:REQUEST_SHAPE");
  }
  const request = value as Record<string, unknown>;
  if (request.schema_version !== nativeProtocol.schema_version || typeof request.kind !== "string") {
    throw new Error("BLOCKED_NATIVE_PROTOCOL:REQUEST_IDENTITY");
  }
  const fields: Record<string, readonly string[]> = {
    compile: ["schema_version", "kind", "capture"],
    "restore-ready-card": ["schema_version", "kind"],
    "prepare-confirm": ["schema_version", "kind", "challenge", "challenge_token"],
    confirm: ["schema_version", "kind", "challenge", "challenge_token", "jit_binding", "jit_token"],
    dispatch: ["schema_version", "kind", "activation_id"],
    resume: ["schema_version", "kind", "activation_id"],
    status: ["schema_version", "kind", "request_digest"],
    "registration-readback": ["schema_version", "kind"],
    "test-confirm-fault": ["schema_version", "kind", "challenge", "challenge_token", "fault"],
  };
  const expected = fields[request.kind];
  if (expected === undefined) {
    throw new Error("BLOCKED_NATIVE_PROTOCOL:REQUEST_KIND");
  }
  const actual = Object.keys(request).sort();
  const wanted = [...expected].sort();
  if (request.kind === "confirm") {
    const direct = ["schema_version", "kind", "challenge", "challenge_token"].sort();
    if (actual.length === direct.length && actual.every((key, index) => key === direct[index])) {
      return request;
    }
  }
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error("BLOCKED_NATIVE_PROTOCOL:ADDITIONAL_PROPERTIES");
  }
  if (
    request.kind === "confirm" &&
    (
      typeof request.jit_token !== "string" ||
      request.jit_binding === null ||
      typeof request.jit_binding !== "object" ||
      Array.isArray(request.jit_binding)
    )
  ) {
    throw new Error("BLOCKED_NATIVE_PROTOCOL:JIT_CONFIRMATION");
  }
  return request;
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { setImmediate as waitImmediate } from "node:timers/promises";
import test from "node:test";
import { slice3aExtensionOrigin } from "../src/intake/store.js";
import {
  encodeNativeMessage,
  nativeProtocol,
  readNativeMessage,
} from "../src/native/protocol.js";

const schemaVersion = nativeProtocol.schema_version;

function decodeNativeResponse(frame: Buffer): Record<string, unknown> {
  assert.ok(frame.byteLength >= 4);
  const length = frame.readUInt32LE(0);
  assert.equal(frame.byteLength, length + 4);
  return JSON.parse(frame.subarray(4).toString("utf8")) as Record<string, unknown>;
}

async function runDirectHost(
  cwd: string,
  message: unknown | null,
  closeStdin: boolean,
): Promise<{ readonly pid: number; readonly response: Record<string, unknown> }> {
  const host = join(cwd, "dist", "src", "native", "host.js");
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [host, slice3aExtensionOrigin], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    assert.notEqual(child.pid, undefined);
    const childPid = child.pid!;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => rejectRun(new Error(`TEST_NATIVE_HOST_TIMEOUT:${childPid}`)));
    }, nativeProtocol.frame_read_timeout_ms + 7_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on("error", () => {});
    child.once("error", (error) => finish(() => rejectRun(error)));
    child.once("exit", (code) => finish(() => {
      if (code !== 0) {
        rejectRun(new Error(`NATIVE_HOST_EXIT:${code}:${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      assert.equal(Buffer.concat(stderr).toString("utf8"), "");
      resolveRun({ pid: childPid, response: decodeNativeResponse(Buffer.concat(stdout)) });
    }));
    if (message !== null) {
      const frame = encodeNativeMessage(message);
      if (closeStdin) child.stdin.end(frame);
      else child.stdin.write(frame);
    }
  });
}

function stageRuntime(name: string): string {
  const root = join(process.cwd(), ".ados-local", "test", `native-protocol-${name}-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  cpSync(join(process.cwd(), "migrations"), join(root, "migrations"), { recursive: true });
  cpSync(join(process.cwd(), "vendor"), join(root, "vendor"), { recursive: true });
  cpSync(join(process.cwd(), "dist", "src"), join(root, "dist", "src"), { recursive: true });
  return root;
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(path, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    if (!server.listening) {
      resolveClose();
      return;
    }
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

function pipeUnavailable(path: string): Promise<boolean> {
  return new Promise((resolveCheck) => {
    const socket = connect(path);
    socket.once("connect", () => {
      socket.destroy();
      resolveCheck(false);
    });
    socket.once("error", () => resolveCheck(true));
  });
}

test("complete native frame returns while stdin remains open", async () => {
  const message = { schema_version: schemaVersion, kind: "status", request_digest: null };
  const input = new PassThrough();
  const pending = readNativeMessage(input, { timeoutMs: 1_000 });
  input.write(encodeNativeMessage(message));
  assert.deepEqual(await pending, message);
  assert.equal(input.destroyed, true);
});

test("fragmented header and payload complete without stdin EOF", async () => {
  const message = { schema_version: schemaVersion, kind: "status", request_digest: null };
  const frame = encodeNativeMessage(message);
  const input = new PassThrough();
  const pending = readNativeMessage(input, { timeoutMs: 1_000 });
  input.write(frame.subarray(0, 2));
  await waitImmediate();
  input.write(frame.subarray(2, 4));
  await waitImmediate();
  input.write(frame.subarray(4, 11));
  await waitImmediate();
  input.write(frame.subarray(11));
  assert.deepEqual(await pending, message);
  assert.equal(input.destroyed, true);
});

test("native frame read fails closed with exact EOF, length, and timeout blockers", async () => {
  await assert.rejects(
    readNativeMessage(Readable.from([Buffer.from([1, 0])]), { timeoutMs: 1_000 }),
    /BLOCKED_NATIVE_PROTOCOL:HEADER_EOF/u,
  );

  const partialPayload = Buffer.alloc(6);
  partialPayload.writeUInt32LE(4, 0);
  partialPayload.writeUInt16LE(0x7b22, 4);
  await assert.rejects(
    readNativeMessage(Readable.from([partialPayload]), { timeoutMs: 1_000 }),
    /BLOCKED_NATIVE_PROTOCOL:PAYLOAD_EOF/u,
  );

  const zeroLength = Buffer.alloc(4);
  await assert.rejects(
    readNativeMessage(Readable.from([zeroLength]), { timeoutMs: 1_000 }),
    /BLOCKED_NATIVE_PROTOCOL:FRAME_LENGTH_INVALID/u,
  );

  const oversized = Buffer.alloc(4);
  oversized.writeUInt32LE(nativeProtocol.max_request_bytes + 1, 0);
  await assert.rejects(
    readNativeMessage(Readable.from([oversized]), { timeoutMs: 1_000 }),
    /BLOCKED_NATIVE_PROTOCOL:FRAME_LENGTH_INVALID/u,
  );

  const stalled = new PassThrough();
  await assert.rejects(
    readNativeMessage(stalled, { timeoutMs: 25 }),
    /BLOCKED_NATIVE_PROTOCOL:FRAME_READ_TIMEOUT/u,
  );
  assert.equal(stalled.destroyed, true);

  const stalledPayload = new PassThrough();
  const stalledPayloadRead = readNativeMessage(stalledPayload, { timeoutMs: 25 });
  const partialOpenFrame = Buffer.alloc(6);
  partialOpenFrame.writeUInt32LE(4, 0);
  partialOpenFrame.writeUInt16LE(0x7b22, 4);
  stalledPayload.write(partialOpenFrame);
  await assert.rejects(
    stalledPayloadRead,
    /BLOCKED_NATIVE_PROTOCOL:FRAME_READ_TIMEOUT/u,
  );
  assert.equal(stalledPayload.destroyed, true);
});

test("one-shot Host handles status, compile, and confirm without stdin EOF", { skip: process.platform !== "win32" ? "Requires the Windows Native Host / npm.cmd profile" : false }, async () => {
  const root = stageRuntime("request-kinds");
  try {
    const messages = [
      { schema_version: schemaVersion, kind: "status", request_digest: null },
      { schema_version: schemaVersion, kind: "compile", capture: null },
      { schema_version: schemaVersion, kind: "confirm", challenge: {}, challenge_token: "invalid" },
    ];
    for (const message of messages) {
      const result = await runDirectHost(root, message, false);
      assert.equal(typeof result.response.ok, "boolean", message.kind);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stdin.end(frame) remains a supported one-shot success path", { skip: process.platform !== "win32" ? "Requires the Windows Native Host / npm.cmd profile" : false }, async () => {
  const root = stageRuntime("stdin-end");
  try {
    const result = await runDirectHost(
      root,
      { schema_version: schemaVersion, kind: "status", request_digest: null },
      true,
    );
    assert.equal(result.response.ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Host frame timeout exits one-shot process with the exact blocker", { skip: process.platform !== "win32" ? "Requires the Windows Native Host / npm.cmd profile" : false }, async () => {
  const root = stageRuntime("timeout");
  try {
    const result = await runDirectHost(root, null, false);
    assert.equal(result.response.ok, false);
    assert.equal(result.response.error, "BLOCKED_NATIVE_PROTOCOL:FRAME_READ_TIMEOUT");
    assert.throws(() => process.kill(result.pid, 0));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wrapper timeout closes Host and releases both Chrome-equivalent named pipes", { skip: process.platform !== "win32" }, async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const inputPath = `\\\\.\\pipe\\ados-slice3a-input-${suffix}`;
  const outputPath = `\\\\.\\pipe\\ados-slice3a-output-${suffix}`;
  let inputSocket: Socket | undefined;
  let outputSocket: Socket | undefined;
  const inputServer = createServer((socket) => {
    inputSocket = socket;
    const partialOpenFrame = Buffer.alloc(6);
    partialOpenFrame.writeUInt32LE(4, 0);
    partialOpenFrame.writeUInt16LE(0x7b22, 4);
    socket.write(partialOpenFrame);
  });
  const output: Buffer[] = [];
  let resolveOutput!: () => void;
  let rejectOutput!: (error: Error) => void;
  const outputEnded = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveOutput = resolvePromise;
    rejectOutput = rejectPromise;
  });
  const outputServer = createServer((socket) => {
    outputSocket = socket;
    socket.on("data", (chunk: Buffer) => output.push(chunk));
    socket.once("end", resolveOutput);
    socket.once("error", rejectOutput);
  });
  await Promise.all([listen(inputServer, inputPath), listen(outputServer, outputPath)]);
  const launcher = join(process.cwd(), "native-host", "ados-local-slice3a.cmd");
  const command = `${launcher} ${slice3aExtensionOrigin} < ${inputPath} > ${outputPath}`;
  const wrapper = spawn("C:\\Windows\\System32\\cmd.exe", ["/d", "/s", "/c", command], {
    cwd: process.cwd(),
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  assert.notEqual(wrapper.pid, undefined);
  const stderr: Buffer[] = [];
  wrapper.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  try {
    const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timeout = setTimeout(() => {
        wrapper.kill();
        rejectExit(new Error(`TEST_NATIVE_WRAPPER_TIMEOUT:${wrapper.pid}`));
      }, nativeProtocol.frame_read_timeout_ms + 7_000);
      wrapper.once("error", (error) => {
        clearTimeout(timeout);
        rejectExit(error);
      });
      wrapper.once("exit", (code) => {
        clearTimeout(timeout);
        resolveExit(code);
      });
    });
    await outputEnded;
    assert.equal(exitCode, 0);
    assert.equal(Buffer.concat(stderr).toString("utf8"), "");
    const response = decodeNativeResponse(Buffer.concat(output));
    assert.equal(response.ok, false);
    assert.equal(response.error, "BLOCKED_NATIVE_PROTOCOL:FRAME_READ_TIMEOUT");
    assert.throws(() => process.kill(wrapper.pid!, 0));
  } finally {
    inputSocket?.destroy();
    outputSocket?.destroy();
    await Promise.all([closeServer(inputServer), closeServer(outputServer)]);
  }
  assert.equal(await pipeUnavailable(inputPath), true);
  assert.equal(await pipeUnavailable(outputPath), true);
});

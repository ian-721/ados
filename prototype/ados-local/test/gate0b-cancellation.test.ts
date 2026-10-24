import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  newDescendantRootPids,
  terminateWindowsProcessTree,
} from "../src/gates/gate0b.js";

test("Gate 0B cancellation identifies only new descendant roots", () => {
  const baseline = [
    { pid: 100, parent_pid: 1, name: "codex.exe", created_utc: null },
    { pid: 101, parent_pid: 100, name: "existing.exe", created_utc: null },
  ];
  const current = [
    ...baseline,
    { pid: 200, parent_pid: 100, name: "powershell.exe", created_utc: null },
    { pid: 201, parent_pid: 200, name: "conhost.exe", created_utc: null },
    { pid: 300, parent_pid: 100, name: "helper.exe", created_utc: null },
  ];

  assert.deepEqual(newDescendantRootPids(baseline, current, 100), [200, 300]);
});

test("Gate 0B cancellation terminates a delayed mutation process tree", async (context) => {
  if (process.platform !== "win32") {
    context.skip("Windows-only Gate 0B profile");
    return;
  }
  const root = resolve(".ados-local", "test", "gate0b-cancellation");
  const marker = resolve(root, "post-cancel-marker.txt");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const child = spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Start-Sleep -Milliseconds 1500; Set-Content -LiteralPath $env:ADOS_CANCEL_MARKER -Value forbidden -NoNewline",
    ],
    {
      cwd: root,
      env: { ...process.env, ADOS_CANCEL_MARKER: marker },
      stdio: "ignore",
      windowsHide: true,
    },
  );
  assert.notEqual(child.pid, undefined);

  try {
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 200));
    terminateWindowsProcessTree(child.pid!);
    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([
        once(child, "exit"),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("TEST_PROCESS_EXIT_TIMEOUT")), 3_000)
        ),
      ]);
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 1_600));
    assert.equal(existsSync(marker), false);
  } finally {
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      terminateWindowsProcessTree(child.pid);
    }
    rmSync(root, { recursive: true, force: true });
  }
});

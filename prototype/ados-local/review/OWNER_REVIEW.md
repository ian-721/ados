# ADOS Local — revised local candidate review

**State: OWNER_REVIEW. Candidate ready for Owner experience review; publication is not approved.**

Revision date: 2026-10-24 (Australia/Sydney). The Owner authorized a minimal `fast-uri` fix and renewed clean validation of candidate `d8c3aa8`. This report is the current authoritative result and supersedes that candidate's report. Earlier results remain in local Git history; no historical Windows or real-product acceptance is inherited.

**Resolved finding:** only `fast-uri` changed, from **3.1.5 to 3.1.9**. The fresh `npm audit --json` returned **exit 0, zero known vulnerabilities**, covering production and development dependencies. The earlier high-severity finding is resolved in this lockfile. This result does not certify the whole system secure or prove the live Windows integration.

## Candidate identity and exact change

| Item | Value |
| --- | --- |
| Read-only source | `ian-721/ados-local@38a70a666ac620450757cff14e8b568a88587e1c` |
| Target public base | `ian-721/ados@8bf7ad17bf812a9f29de15bc88e7b4c3cd208e21` |
| Local revision base / prior candidate | `d8c3aa80db39cbdcae9bc23cc5440142ff16db54` |
| Local branch | `candidate/ados-local-plan-b` |
| Candidate directory | `prototype/ados-local/` |
| Verified runtime payload SHA-256 | `e7b0a7a5e82b08bd9559fe3003c30558807c666da4d783e1263493fcca33a127` |

The final local HEAD is identified in the delivery message and ZIP comment; a commit cannot contain its own hash. [RUNTIME_PAYLOAD.json](RUNTIME_PAYLOAD.json) records the tested file bytes. Its digest is SHA-256 of sorted UTF-8 `path + NUL + sha256 + LF` entries. Only `package-lock.json` differs in that payload from `d8c3aa8`; later report/inventory edits do not change the tested implementation.

The implementation change is exactly **three fields in `node_modules/fast-uri` inside `package-lock.json`: version, resolved URL and integrity**. The existing `ajv@8.20.0` dependency range `^3.0.1` already accepts 3.1.9, so no direct dependency, override or new package was needed. All other lock entries and `package.json` are identical to `d8c3aa8`. The clean install's 49 package versions were checked against the revised lock. Registry metadata and npm's integrity-checked installation identify the published 3.1.9 package.

Application source, tests, migrations, extension, Native Host, scripts, public Fixture/binding versions and all protocol snapshots remain byte-identical to `d8c3aa8`. No architecture, authorization level, allowlist, strict comparison, `private: true` Forge restriction, cancellation, fencing or rejection behavior was edited. No test skip was added or relaxed. Current documentation, validation evidence and inventories are refreshed for the dependency fix.

## Source preservation and isolation

The fixed source has **131 files / 1,210,425 bytes**, previously fetched and individually verified against Git blob SHA and size. The current disposition is **59 identical Git blobs, 54 binding/environment/documentation adaptations, one approved lockfile fix, one replaced README and 16 excluded internal instruction/report documents**. All implementation source, original tests, six migrations, extension, Native Host and registration scripts remain present. The public Host template retains its renamed path. Private Git history, live task/approval records, device secrets, credentials and runtime databases are excluded.

The nine vendored contracts/schemas retain source Git blob identity and the original manifest hashes. Those hashes describe CRLF checkout bytes, preserved by `.gitattributes` and the exported ZIP. Protocol versions and file hashes remain frozen. Only the prior Plan B copy's historical approval/installation manifest metadata was removed. Original `package.json` and `.node-version` bytes remain unchanged; the sole source lockfile exception is the approved `fast-uri` patch.

Use a fresh runtime database. The approved public bindings and migration constants do not migrate old private Runs. `fixture.invalid/...` remains deliberately non-live, and no GitHub fixture repository is provisioned.

## Clean-environment verification

A new checkout was populated from the revised staged source with **no prior `node_modules`, compiled output or runtime data**. Runtime: **Linux x64, Node 22.23.1, npm 10.9.8, TypeScript 6.0.3, Node ABI 127, better-sqlite3 12.11.1, SQLite 3.53.2, fast-uri 3.1.9**. The Node archive matches its official checksum. The unchanged Linux SQLite prebuild was installed from the official cached asset; its installed bytes match the recorded archive payload. No native compilation was used.

This is a clean project install; npm download caches were allowed. `npm ci --ignore-scripts` deliberately avoids installation hooks, followed by the explicit prebuild-only command below. [Runtime provenance](evidence/runtime-provenance.json) records the hashes and dependency change; [prebuild-download.log](evidence/prebuild-download.log) is explicitly the earlier runtime-provisioning download, while `clean-prebuild.log` records this revision's installation. All checks below ran anew on the revised dependency. Exact UTC start/end timestamps and exit codes are in [REVIEW_FACTS.json](REVIEW_FACTS.json).

Commands run from `prototype/ados-local/` unless noted. Each reported exit code is observed, including the audit.

| Check | Exit | Result | Evidence |
| --- | ---: | --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | 0 | 49 locked packages installed; fast-uri 3.1.9 | [install](evidence/clean-install.log) |
| In `node_modules/better-sqlite3`: `node ../prebuild-install/bin.js --verbose` | 0 | Official Linux x64 ABI 127 prebuild; no compile fallback | [prebuild](evidence/clean-prebuild.log) |
| `npm run typecheck` | 0 | PASS | [typecheck](evidence/clean-typecheck.log) |
| `npm run build` | 0 | PASS | [build](evidence/clean-build.log) |
| `npm test` | 0 | **94 total: 86 pass, 0 fail, 8 skip** | [complete TAP](evidence/clean-tests-complete.log) |
| `node --test 'browser-extension/*.test.js'` | 0 | **20 pass, 0 fail, 0 skip** | [extension TAP](evidence/clean-extension-tests.log) |
| `node dist/src/cli/index.js verify-contracts` | 0 | Nine snapshot hashes and strict contract fixtures pass | [log](evidence/demo-verify-contracts.log), [JSON](evidence/verify-contracts.json) |
| `node dist/src/cli/index.js walking-skeleton` | 0 | Real local SQLite and verifier processes; fake executor; simulated T4 | [log](evidence/demo-walking-skeleton.log), [JSON](evidence/walking-skeleton.json) |
| `node dist/src/cli/index.js forged-approval` | 0 | Forged, mutated and replayed approval rejected atomically | [log](evidence/demo-forged-approval.log), [JSON](evidence/forged-approval.json) |
| `node dist/src/cli/index.js false-completion` | 0 | T0 claim cannot satisfy T2 or close DONE; no added event | [log](evidence/demo-false-completion.log), [JSON](evidence/false-completion.json) |
| `node dist/src/cli/index.js cancel` | 0 | CANCELLED revokes lease and rejects later mutation without an event | [log](evidence/demo-cancel.log), [JSON](evidence/cancel.json) |
| `node dist/src/cli/index.js scope-violation` | 0 | Forbidden, traversal and unlisted paths denied before mutation | [log](evidence/demo-scope-violation.log), [JSON](evidence/scope-violation.json) |
| `node dist/src/cli/index.js invalid-transition` | 0 | PREPARED → OWNER_REVIEW rejected; events/projection unchanged | [log](evidence/demo-invalid-transition.log), [JSON](evidence/invalid-transition.json) |
| `npm audit --json` | 0 | **0 known vulnerabilities**, production and development dependencies | [audit](evidence/dependency-audit.json) |

The full suite includes the existing public binding/drift tests and safety cases. No production-source or test-file changes followed validation. Unlike the prior candidate, this revision's complete suite covers the final output text as well. No extra lifecycle-only result substitutes for the full run.

## Exact Windows SKIP reasons

All eight skips are triggered by the existing `process.platform !== "win32"` condition on this Linux host, not by a caught test failure. They remain **unverified, not passed**. Four Native Host tests retain the broad TAP label “Requires the Windows Native Host / npm.cmd profile”; their precise blocker is the Host startup identity check at `src/native/host.ts:180`, which requires **Node v22.23.1 + win32 + x64** before reading or dispatching any frame.

| TAP test / source location | What could not run and why |
| --- | --- |
| 34 — `test/gate0b-cancellation.test.ts:27` — delayed-mutation process-tree cancellation | Uses `powershell.exe` to schedule the mutation and `taskkill.exe /T /F` through `terminateWindowsProcessTree`. Linux cannot verify Windows descendant termination or post-cancel absence of that mutation. TAP: `Windows-only Gate 0B profile`. |
| 44 — `test/native-protocol.test.ts:187` — status/compile/confirm without stdin EOF | Starts the real Native Host. On Linux its runtime identity check rejects before message handling, so successful one-shot handling cannot be established. |
| 45 — `test/native-protocol.test.ts:204` — `stdin.end(frame)` success | Same real-Host runtime identity rejection; closing stdin does not bypass it. The valid Windows response is unverified. |
| 46 — `test/native-protocol.test.ts:218` — exact frame-timeout blocker | Same real-Host runtime identity rejection occurs before frame read, so Linux cannot establish the expected Host timeout path. Portable frame-reader timeout tests still execute separately. |
| 47 — `test/native-protocol.test.ts:230` — wrapper timeout / both named pipes released | Requires `C:\Windows\System32\cmd.exe`, the `.cmd` launcher and `\\.\pipe\...` Windows named pipes. Its existing skip flag is boolean, so TAP prints only `# SKIP`; this source-level reason explains the empty label. |
| 64 — `test/slice3a.test.ts:1049` — concurrent Hosts reconcile one Receipt/Activation | Spawns two real Native Hosts, both subject to the same win32/x64/Node identity check. Linux cannot exercise this two-process Host path; portable storage/intake tests are separate results. |
| 75 — `test/slice4.test.ts:148` — bounded `npm.cmd` launcher | Exercises Windows `.cmd` execution through `ComSpec`/`cmd.exe`. Running Linux `npm` would test a different branch. TAP uses the inherited broad Windows Host / npm.cmd label. |
| 80 — `test/storage.test.ts:14` — frozen Windows SQLite addon SHA | Expected SHA is `c4b95a94a963258a9ef41b12fd3bb86f0b08a2ac5c5b499fe94de57a5443682d` for the Windows x64 prebuild. Linux loads a different binary; replacing the expected SHA with the observed Linux hash would weaken the identity check. Portable SQLite invariants still pass separately. |

Synthetic Forge observations and Windows corpus records in tests are inputs, not observations from live providers or Windows. The historical report generator and Gate 0 reports contain fixed PASS narratives; they were not run or used to support this report. No live Codex, Chrome, HKCU or Forge result is inferred from synthetic evidence.

## Residual risks and review boundary

| Item | Current status and implication |
| --- | --- |
| fast-uri dependency finding | **RESOLVED for the known registry advisories at validation time.** Previously 3.1.5, one affected package / highest severity high / ten advisory entries; now 3.1.9 and audit exit 0 with zero findings. Unknown vulnerabilities and future advisories remain outside this result. |
| Native dependency maintenance | `prebuild-install@7.1.3` still emits a deprecation/unmaintained warning. It was not upgraded: unrelated dependency modernization is outside this revision. |
| Windows / Chrome integration | **NOT_RUN**: the eight tests above, HKCU registration, actual Chrome Native Messaging and current ChatGPT DOM capture. No claim of Windows install success. |
| Fixed installation identity | Still requires `C:\ADOS-Public-Fixture\prototype\ados-local`, extension `fpmliiakgebgdlgaddocgddllidmkomd` and Host `org.ados.public_fixture.slice3a`. Exact manifest/launcher hashes remain strict. This is not a general portable installer. |
| Live Codex / Forge delivery | **NOT_RUN**. Exact Codex binary/version checks remain; current availability/behavior is unverified. Non-live `fixture.invalid/...` cannot provide the complete Chrome → Codex → Forge path without a separately reviewed real environment binding. |
| Real-product Dogfood | **NOT_RUN**. The synthetic demo reaches OWNER_REVIEW and then simulates T4/DONE; it does not accept a real Objective, establish real usefulness or complete Owner experience review. |
| Privacy | Prior Plan B redactions are retained. Export remains limited to tracked candidate files and synthetic evidence; private removal content, runtime databases, secrets and private Git history are excluded. Pattern checks are not proof of absence of every possible secret. |
| License review | Project source uses the parent Apache-2.0 license. Dependency license declarations are inventoried; fast-uri remains BSD-3-Clause. No dependency/native binaries are bundled. This is not a legal audit. |

## Review artifacts and release boundary

- [Complete candidate inventory](CANDIDATE_FILE_INVENTORY.csv): every tracked file in the delivered target checkout with checkout size/SHA-256 and Git blob SHA; its own row is marked SELF.
- [Source inventory](SOURCE_FILE_INVENTORY.csv): all 131 original paths, source identity, current destination and disposition.
- [Redaction changes](REDACTION_CHANGES.md) and [sanitized inspection diff](REDACTION_DIFF.patch): all adapted source locations, including the approved lockfile fix. Removed source lines/context are omitted to avoid republishing private records; this is not an applyable patch.
- [Machine-readable verification](REVIEW_FACTS.json), [runtime payload](RUNTIME_PAYLOAD.json), [privacy results](PRIVACY_SCAN.json), [dependency licenses](DEPENDENCY_LICENSES.csv).
- [Observed synthetic demo](../docs/OWNER_DEMO.md), [English README](../README.md), [中文 README](../README.zh-CN.md).

Current logs replace earlier command evidence. Workspace/cache paths are sanitized; synthetic record clocks are deterministic fixture timestamps, while command execution timestamps are recorded separately in UTC. The retained prebuild download log is historical provenance, explicitly labeled above. [Remote-state evidence](evidence/remote-state.json) records the prior read-only check; this dependency revision performed no remote repository operation.

All changes are local to `candidate/ados-local-plan-b`. No push, public PR, merge, Release, private-main or visibility change occurred. The local origin push URL remains disabled. The ZIP is an Owner review artifact. **Remain at OWNER_REVIEW, awaiting Owner experience review and explicit publication approval.**

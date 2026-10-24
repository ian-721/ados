# ADOS Local — complete prototype source

[中文](README.zh-CN.md) · [ADOS overview](../../README.md) · [Pre-publication validation](review/OWNER_REVIEW.md)

This directory contains the complete executable ADOS Local prototype source: the TypeScript coordinator, SQLite event store and six migrations, contract compiler and validators, execution/Forge adapters, browser extension, Windows Native Host, tests, and nine pinned protocol snapshots. It is an independent, sanitized distribution of the fixed implementation snapshot identified in the review report. Private Git history, historical task/approval records, device identities, credentials and runtime databases are excluded.

**Status: published complete prototype source.** The Owner reviewed and approved candidate `75f5c44a5aa2cd894bd6c62c2efab547255f136d` for public distribution on 25 October 2026. The offline synthetic paths are reproducible; a real-product Dogfood and a new Windows/Chrome/Codex/GitHub end-to-end run have not been completed for this distribution. Publication approval does not establish production readiness or real-product acceptance.

The review reports, inventories and captured demo output preserve the accepted candidate's pre-publication state, including its earlier OWNER_REVIEW wording. Publication changes only the entry READMEs and STATUS page; the verified implementation and dependency lockfile are unchanged. See [current status](../../docs/STATUS.md).

**Dependency fix:** the approved revision updates only transitive dependency `fast-uri` from `3.1.5` to `3.1.9` in the lockfile. A fresh install and full regression run completed; `npm audit` reports **0 known vulnerabilities** at validation time. This is not a security certification. Windows integration and real-product Dogfood remain unverified; see the review report.

## What is implemented

| Source | Responsibility |
| --- | --- |
| `src/compiler`, `src/capture`, `src/intake` | Selected-turn capture, untrusted model-output validation, Delivery Cards, signed confirmation and durable intake |
| `src/storage`, `migrations` | SQLite transactions, append-only events, projections, leases, fencing, outbox, backup and recovery |
| `src/coordinator`, `src/profiles`, `src/resolver` | Bounded execution, fixed project/host identities, Forge readback and reconciliation |
| `src/safety/slice4`, `src/verifiers` | Identity/authority/scope rejection, evidence-derived safety cards and separate verifier processes |
| `browser-extension`, `native-host`, `scripts` | Chrome side panel, selected-message parser, Native Messaging and Windows registration |
| `vendor/ados`, `test` | Frozen protocol files and implementation regressions |

The architecture and permission checks are retained. Publication changes are limited to synthetic identities, their versions/digests, installation binding, platform-specific test declarations, the approved `fast-uri` patch upgrade and documentation. The exact changes and exclusions are listed in `review/`.

## Run the offline prototype

Use **Node 22.23.1**, npm **10.9.x**, and Git. `better-sqlite3@12.11.1` is the only native addon. Install its official prebuilt binary; stop if no compatible binary is available. Do not use a local `node-gyp` build as a substitute for the pinned runtime.

From this directory, in PowerShell:

```powershell
npm ci --ignore-scripts
Push-Location node_modules/better-sqlite3
node ../prebuild-install/bin.js
Pop-Location
npm run typecheck
npm run build
npm test
node --test "browser-extension/*.test.js"
npm run verify:contracts
npm run demo:walking-skeleton
```

On Linux, replace `Push-Location ...` / `Pop-Location` with `cd node_modules/better-sqlite3` / `cd ../..`. Run each command only after the previous command succeeds. The separate `prebuild-install` invocation has no native-compilation fallback; `npm ci --ignore-scripts` also avoids running package install hooks. Keep `package.json`, `package-lock.json` and `.node-version` unchanged.

Use a fresh checkout and a new `.ados-local/` directory. Never copy a private installation's database, device key or approval records. Public binding versions end in `-public.1`; their migration checksums and identities intentionally differ from private installations. This is not a database migration for old Runs.

The walking-skeleton demo uses a fake executor but real SQLite transactions and emitted verifier processes. It reaches `OWNER_REVIEW`, then exercises an explicitly **simulated** T4 acceptance to reach `DONE`. That final state belongs only to the synthetic fixture. Its JSON evidence is under `.ados-local/evidence/`; no real Objective is accepted or published.

Other offline commands include `demo:duplicate`, `demo:crash-recovery`, `demo:forged-approval`, `demo:false-completion`, `demo:cancel`, `demo:scope-violation`, `demo:invalid-transition`, `demo:storage-integrity`, `demo:storage-rebuild` and `demo:storage-backup-restore`.

## Fixture and environment isolation

`fixtures/public-bindings.json` contains synthetic capture/candidate/request/card records and the preimages for their fixed digests. It contains no device secret, signed challenge token or real approval. Tests rederive these bindings using the original production validators and record builders. Synthetic Git-style revision labels are fixture identifiers, not claims that remote commits exist.

`fixture.invalid/...` references are intentionally non-live. No GitHub repository is provisioned by this package. The original Forge requirement for one exact **private** fixture repository remains in place. Public source availability does not authorize public repository writes, and changing that restriction requires a separate decision.

The nine protocol snapshots are unchanged as Git blobs. Their original manifest hashes describe CRLF checkout bytes; `.gitattributes` explicitly preserves that format on every platform. Archives must retain the provided line endings. The manifest's historical approval/installation metadata was removed; protocol versions and file hashes were not changed.

## Windows integration limits

The integrated Native Host is still **Windows x64 / Node 22.23.1 only**, using Chrome Native Messaging and `HKCU` Registry64. Registration rejects administrator execution, collisions and layout drift. The public fixture uses its own extension public key/origin and Host name, so it does not reuse the private installation identity.

Its fixed installation layout is `C:\ADOS-Public-Fixture\prototype\ados-local`. The checked-in expected manifest is `fixtures/public-native-host-manifest.json`; its bytes and the launcher bytes are pinned in admission. Moving the directory causes rejection. This explicit fixture layout is not a general installer or cross-device portability mechanism.

Do not run `native:slice3a-register` as part of the offline quickstart. It writes the current user's registry and requires the fixed Windows layout. `native:slice3a-unregister` is the corresponding removal path. Neither registration nor actual Chrome-to-Host operation has been verified for this distribution.

The live compiler/executor retains exact Codex binary/version checks, including `codex-cli 0.147.0-alpha.1.2` for the later path and `0.146.0-alpha.9.2` for the earlier path. Availability and behavior of those binaries are not established by this distribution. Unknown binaries remain rejected; no automatic upgrade or trust-on-first-use was added.

`demo:gate0a`, `demo:gate0a-card`, `demo:gate0b`, `demo:slice2*`, `demo:slice3b-dispatch/resume`, `demo:slice4-safety-card`, and the historical `reports` command are **not offline setup commands**. They require their original class of live environment/evidence, and some execution paths can write Git/GitHub effects after authorization. The non-live fixture references do not make them independently runnable. `demo:gate0s` / `verify:storage` retain the Windows-specific binary gate.

## What the evidence establishes

See [OWNER_REVIEW.md](review/OWNER_REVIEW.md) for the exact environment, commands, exit codes, test totals, skips and remaining limitations. Linux tests exercise local storage/recovery, production denial functions, semantic validation, parser fixtures and framing. Injected compilers, fabricated Forge observations and Safety Card corpora are labeled synthetic; their contents are not observations from a live provider or Windows run.

The first real-product Dogfood, live browser capture against the current ChatGPT UI, Windows process-tree cancellation, end-to-end Codex execution/Forge publication, general portability and reduced human workload remain unverified. The [threat model](docs/THREAT_MODEL.md) describes implemented control intentions, not an independent security certification.

## License

Included project code and documentation are covered by the repository's [Apache-2.0 license](../../LICENSE). Dependencies retain their own licenses and are not bundled in the source distribution. Private history, excluded records and external publications are not included in this grant. `private: true` remains in `package.json` to prevent accidental npm publication.

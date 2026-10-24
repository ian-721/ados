# ADOS Local Threat Model

## Protected authorities

Owner authorization, Objective fields and status, Harness/base pin, Run Envelope, Receipt binding, obligations, candidate identity, completion, merge, release, and deployment are protected. A model, Agent, Profile, fixture, or local database cannot grant or rewrite them.

## Threats and controls

| Threat | Control |
| --- | --- |
| Forged, mutated, or replayed Owner Receipt | Strict action/authorization/request/Owner-turn binding, canonical digest, unique receipt id, and atomic rollback. |
| Agent self-authority or false completion | Agent claims are T0; engineering requires independent T2; `DONE` requires a T4 Owner obligation. |
| Event/projection split brain | One `BEGIN IMMEDIATE` protected-transition primitive; immutable Event, exact projections, lease, obligations, and outbox commit together. |
| Duplicate or uncertain acknowledgement | Unique idempotency keys and exact duplicate reconciliation preserve one run identity; mismatched reuse fails closed. |
| Concurrent or stale writer | One live lease, monotonically increasing fencing token, no automatic stale takeover while the holder is live. |
| Crash between transaction boundaries | S01-S05 child-process kill matrix plus S06-S10 reopen/checkpoint/retry/writer cases. |
| Database/schema/Event corruption | `STRICT`, foreign keys, immutable triggers, migration checksums, quick/full integrity checks, Event hash-chain verification, projection rebuild, and backup/restore. |
| Model output injection | Model output is untrusted and must pass transport schema plus local semantic validation; quoted assistant text cannot create Owner decisions. |
| Tool or permission escalation | Gate 0A forbids tools. Gate 0B intercepts approval, grants at most the disposable cwd for one turn, disables network/MCP, and verifies deny/allow behavior. |
| Post-cancel mutation | Interrupt terminates the turn/tool process and verifies no delayed marker; `CANCELLED` disables protected mutation. |
| Secret, path, or raw conversation leakage | Synthetic fixtures only; bounded/redacted stderr/errors; reports use digests rather than raw thread ids; `.ados-local/**` is ignored. |
| Native supply-chain drift | Exact package/lock integrity, official ABI 127 Windows x64 prebuild and binary hashes, embedded SQLite identity, no local compilation, no second native addon. |
| External side effects | Slice 2 commits an immutable intent and outbox row before each bounded Git/GitHub effect, then reads back exact branch/commit/Draft PR/Evidence identity and reconciles it in a later transaction. Uncertain acknowledgement reuses the effect; outage preserves a pending intent. |
| Codex credential or database escalation | The Executor receives no SQLite handle, strips credential variables and removes PATH entries containing `gh.exe`; GitHub authentication exists only in the bounded Forge Profile process. |
| Cross-repository scope escape | One exact fixture repository/base/worktree/branch is bound; traversal, nested-root, symlink, submodule, mode, binary, size, and path allowlist checks fail before publication. |

## Residual and intentionally unproven

The source implements the controls listed above. This public candidate verifies a bounded offline subset using synthetic inputs and real local storage/verification processes; see ../review/OWNER_REVIEW.md for measured coverage. It does not establish a new live Forge/Windows/Chrome/Codex integration, real-product Dogfood, general portability, production security, or Owner acceptance. Synthetic test inputs that contain PASS or approval fields are not evidence of those real-world events.

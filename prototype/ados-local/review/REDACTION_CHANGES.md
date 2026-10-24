# Publication changes

This is a source distribution change, not a replacement runtime. See `SOURCE_FILE_INVENTORY.csv` for all 131 input files and their dispositions. The original source is fixed at the commit in `OWNER_REVIEW.md`.

| File family | Change | Preserved boundary |
| --- | --- | --- |
| Core source, compiler, coordinator, resolver, tests | Private task/repository/approval/comment/card identities replaced by explicit synthetic identities; affected binding versions receive `-public.1`; derived digests recomputed | Existing equality checks, allowlists, deny conditions, authorization levels, state transitions and verifier trust requirements |
| `migrations/0005*`, `0006*` and dispatch types | Fixture literals, versions and corresponding digest constants synchronized | Same columns, CHECK structure, immutable triggers, transaction semantics and two allowed binding tuples; no migration of private databases |
| `fixtures/public-bindings.json`, default ready-card identity | Public capture and injected compiler candidate passed through the existing validators/builders; actual request/card/project digest preimages included | No simulated input is labeled real Owner approval; no device identity, signed token or database included |
| Extension, Native Host, registration scripts | Independent public key-derived origin and Host name; expected manifest at one fixed public Windows path; exact manifest/launcher hashes pinned | Same permissions, one allowed origin, administrator/collision/layout rejection; no automatic trust of installed state |
| Nine vendor contract/schema files | No Git blob changes; explicit CRLF checkout attributes restore the bytes expected by the original manifest | Original protocol/schema versions, contents and nine SHA-256 values |
| Vendor manifest | Removed historical approval, target installation and bootstrap metadata | File provenance, source pins and verification logic retained |
| Windows-specific tests | Explicit non-Windows skips; Windows addon identity assertion separated from portable SQLite invariants | Original Windows assertions preserved, no replacement of expected hash with observed hash |
| Public binding tests | Two additional tests derive record and installation identities and exercise drift rejection | Production functions are called; no live compiler or registry result is fabricated |
| `package-lock.json` | Approved `fast-uri` update from `3.1.5` to `3.1.9`; only its version, resolved URL and integrity change | Existing AJV range `^3.0.1` permits the patch; `package.json` and all other dependency entries stay unchanged |
| Documentation | New English/Chinese README, source inventory, actual evidence and limitations; demo text refers to the current candidate | Complete source availability is separated from live integration, real Dogfood and product acceptance |

Of the 131 input files: **59 retain identical Git bytes**, **54 receive binding/environment/documentation adaptations**, **one lockfile receives the approved dependency fix**, **one README is replaced**, and **16 internal instruction/report documents are excluded**. The Native Host template is retained under its public name. All `src`, `test`, `migrations`, extension and Native Host source files are accounted for. No source Git history, issue/comment content, live runtime directory or native binary is imported.

`REDACTION_DIFF.patch` is an inspection-only diff: all added lines and changed locations are visible; removed lines and unchanged context are omitted so the diff does not republish the records being removed. It is not an applyable patch. Exact source/candidate hashes and per-file destinations are in the inventory; the complete unredacted comparison remains outside this publication candidate for authorized local review.

The original package name and `package.json` are unchanged. The lockfile has only the three-field `fast-uri` revision described above. Author identity, frozen protocol provenance and exact software binary hashes are retained as source/implementation metadata, not device credentials or authority for a new Run. Negative-test strings such as `owner:secret` and synthetic token-like samples are deliberate invalid inputs.

The prior candidate `d8c3aa80db39cbdcae9bc23cc5440142ff16db54` reported high-severity advisories in `fast-uri@3.1.5`. The Owner authorized this one dependency fix. The revised clean install uses `3.1.9`; the current `npm audit --json` exits 0 with no known vulnerabilities. All application source, tests, migrations, public bindings and protocol snapshots retain the prior candidate's bytes. Current logs replace the previous validation evidence; local Git history retains the earlier report. No prior skip or live-environment limitation has been promoted to PASS.

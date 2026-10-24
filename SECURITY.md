# Security and trust boundaries

ADOS is a research project. The root Objective & Evidence Kit is an **offline record validator, not a sandbox, access-control service or authenticated approval system**.

The separate [ADOS Local prototype](prototype/ados-local/README.md) includes execution and storage code. Its offline validation and unverified live-integration boundaries are documented separately; the limitations below describe the root record validator.

It checks the form and selected consistency properties of supplied records. It does not authenticate approval/acceptance references, verify Git objects remotely, execute listed checks, inspect artifacts, discover undeclared changes or observe real external effects. A declared `PASS` is not independently verified; a declared `FAIL` can still be a valid record.

Path checks are simple text matching, not filesystem containment or safe path resolution. Schema support is limited to the shipped schemas' needs. Input parsing is not hardened for an exposed service or arbitrary hostile input. Keep inputs bounded and do not expose this CLI as an internet-facing trust service.

A production integration would need protected authorization, least-privilege tools, authenticated state, independent verification and safe recovery of side effects. Passing this test suite does not establish those properties.

Do not include API keys, tokens, private URLs, personal conversations or real customer data in issues or examples. For ordinary validator defects, open an issue with a minimal synthetic record and the observed behavior. For a concern involving sensitive material, contact the maintainer through the public profile links in the README before disclosing details; do not post the material publicly. No security-response SLA or production support is promised.

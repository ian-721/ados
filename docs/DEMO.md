# A real run of the public demo

[Home](../README.md) · [Commands](CONTRACT_KIT.md) · [Status](STATUS.md)

Captured on 24 October 2026 with Python 3.13.5 on Linux. These are synthetic record checks, not an agent execution or a private-runtime demonstration.

Command:

```bash
python tools/ados.py demo
```

Standard output (exit code `0`):

```text
Objective & Evidence Contract Kit — offline demo
[PASS] valid synthetic objective
[PASS] valid synthetic evidence
[PASS] evidence binds to its objective
[PASS] reject mutable contract pin
[PASS] reject unapproved authority escalation
[PASS] reject DONE without Owner acceptance
[PASS] reject illegal status transition
[PASS] reject engineering as product acceptance
[PASS] reject invalid patch-byte accounting
[PASS] reject incomplete state writeback
[PASS] reject duplicate candidate identity
[PASS] reject unauthorized merge
[PASS] reject changed path beyond scope
[PASS] reject un-restored execution surface
Result: 14/14 expected outcomes
```

`PASS` means the expected acceptance or rejection occurred for that constructed input. It does not establish that a permission was authentic or that the reported work actually happened. Re-run the command to check the behavior of your own checkout.

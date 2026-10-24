# Contributing

Useful contributions make a specific behavior or boundary clearer: a minimal counterexample, a failing test, a documentation correction or a bounded improvement to the reference kit.

Explain the problem, show a synthetic input, and state the expected and actual behavior. Run `python tools/ados.py demo` and `python -m unittest discover -s tests -v` for code changes. Keep changes focused; do not introduce a runtime, service or dependency to address a documentation or record-format issue.

Do not submit private project records, credentials, raw conversations, unpublished evaluation data or material you cannot license. Contributions intended for inclusion are under this repository's Apache-2.0 license unless explicitly stated otherwise and agreed before inclusion. Scientific results should identify their methods and limitations rather than be inferred from passing software tests.

Ideas for the broader design are welcome as issues, but an idea is not a commitment to implement or a claim that the feature already exists. Changes to authorization semantics or schemas need explicit discussion and versioning; they must not silently change an existing task's contract.

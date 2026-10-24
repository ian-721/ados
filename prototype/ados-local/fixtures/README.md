# Synthetic fixtures

Core record fixtures are constructed by `src/contracts/fixture-data.ts`; browser parser inputs are under `browser-extension/fixtures/` and `test/fixtures/`.

`public-bindings.json` contains synthetic input records and derived default bindings. The public-binding tests reconstruct their request, card, candidate and project digests. It is not real approval or provider evidence; no device identity, signed token, credential or database is included.

`public-native-host-manifest.json` is the exact expected installation fixture, not observed Windows registration evidence. The README explains the fixed layout and unverified integration boundaries.

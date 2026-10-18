# Retained browser iteration analysis

The offline regeneration command completed with exit0. Both artifacts use
seed20261009 and10,000 iteration-cohort bootstrap resamples. No desktop
collection, raw mutation or baseline substitution occurred.

| Raw input | Raw SHA256 | New analysis under `.bench/v3/` |
|---|---|---|
| `attached-30.json` | `2d7e9306726b55031a8ea83b0f32ac274886153b81f56acc797fadb47823ecb7` | `attached-retained-iteration-analysis.json` |
| `browser-agent-30.json` | `0ff516a3275900c831bdaa714c62ae00c70fca412a3942e2cd4ff2ed14d22188` | `browser-agent-retained-iteration-analysis.json` |

Analysis SHA256 values, respectively:

```text
1edd5e60372588666c34b4847ca0986e208a1cf986ae751c0b832e04214873ba
b9fb0f9ee8a66a159799e03f6a417028af914411bb965dc7f87f35e5506927ac
```

Reproduce using new, unused output filenames:

```sh
node scripts/bench-v3/save-analysis.mjs \
  .bench/v3/attached-retained-iteration-analysis.json .bench/v3/attached-30.json
node scripts/bench-v3/save-analysis.mjs \
  .bench/v3/browser-agent-retained-iteration-analysis.json .bench/v3/browser-agent-30.json
```

## Evidence limits

Attached scripted tasks each retain30/30 completion observations and
Wilson lower bound0.886487. These are L3 scripted results, not agent
performance, despite the route name beginning `omo-`. The analyzer's
unknown-model fields do not promote them to agent evidence. There is no
matched Safari renderer or substituted driver comparison.

The agent matrix retains516 of630 registered slots. Every route/task has
24 or25 recorded attempts, not30. New intervals describe the retained
observations; missing114 slots are not generated, retried or imputed.
Recorded failures remain in the primary denominator. Physical fixture
provenance and cleanup limitations remain as disclosed in COVERAGE.md.

All Codex observed models remain unknown. OmO+apple injection iteration6
reports `chatgpt-subscription/gpt-6-sol`, not the registered `gpt-6-astra`;
its successful raw row remains included, with the mismatch disclosed.
OmO+apple scroll-link, OmO+Cua injection and OmO-native injection each have
one unknown model observation. Matched-client superiority claims cannot
silently treat those rows as the registered model or exclude them.

The existing text-native and menu corrected analyses already retain their
raw identities. These new browser analyses complete the four-cache offline
refresh obligation; they do not complete the live benchmark, original
historical extensions or agent matrix.

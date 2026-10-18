# Token and cost interpretation

Use one published table for normalized Astra token prices, independently of
route. Official source, retrieved 2026-10-11:
https://developers.openai.com/api/docs/models/gpt-6-astra

| Standard API category | USD per million tokens |
|---|---:|
| Uncached input | 10 |
| Cached input | 1 |
| Cache writes | 12.5 |
| Output | 50 |

Requests exceeding 272,000 input tokens double input/cache rates and multiply
output rates by 1.5. Batch/Flex are half Standard; Fast doubles the applicable
rates. An aggregate turn or attempt token count cannot determine which
individual requests exceeded the boundary. Hosted-tool charges are additional.

Actual benchmark routes use a ChatGPT subscription. API-equivalent token
arithmetic is not the subscription invoice or the marginal cost of a turn.
Keep client-reported dollars separately labeled. Do not treat absent dollars
as zero or claim a dollar advantage from unmatched billing semantics.

The existing OmO parser reports uncached `usage.input` separately from
`usage.cacheRead`; these cannot be subtracted from each other. The Codex
`input_tokens` figure includes its cached-input subset. Preserve input, output
and cached counts separately, including their client-specific semantics.
Cache-write counts were not retained by the historical parser; they remain a gap,
not inferred zero. Driver payload-token estimates are not either client metric.

Prospective correction: the parser now retains each reported usage object
in `usageRecords`, labeled `assistant_message` for OmO and `turn_aggregate`
for Codex. This preserves cache-write fields when the client supplies them;
absence remains unknown. A Codex aggregate is not recast as per-request
context-tier evidence. The initial missing-record regression failed, then
the correction passed the complete 138-test harness and source checks.
Historical pilot fields above remain unchanged and still have the gap.

Exploratory example: the matched-model OmO+apple pilot reports 84,369 uncached
input, 766,208 cached input and 1,477 output tokens. Standard-rate arithmetic
for those reported categories is USD 1.683748, matching its client-reported
value. This does not verify omitted cache writes, per-request context tiers,
tool charges or actual subscription billing.

The Codex+apple pilot reports 438,481 total input, including 380,800 cached,
and 599 output tokens. Its model identity and dollar amount are unknown.
If priced counterfactually at the same Standard short-context table, the
reported categories would total USD 0.98756. That is not measured cost or
a matched-model cost comparison. Requested model configuration is insufficient
to assign the actual model a rate.

To complete normalized cost evidence, retain per-request usage, cache-write
counts, context tier and processing mode. Apply the same table and formula to
all eligible routes; where evidence is missing, report missingness rather than
invent a single billed cost. None of these exploratory examples supports a
cost-confidence interval or a thirty-run agent verdict.

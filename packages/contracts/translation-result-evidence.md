# Translation result evidence (contract version 1, additive fields)

`POST /mt/translate` and aggregate result responses may include `nonRetryableSegmentIndexes: number[]`. Indexes use the caller's segment index space. These segments were deliberately rejected by policy; the plugin must not retry them in other formatting modes. Missing fields preserve legacy retry behavior. Successful segments remain usable in partial responses.

Each translation may include `historyRequestId: string`. This is the exact request ID of the persisted history that produced that segment, which can differ from the outer caller request ID during aggregation or rescue. The plugin displays this locator in `TranslationResult.Info`, falling back to the outer response/request ID for older gateways. Aggregation must preserve confidence, info and all existing translation fields while remapping `index`.

History lookup accepts an exact ASCII request ID (1–160 characters; letters, digits, period, underscore, colon and hyphen). Missing and ambiguous matches never navigate to a guessed record. The Windows protocol `memoq-ai-hub://history?requestId=...` only requests local record navigation; it does not execute translations or mutate assets.

`historySegmentIndex` retains the segment index inside that history record before aggregation remaps the caller index. Policy failures additionally include `nonRetryableSegments: { index, historyRequestId, historySegmentIndex }[]`, so a withheld translation still has a diagnostic locator. All-rejected rescue requests settle with the policy error rather than being relabeled as an aggregate timeout. Older clients ignore these additive fields; only the updated plugin honors the no-retry boundary.

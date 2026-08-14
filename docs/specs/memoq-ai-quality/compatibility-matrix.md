# memoQ QA compatibility matrix

| Host / filter | Preview revision fixture | Live target mapping | MT Confidence / Info display | Status |
| --- | --- | --- | --- | --- |
| memoQ 12 / generic Preview | Recorded contract fixture below | Pending real-host run | Pending real-host run | Not yet verified |
| memoQ 10–11 | Not recorded | Not verified | Not verified | Unsupported until tested |
| Preview unavailable or ambiguous | N/A | AI stops; deterministic and batch checks remain available | N/A | Implemented degradation |

The fixture contract is stored at `apps/desktop/test/fixtures/preview/memoq12-preview-revision.json`. It contains anonymous synthetic text and must be replaced or supplemented only with similarly anonymized recordings. A passing unit fixture is not a memoQ host acceptance result.

## Real-host acceptance record

Record the memoQ build, Windows build, filter, display behavior, revision sequence, reconnect behavior, and anonymization confirmation. Do not mark a row verified until a translator has completed the run in memoQ 12.

Public binaries and pull requests that contain SDK/API-derived deliverables remain blocked until written memoQ distribution permission is attached to the release evidence.

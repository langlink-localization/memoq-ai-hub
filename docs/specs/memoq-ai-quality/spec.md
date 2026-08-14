# MT Confidence and AI Quality Checks

## Product contract

- memoQ MT results may include optional `confidence`, `info`, and diagnostic confidence signals without changing result order or failure behavior.
- The desktop application owns deterministic QA, terminology consistency, optional AI semantic checks, local results, feedback, batch inspection, and presentation.
- Preview helper data is the only live memoQ document source. MT SDK calls are never used to infer the editor's current target text.
- Real-time deterministic checks are available locally. Real-time AI is experimental and disabled by default.
- The first supported live-host validation target is memoQ 12. Other versions and filters remain unverified until added to the compatibility matrix.
- Version one only copies suggestions. It never writes translations back through UI automation or private memoQ APIs.

## Quality contract

- Categories are `accuracy`, `completeness`, `terminology`, `fluency`, `style`, `locale-convention`, `formatting`, and `other`.
- Severities are `critical`, `major`, `minor`, and `info`; the UI does not expose an overall score.
- Every finding carries stable identity, evidence, origin, confidence, optional target range and suggestion, plus feedback state.
- AI output must validate against the repository schema. One repair attempt is allowed; invalid output is otherwise discarded.
- AI critical/major findings require confidence >= 0.80, minor >= 0.70, 0.55-0.69 is downgraded to info, and lower confidence is hidden.
- Results are current only while their content hash matches the latest immutable Preview or imported-document snapshot.

## Privacy and retention

- The default AI payload contains the current segment, minimal adjacent context, relevant terminology, and top TM matches.
- Summary and full-text context require separate profile opt-ins.
- QA data and feedback stay local for 30 days by default. Secrets, full prompts, and default full-segment diagnostic logs are not retained.
- Exported reports may contain customer text and must warn the user before creation.

## Distribution boundary

The public repository and release archives must not contain memoQ SDK DLLs, signing tools, samples, or copied official documentation. Public distribution of SDK/API-derived components remains blocked until memoQ provides written permission. Local/internal builds may resolve approved SDK inputs through the existing ignored cache.

## Done when

- New and old plugin/desktop combinations tolerate the optional MT fields.
- Rapid edits and document switches never display stale QA results.
- Preview loss and provider failure preserve deterministic checks and expose a batch fallback.
- Workbench, batch reports, and compact window share the same QA contracts and local result store.
- Desktop, repository, plugin, packaging, accessibility, responsive, and Ant Design fail-closed checks pass.

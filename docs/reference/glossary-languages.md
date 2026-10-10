# Glossary languages and translation direction

Available starting with v1.0.55.

## Ordinary terminology

New glossary imports use automatic language matching. For CSV, TSV, TXT and XLSX tables, confirm the language of each term column using language names. Two-language tables follow the same model as multilingual tables: each row represents one concept and each language column contains its equivalent term. The preview displays these language columns without expanding the row into source/target pairs.

The memoQ request supplies the translation direction. Ordinary terms can be used in either direction without uploading another copy or rebinding the asset to a different profile. Missing cells do not create substitute translations. Language-region and script matching retain the existing canonical language checks.

## Directional rules

Rows containing effective `forbidden`, `allowedVariants`, `caseSensitive`, non-default `matchMode`, non-zero `priority`, or `partOfSpeech` rules require an explicit direction. For language-column tables, choose the original and translation languages in the asset preview. These rows only apply to that direction; they are neither reversed nor reused for other language pairs. Other ordinary rows remain reusable.

Without a valid rule direction, rule-bearing rows are excluded from matching. The preview and translation evidence explain the missing configuration. Empty rules, false flags, zero priority and the default phrase match mode do not restrict ordinary rows.

Existing row-oriented tables with `sourceTerm`, `targetTerm`, `srcLang` and `tgtLang` retain those per-row directions. New imports prevent rules from being reversed. Language-column tables use one shared rule direction; use separate assets or a row-oriented table when rule directions differ per row.

## Existing assets

Assets without the new mode field retain the matching behavior shipped in v1.0.54, including its existing reverse matching. They are not silently migrated. For editable tables, enable **Match languages automatically for each translation** in the preview, confirm the columns and any rule direction, and save to opt in.

The legacy source/target mapping API remains supported. Existing language-pair metadata is preserved; ordinary matching in the new mode uses the request direction. Saving invalid settings does not mutate the asset, and successful configuration changes invalidate parsed caches.

Translation evidence records the matched source and target languages and identifies direction-specific rules. Old records remain unchanged.

## Verification

Regression coverage includes all six directions of a three-language glossary, ordinary bilingual matching, directional rules, ineffective rule values, sparse cells, legacy behavior, save/reload/cache invalidation, real import defaults and translation evidence. Browser acceptance uses synthetic data in the existing Ant Design 6.6.2 drawer and form composition at desktop and 768px widths. No memoQ plugin contract or database schema change is required.

## Notes and metadata in previews

The Note column shows actual comments rather than flattened entry and term metadata. Expand **Details** for labelled IDs, categories, definitions, scope and parsed rules; values can be copied. Multilingual previews retain non-language columns and identify repeated headers by their file column number. Custom TM previews also expose available metadata and context.

Metadata alone does not prove that a rule ran. The rule summaries below distinguish executable memoQ rules from reference metadata. Use **Test assets** with a source segment and optional target to verify actual behavior locally.

Regional export headers such as `English_United_States` and `Portuguese_Brazil` are normalized to `en-US` and `pt-BR`. Existing mappings receive the same normalization in the preview and when saved. Unrecognized or duplicate languages name the affected columns so they can be corrected or left unassigned.


## memoQ term rules

Starting in v1.0.57, language-associated `Term_Info` and QTerm `Term_CaseSensitivity`, `Term_PrefixMatching`, and `Term_Forbidden` columns feed a shared deterministic source matcher and target checker. Rules are associated with the preceding language column, including repeated headers. Notes are never interpreted as rules.

| Export rule | Hub behavior |
| --- | --- |
| `CaseSense` / `CaseSensitive` | Case-sensitive term occurrence |
| `CasePermissive` | Uppercase letters in the registered term must match; lowercase letters are flexible (`memoQ` matches `MEMOQ`, not `memoq`) |
| `CaseInsense` / `CaseInsensitive` | Case-insensitive occurrence |
| `NoPrefix` / `Exact` | Complete word edges; no suffix extension |
| `HalfPrefix` | Each word may acquire a letter suffix no longer than that word (`reviewing` matches `review`; `reviewability` does not) |
| `NonTerm` | A forbidden source term is not suggested; a forbidden target term is checked as a prohibited translation |
| `Prefix` / `Fuzzy`, `Custom`, wildcard markers, unknown or conflicting rules | Shown as unsupported; affected entries are excluded from matching and target checks |

An existing but empty rule field uses memoQ's defaults: CasePermissive and HalfPrefix. Grammar tokens remain reference metadata. A missing rule field retains the existing Hub matcher. Literal CJK terms retain contiguous-text lookup; suffix matching handles Latin, Cyrillic and Greek letters, not morphological stemming or fuzzy edits. Hyphenated word extensions do not match a base word. This is deterministic compatibility, not memoQ's proprietary fuzzy engine.

Source and target rules travel with their language terms when the direction changes. They do not make an ordinary multilingual asset directional. Existing row-level forbidden flags, variants, scope and directional configuration remain in force; an explicit row-level case-sensitive flag also constrains matching. Unsupported entries produce a warning even when no term is matched, so the result does not claim full rule compliance.

Expand a preview row to inspect raw rules, effective case/matching behavior, defaults and unsupported tokens. **Test assets** uses the production source matcher and, when an optional target is supplied, the same terminology QA as translation. It does not invoke AI. Result evidence shows the actual source span, language-side rules and target check outcome; it records facts at generation time without rewriting old history. Matcher fingerprints invalidate exact translation cache keys after the rule upgrade.

Reference: [memoQ CSV fields](https://docs.memoq.com/current/api-docs/wsapi/memoqservices/tbservice.importexport.csv.html) and [term matching settings](https://docs.memoq.com/current/en/Workspace/edit-term-base-entry.html).

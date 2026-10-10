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

Imported metadata such as memoQ `Term_Info` is reference information, not proof that the Hub applies that matching rule. Use **Test assets** to verify the production matcher for a sample segment and language pair.

Regional export headers such as `English_United_States` and `Portuguese_Brazil` are normalized to `en-US` and `pt-BR`. Existing mappings receive the same normalization in the preview and when saved. Unrecognized or duplicate languages name the affected columns so they can be corrected or left unassigned.

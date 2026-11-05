# Reproducible completion scorecard

Run with Node.js 24 from the repository root after installing the locked backend dependencies:

```sh
node scripts/office-ai-completion-scorecard.cjs --output .cache/office-ai-completion-scorecard.json
```

The scorecard runs **complete test files without test-name filtering**. Every scenario records the actual test names, command, elapsed time, counts and limits. A failed, skipped, cancelled or empty test run fails its scenario. The JSON report fingerprints the backend and Office AI Worker sources before and after execution; a source change during the run fails the overall result and requires a rerun. The command does not publish code, deploy infrastructure or call live inference providers.

| Scenario | Evidence exercised | Practical limit |
| --- | --- | --- |
| Data results | Execute production CSV/JSON helper; check whole-table statistics, explicit omitted groups/rows and overflow rejection | Helper executes locally; no Cloudflare availability or open-ended analysis measurement |
| Research and saved artifacts | Separate page evidence from snippets and failed reads; execute encrypted memory writes, versioned reads, retry/stale-write checks and reusable tools | Storage executes in PGlite; external providers use controlled responses |
| Execution, repair and approval | Run persisted task handlers through failed-check repair, automatic checkpoints, terminal completion, cancellation, nonreplay and exact-source deployment approval | Scripted model/repository/provider responses; no autonomous live task or real deployment |
| Source and release integrity | Execute exact edits, immutable candidate verification, publication-race reconciliation, native relay truncation propagation and Worker source/binding checks | Controlled HTTP fixtures; no external repository writes |
| Recovery and requirements | Exercise bounded inference recovery, cancellation and retention of requirements, saved files, verification and unresolved edits through compaction | Controlled inference responses/clocks; no live provider outage drill |

This is a focused behavioral regression scorecard. Run the full backend suite, browser checks and deployment verification separately for release acceptance. It is not a general intelligence benchmark, an end-to-end user completion rate, a capacity/latency guarantee, or a comparison with ChatGPT, Claude, Kimi or other assistants. The report explicitly records zero competitor runs and makes no superiority claim. Live completion evaluations should later record independent task definitions, expected artifacts, model/provider configuration, blind outcome judgments, costs and failures for every attempted task.

The data helper retains its existing first-100-group response limit and now returns `groupCoverage` with the input row count, total/returned/omitted groups, returned/omitted rows and a `truncated` flag. Whole-table statistics still use all rows. A complete grouped export can use the existing code-execution and workspace-writing tools. Nonfinite numeric input or statistics fail with rescaling guidance before JSON can turn an overflowed number into a misleading `null`.

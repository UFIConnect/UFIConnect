# Office task operations

The November 4, 2026 release separates text task inference from ordinary chat and image inference. `OFFICE_AI_TASK_MODEL` selects the text task primary; omitting it inherits `OFFICE_AI_MODEL`. Ordinary chat retains its existing model, and image tasks use `OFFICE_AI_VISION_MODEL`. Invalid task model configuration is reported without changing chat or image settings.

The selected text task primary is `@cf/zai-org/glm-5.3`. It and Gemma 4 each passed six fixed Office cases; sampled median response times were 1.503 and 4.069 seconds. These small tests support an Office task trial, not a claim of general superiority over other assistants. Cases cover exact edits, new files, permissions, queued receipts, calculation, and correction after tool errors.

Ten distinct configured text recovery models passed strict tool calls, returned-tool continuation, direct and relay transports, and the normal 8,192-token output budget:

1. `@cf/google/gemma-4-26b-a4b-it`
2. `@cf/deepseek-ai/deepseek-v4.1-flash-1017`
3. `@cf/zai-org/glm-5.3-flash`
4. `@cf/zai-org/glm-5.2`
5. `@cf/nvidia/nemotron-3-120b-a12b`
6. `@cf/meta/llama-4-scout-17b-16e-instruct`
7. `@cf/zai-org/glm-4.7-flash`
8. `@cf/deepseek-ai/deepseek-v4-flash-0731`
9. `@cf/qwen/qwen3.8-27b`
10. `@cf/moonshotai/kimi-k2.6`

The separate image recovery pool uses DeepSeek 4.1 Flash and Llama 4 Scout after red/blue image and tool-call tests. Models that failed stronger continuation or default-output-budget checks were excluded. All inference remains on the existing Cloudflare account. Multiple models do not remove the shared dependency on that account and provider.

Task inference can try its primary plus up to ten compatible recovery models within one shared deadline. A stalled primary has at most 30 seconds when alternatives are configured; the remaining candidates divide the time left. Unhealthy models are skipped for at least the configured inference window, and a fully unhealthy pool gets one probe capped at 30 seconds. Known smaller-context or incompatible image fallbacks are excluded using a conservative byte envelope and a bounded image allowance. This is a local safety estimate, not exact token counting. Connection changes invalidate recovery state; alternating text/image requests preserve it. Authentication, billing and invalid-input failures are not fanned out across the pool. A controlled locally injected primary 503 recovered using actual connected fallback inference; no real provider outage was induced.

## Task progress and polling

`GET /office/ai/tasks?summary=1` returns compact task history for current Office clients. It limits preview text, includes the most recent event, and excludes file diff bodies and older event bodies. The default list and selected task detail remain complete. Measured production-row projection reduced a sample list from 139,450 to 54,422 bytes. Requests remain authenticated and uncached.

Tasks persist bounded counts and durations for connection refresh, inference, tool work, terminal polling, verification polling, publication, and deployment polling. These durations measure active calls; waiting between polls is not inference time. The interface shows measured AI and tool durations without exposing arguments or private reasoning.

## Exact-source verification reuse

New candidates and pull requests still execute the complete verification suite. After an Office candidate passes the entire workflow, publishing that identical commit can reuse the completed receipt instead of running the suite again. Reuse requires the same commit, workflow path, source/head repository, a matching Office validation tag, and successful overall completion within two hours. Missing, moved, malformed, stale, failed, or unreadable evidence runs the full suite. The aggregate gate checks native and all matrix results, or explicit reuse with those jobs skipped. The backend matrix avoids building browser bundles after its tests, while browser groups retain their builds and audits.

## Browser and recovery controls

`office/public/_headers` applies security headers to automatic Cloudflare static builds. HTML and health responses are uncached; versioned assets remain immutable. Browser tests cover external framing, objects, base injection, and incorrect script MIME types while preserving sandbox preview execution. Production responses must also be checked after deployment because source configuration alone does not prove serving behavior.

See [Office recovery](OFFICE-RECOVERY.md) for encrypted snapshots, ten source-rebuild recovery points, authenticated offsite storage, archive-specific Windows key escrow, and isolated restore verification. No production data is restored by these tools.

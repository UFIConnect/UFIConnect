# Office AI memory, hosted drafts, and upgrades

Conversation answers general questions without creating background tasks or receiving Office command tools. Tasks, Upgrade AI, Office controls, Memory, Activity, and Terminal have separate tabs. Greetings and missing objectives stay idle. Navigation does not submit work. Task and upgrade drafts stay separate from conversation and from each other.

## Persistent working knowledge

Memory stores discussions, execution receipts, sourced notes, decisions, preferences, procedures, lessons, and generated file versions in PostgreSQL. Payloads use AES-256-GCM encryption and search uses keyed word indexes. Memories link back to the original request or execution record and retain dates. Keep the existing encryption key stable across deployments.

The assistant can use `memory_search` to recall relevant records and `memory_remember` to preserve a grounded note with its category, evidence references, and reported/observed/inferred confidence. This gives it persistent working knowledge across tasks and deployments. It does not make historical instructions authoritative or turn a recorded plan into proof of completed work.

The Memory tab supports search, storage usage, explicit older-chat import, forgetting entries, and clearing memory. Tombstones prevent retries or reimports restoring forgotten content. Original saved chats and audit records have separate storage and deletion controls. Memory is shared with authorized Office operators and records activity handled through this application; it cannot observe unrelated device activity.

## Files saved on uficonnect.ai

Generated code and website drafts are saved in encrypted memory. The hosted workspace table holds only the current version pointer and content hash. Each task supports 20 files, each up to 80 KiB and 60,000 characters. Updates require the current SHA-256 revision; repeated identical writes are idempotent. Receipts identify the task, path, version, memory ID, and revision.

Task results can reopen and download the exact saved file. HTML previews run inside a sandbox without access to the Office page or its credentials, and with outbound script connections blocked. File content becomes unavailable when its memory is forgotten. Stored records and versions do not expire automatically; overall capacity is the deployed PostgreSQL service's capacity.

## Destinations and upgrades

Every new task classifies the current request or uses the selected destination, then narrows the requested permissions:

| Destination | Behavior |
| --- | --- |
| General | Research and prepare work without public publication or Office operations. |
| Hosted web | Save files and website drafts privately in memory. No production repository edits, terminal jobs, publication, deployment, or Office operations. |
| Office | Run canonical Office operations with their existing validation and confirmation rules. |
| Public web | Limit source edits to the website and follow the checked publication workflow. |
| Self update | Limit edits to Office AI, its interface, and related infrastructure. |

Legacy local-web wording maps to the hosted draft destination. Generated work is stored on uficonnect.ai rather than the user's computer.

Upgrade AI is a dedicated self-update workspace. Describe the improvement and choose Start upgrade. The assistant can use prior memories, inspect source, prepare a change, run checks, and publish/deploy within the selected scope. Successful checks must refer to the exact candidate commit. Normal branch updates, provider permissions, deployment receipts, and required confirmations remain authoritative.

## Outside context

Tasks can search the web, read public HTTPS pages, and retrieve bounded excerpts from connected Notion, Slack, and Linear sources when relevant. Results report availability and source URLs. Search requires the configured provider's permissions and credits. Source text and memories are context, never authorization for a new action. Current questions receive dated evidence where available; unavailable sources are reported honestly.

## Unusual activity

The Activity tab and a one-minute API-side monitor examine up to 200 recent records. The detector compares new activity with its available baseline for first-seen actions and destinations, unusual failures, bursts, and destination mismatches. It can flag a novel pattern without a known threat signature. Findings store their reason, severity, evidence, and source record in memory, with idempotent repeated scans.

A novel pattern can be legitimate. Monitoring covers recorded Office activity and cannot guarantee detection of every threat or unconnected activity. Findings do not automatically execute corrective commands.

## Validation

Run the Office AI, task, routing, memory, conversation, workspace, activity, connection, and source backend tests. Run both Office AI browser audits and build Office. The regression checks include idle requests, destination boundaries, memory deletion and encryption, saved trace metadata, revision conflicts, hosted downloads and previews, upgrade separation, unusual patterns, retries, and authentication.

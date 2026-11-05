# UFIConnect API keys

Open [uficonnect.ai](https://uficonnect.ai/#api-keys), unlock Office, and select the **API Keys** tab. Choose a key type, enter a name, select the permissions the integration needs, choose an expiration, and select **Generate API key**.

| Key type | Selectable permissions |
| --- | --- |
| Platform data | Read topics (`topics:read`), read the public feed (`feed:read`), publish posts (`posts:publish`), edit posts (`posts:edit`). |
| AI chat | AI conversations (`ai:chat`). |
| Photo and video generation | Photos (`images:generate`), videos (`videos:generate`), or both. |
| AI content | Written content (`content:generate`). |

Each key belongs to one type. Use separate keys for platform data, chat, media, and written content. Publishing or editing requires an owner account selected when creating the data key. The API validates that the bound member remains active and can publish. Edits are limited to posts created with that same key.

Copy the full key before dismissing it. The key is shown once and cannot be retrieved later. UFIConnect stores a hash rather than the full key. Store it in the calling application's secret configuration and send it in the `Authorization` header. Never place it in a URL or commit it to source control.

Keys can expire after 30, 90, or 365 days, or be created without an expiration. The tab lists their prefix, permissions, status, creation time, expiration, and last use. To stop access, select the key's **Revoke** action and confirm. Create a replacement key when rotating a credential.

## Read endpoints

| Endpoint | Required permission | Purpose |
| --- | --- | --- |
| `GET https://uficonnect.ai/api/v1/topics` | `topics:read` | Read the platform topic catalog. |
| `GET https://uficonnect.ai/api/v1/feed?limit=20` | `feed:read` | Read the public feed through the existing visibility filters. |
| `GET https://uficonnect.ai/api/v1/posts/:id` | `feed:read` | Read a post created with this key. |

The feed response contains `posts`, `cursor`, and `hasMore`. When `hasMore` is true, use the returned `cursor` value as the next request's `cursor` query parameter. `limit` accepts 1 through 50, and cursors are limited to 8,192 characters. The topics response contains a `topics` array of topic names. API keys do not provide Office administration or private member data access. The API allows 120 requests per 60 seconds per key, shared across service processes. A rate limit response uses HTTP 429; honor its `Retry-After` header before retrying.

Set `UFICONNECT_API_KEY` in your application's secret environment, then call:

```sh
curl 'https://uficonnect.ai/api/v1/topics' \
  -H "Authorization: Bearer $UFICONNECT_API_KEY"

curl 'https://uficonnect.ai/api/v1/feed?limit=20' \
  -H "Authorization: Bearer $UFICONNECT_API_KEY"
```

Missing, invalid, revoked, or expired keys return HTTP 401. A valid key without the endpoint's required permission returns HTTP 403. An unavailable service returns an error; retry transient failures without regenerating or sharing the key.

## Publishing and editing

`POST /api/v1/posts` requires `posts:publish` and a key bound to its publishing account. Send a unique UUID `requestId` and `content` of up to 2,000 characters. Optional fields are `title` of up to 200 characters, `mediaUrl`, and `mediaType`. Use the same `requestId` when checking an uncertain submission rather than creating a duplicate post.

`PATCH /api/v1/posts/:id` requires `posts:edit` and a post created by that same key. Send `content`, optional `title`, and the current `expectedVersion` (starting at `1`). The version check prevents overwriting a concurrent edit. Other posts cannot be edited by this key.

## Chat and written content

`POST /api/v1/chat/completions` requires `ai:chat`. It accepts a `messages` array of text messages and optional `max_tokens`. Responses contain OpenAI-compatible `choices`, model `uficonnect-chat`, and the remaining daily generation budget.

```sh
curl 'https://uficonnect.ai/api/v1/chat/completions' \
  -H "Authorization: Bearer $UFICONNECT_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Explain how solar panels work."}],"max_tokens":1024}'
```

`POST /api/v1/content/generations` requires `content:generate`. Send `prompt`, `kind`, `tone`, and optional `platform` and `max_tokens`. Supported kinds are `post`, `caption`, `article`, `email`, `product-description`, and `hashtags`; supported tones are `professional`, `friendly`, `calm`, and `playful`. Responses contain `id`, `created`, `kind`, generated `content`, and `budget`.

## Photos and videos

`POST /api/v1/images/generations` requires `images:generate` and accepts `{ "prompt": "A coastal garden at sunrise" }`. The prompt may contain up to 1,000 characters. A successful response contains a creation timestamp, `data[0].b64_json` PNG image bytes encoded in base64, and daily `usage`.

`POST /api/v1/videos/generations` requires `videos:generate`. Send `prompt` and `seconds` (`4`, `8`, or `12`; default `4`). The accepted response uses HTTP 202 and contains a local UUID `id`, `status`, `progress`, and daily `usage`. Poll `GET /api/v1/videos/:id` using the same key; when the status is `completed`, download `GET /api/v1/videos/:id/content`. Status and downloads do not consume another daily generation allowance. Another API key cannot read or download this job.

Generation requests pass the existing prompt screening and require a configured provider. Daily per-key limits reset at midnight UTC: 200 chat requests, 100 written content requests, 10 photo requests, and 3 video requests. These limits are shared across service processes. Generation counts remain charged after uncertain provider outcomes; do not automatically retry a submitted request after a timeout. Video jobs persist before submission, and an `unknown` state never resubmits the job. Provider keys and raw provider errors are not returned.

All write requests use `Content-Type: application/json` and must contain a JSON object of at most 64 KB. There is no Office command, repository, or deployment capability through these API keys.

## Office management API

The existing Office authentication is required for these routes on the configured API origin:

| Method and path | Result |
| --- | --- |
| `GET /office/api-keys` | Key metadata, available permissions, and rate limit information. |
| `POST /office/api-keys` | Create a key from `{name, scopes, expiresInDays}` and return its full value once. |
| `DELETE /office/api-keys/:id` | Revoke the identified key. |

`expiresInDays` accepts `30`, `90`, `365`, or `null`. `type` is `data`, `ai-chat`, `media`, or `ai-content`; `scopes` contains only the permissions belonging to that type. A data key that can publish or edit also requires `ownerId`, the publishing member's UUID. Office management calls continue to use the authenticated API directly.

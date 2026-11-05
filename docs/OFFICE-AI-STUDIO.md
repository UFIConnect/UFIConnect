# Pip photo and movie studio

Studio adds generated photos and narrated videos to the authenticated application at `https://uficonnect.ai`. UFIConnect's own FFmpeg renderer builds MP4 files on the server using generated scene images, AI narration, captions, and camera movement. Production uses the existing OpenAI, Cloudinary, and PostgreSQL connections; Shotstack is optional. Provider keys stay on the server. A configured credential does not prove that a provider account has credits or access to every model.

Create a project from a prompt, a production brief, producer roles, and an original cast. Character appearance, personality, and voice notes travel with the project and subsequent chapters. These descriptions guide consistency; image models can still vary recurring characters between generations. Producer roles are creative instructions for the model, not claims that named human filmmakers participated.

Choose a custom runtime in seconds, minutes, or hours. Projects have no arbitrary total-runtime product cap: the server accepts a safe integer duration of at least four seconds. Two minutes is the size of each render job, not the maximum film length. Saving a plan starts no paid media generation. In Office, **Generate full video** or **Generate full movie** authorizes the server to create successive chapters until the requested runtime is reached, then join them into an MP4. This choice is saved in the database and continues without the browser open. **Generate next chapter** still creates just one chapter. Opening or refreshing a project does not opt it into further generation.

Extend an existing film by setting a longer total runtime in its production controls; completed clips remain saved. Use **Regenerate** on a completed chapter to replace that clip while keeping its original available until the replacement succeeds. A replacement keeps the chapter's position and duration and invalidates previous assembled files so the next assembly includes the updated clip. Stopping, failure, or uncertain provider receipts halt automatic continuation. Resume prepares the saved work; starting full generation again explicitly reauthorizes continuation. Continuous playback joins the loaded chapters in order; load more chapters for longer films. Assembly merges a saved prefix with the next bounded section, so the number of chapters is not a total-film cap.

The current video format is a narrated sequence of generated images with transitions, camera movement, and captions. Images and narration use provider credits; the built-in MP4 renderer does not require Shotstack credits. Server time, storage, credits, throughput, and file-size limits apply. Native assembly streams at most 400 MB of source media per section and limits an assembled output to 400 MB. Larger films remain available as saved chapters and can be assembled with a suitably provisioned renderer. This is not an unlimited-length single model inference, and a requested runtime is distinct from completed generated footage. Failed operations remain visible with their saved state. Cancellation stops further native processing; already accepted image or narration requests may still be billed. Project metadata is encrypted in PostgreSQL; generated media links are accessible to anyone who has the link.

## Creative freedom

Conversation, Work, and Studio accept three settings:

- **Strict** preserves the brief closely and asks for essential missing creative details.
- **Balanced** fills low-stakes gaps, preserves explicit requirements, and explains material assumptions.
- **Creative** takes more initiative with unspecified story, visual, and pacing choices while preserving established characters and requirements.

Balanced is the default for older clients. Creative freedom does not broaden execution permissions or allow invented factual claims, sources, quotations, or completed-action receipts. Replies explain useful conclusions and assumptions without exposing private internal reasoning.

## Generation keys and Render

Studio's **API keys** tab creates named keys for photo generation, video generation, and the existing caption/content generator only. A key is shown once, stored as a hash, and can be revoked. Listing keys returns metadata rather than the secret. Keys cannot access Office controls, chat tools, code, deployments, memory, connections, or other workspaces.

Keep the copied value in the Render server environment variable `PIP_STUDIO_API_KEY`. Never place it in a browser/Vite variable, client JavaScript, or a mobile bundle. The server integration uses `/api/pip/studio` with `Authorization: Bearer <key>` and a stable `x-pip-user-id` from the caller's authenticated session. The member bridge at `/pip/studio` accepts the existing member JWT, keeps the configured key on the server, and preserves the existing Pro access requirement. Projects and request IDs are isolated by key and end user. Daily generation quotas apply to each key and user.

Project routes support `POST /projects/:id/extend` with `{ "durationSeconds": 600 }` for an absolute new target and `POST /projects/:id/regenerate` with `{ "chapterId": "<saved-chapter-id>" }` for a replacement. Regeneration consumes the existing generation submission allowance. Automatic full production uses `POST /projects/:id/generate` with `{ "continuous": true }` in Office only; key and member integrations continue using one generation request per chapter so their daily quotas and revocation checks apply to each submission.

The backend installs pinned `ffmpeg-static` and `ws` dependencies. Optional server settings are `OFFICE_STUDIO_IMAGE_MODEL` (defaults to `gpt-image-2`), `OFFICE_STUDIO_SPEECH_MODEL` (defaults to `gpt-realtime-2.1-mini`), and `OFFICE_STUDIO_FFMPEG_PATH` for a separately installed encoder. `OFFICE_STUDIO_RENDERER=shotstack` selects the optional Shotstack path; omitting it uses UFIConnect's renderer. Generated narration is AI speech.

## Provider references

The [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation) documents the image endpoint and base64 outputs; [Realtime](https://developers.openai.com/api/docs/guides/realtime) documents the narration transport. The retired GPT Image 1 model is replaced in the new Studio by GPT Image 2. The Studio does not assume an OpenAI video model is available merely because an OpenAI key exists. The optional Shotstack path follows its [generated asset](https://shotstack.io/docs/guide/generating-assets/), [hosting](https://shotstack.io/docs/guide/serving-assets/hosting/), and [render limit](https://shotstack.io/docs/guide/architecting-an-application/limitations/) contracts.

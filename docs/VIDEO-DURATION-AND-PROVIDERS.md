# Command Center video length

Media Studio uses a collapsible Duration option with a custom seconds field and
slider. The application accepts whole-number durations from 4 to 300 seconds.
Lengths above five minutes are locked on both the client and server. The UI
shows the planned 30-minute range without allowing a longer generation.
Requests are rejected rather than silently shortened.

The authenticated `GET /command-center/media-options` endpoint exposes duration
limits and provider availability, never credentials or configured URLs. The
Generate button only enables durations supported by the connected integration.
When Shotstack is configured, videos use the narrated slideshow integration.
Otherwise the existing OpenAI adapter supports its tested 4/8/12-second requests;
other lengths require the existing configured custom provider.

## Narrated videos with images and captions

Research checked September 20, 2026:

| Service | Fit | What must be connected |
| --- | --- | --- |
| Shotstack (implemented) | Programmatic timelines with images, generated speech, and synchronized captions. Its published render limit covers both five and 30 minutes. | Shotstack account/API key; the adapter also uses the existing OpenAI key for storyboards and Cloudinary for durable storage. |
| Creatomate | Template-oriented videos, narration assets, and automatic or supplied caption timing. | Creatomate account/API key and render/template adapter; confirm account duration and credit limits before enabling longer output. |

Shotstack lists rendering at $0.30/minute for pay-as-you-go, with a $75 credit
purchase, or a subscription starting at $39/month. A five-minute render is
about $1.50 at the listed PAYG rendering rate; generated images, speech, and
other AI assets cost extra. Account access and actual charges require checking
the selected plan. No account, subscription, or paid render was created.

The current `VIDEO_GENERATION_API_URL` contract is a **custom adapter**, not a
direct Shotstack or Creatomate endpoint. It accepts
`POST {prompt, durationSeconds, duration}` and returns a finished HTTPS media URL.
Do not put Shotstack's endpoint/key into those custom-provider variables.
Use the dedicated setup below. Creatomate still needs a separate adapter.

## Shotstack setup and verification

On the Render **API** service, add a production `SHOTSTACK_API_KEY` and
`SHOTSTACK_ENV=v1`. Keep the existing `OPENAI_API_KEY` and Cloudinary credentials.
Never put these keys in frontend environment variables or source control.
Use `stage` only with the matching sandbox key; AI image and speech generation
can still consume paid credits in sandbox.

The adapter creates a structured storyboard using OpenAI, then submits one
asynchronous Shotstack render with up to 15 generated image scenes, synthesized
speech and captions derived from each narration track. Images use
`flux-schnell`; audio uses `polly-neural` with the Matthew English voice.
The timeline and output range enforce the exact selected duration. Narration
word limits leave breathing room; final voice pacing needs a live quality check.
The current voice is English; multilingual voice selection is not implemented.

Render IDs are saved in member-owned history. Browser status polling and the
existing background sweep save completed videos to Cloudinary; closing the
browser does not require a second render. Provider keys stay server-side.
Failed generation retains the original prompt. Submission is not retried
automatically because that could incur duplicate render charges.

Mocked tests cover a full five-minute timeline, precise duration, captions,
job identity, user isolation, processing/completion, and durable storage.
**Live provider credentials and a real paid test render are still required**
before production five-minute generation can be considered verified.

OpenAI's current video guide lists a September 24, 2026 shutdown for Sora 2 and
the Videos API. Its clip/extension workflow is not the recommended foundation
for the requested narrated slideshow format. Image generation is a separate API.

Sources:
- [Shotstack rendering limits and pricing](https://shotstack.io/pricing/)
- [Shotstack image and speech assets](https://shotstack.io/docs/guide/agents/conventions/)
- [Shotstack synchronized captions](https://shotstack.io/docs/guide/architecting-an-application/rich-captions/)
- [Creatomate subtitle timing](https://creatomate.com/docs/api/quick-start/provide-your-own-subtitles)
- [OpenAI video guide and shutdown notice](https://developers.openai.com/api/docs/guides/video-generation)

# Local release console

The local release console runs Office on `127.0.0.1:4174` and a local copy of the website on `127.0.0.1:4173`. Both bind to loopback. The committed mode files contain relative proxy paths and no credentials. Office reads the production API and pipeline through its development proxy; the website preview uses the live API, so account actions there affect the live service.

Install the locked dependencies once, then start both interfaces from the repository root:

```powershell
npm ci --prefix office
npm ci --prefix web
npm run office:release-local
```

Open `http://127.0.0.1:4174/#local-web`, or choose **Local web** in Office. The hosted Office tab also links to this local workspace, including a **Start phone connection** shortcut that opens it; the phone connection itself starts from the local workspace. The hosted tab does not read your computer's files. Local editing and preview do not require an Office token. When you review a public update or open an operational Office tab, enter the production `OFFICE_TOKEN` in the access dialog. The token stays in the current browser tab's memory and is cleared on reload or close.

In **Local web**, choose an existing text file under `web/src`, `web/public`, or `web/index.html`. Edit it and click **Save locally**. The preview updates automatically; use **Open local website** in the preview for a separate browser tab, or switch between desktop and mobile preview widths. **Reset unsaved** restores the last loaded or saved content. **Reload file** picks up edits made by your code editor. A revision check prevents an older browser editor from overwriting a file that has changed on disk. On a phone-sized screen, Local web shows one step at a time: **Edit**, **Preview**, and **Publish**. The Office header scrolls away on this tab so the editor can use the whole screen.

For a phone, use **Start phone connection** in the computer's Local web tab. A phone's `127.0.0.1` address refers to the phone itself. The connection instead creates two temporary HTTPS links through Cloudflare: one for the editor and one for the website preview. Scan the displayed QR code with your phone camera, or open the workspace link that **Copy link** copies, then enter the connection code shown beside it. Spaces and capital letters in the code are ignored, and a mistyped code returns to the form with an explanation. The QR code contains only the link, never the code. The hosted Office **Local web** tab can remember a pasted workspace link; it accepts the link with or without `https://` and explains when a pasted address is not a phone link, such as the computer's own `127.0.0.1` address. Opening an old link shows how to get the current one. On the phone, **Open phone preview** in the **Preview** step opens the website separately; enter the same code there, then refresh that tab after saving changes.

Phone access requires the official [cloudflared helper](https://developers.cloudflare.com/tunnel/downloads/). Set `CLOUDFLARED_PATH` to its executable, or place it at `.cache/tools/cloudflared.exe` on Windows (`.cache/tools/cloudflared` elsewhere). Start the normal local command first; external access begins only when **Start phone connection** is selected. The optional `node scripts/start-local-release.mjs --phone` command starts it directly. **Stop phone connection** closes both links. Links and codes change after restart, and paired browser sessions expire after eight hours. Keep the computer running while using the phone.

Every phone request requires pairing, including source assets and file endpoints. The editor and preview use separate HTTPS origins and cookies. The gateway retains the local editor's file, revision, and origin checks; publishing still requires the Office token and a reviewed public update. Cloudflare carries the tunneled traffic, so enable this connection only when you intend to share the local workspace through that service. Quick tunnels are temporary preview connections, not a permanent public website.

To update the public website, save your edits, then choose **Review for public update**. The console compares your saved local file with the latest GitHub version and lists only the changed lines, with a little surrounding context. **Compare full files** shows both complete versions. A line ending change, such as a Windows editor saving CRLF endings, is reported once rather than as a change to every line. Review the changes, write a specific commit message, check the confirmation box, and click **Publish this file**. Publication writes only that reviewed file to `main`; other local edits remain local. The console rechecks the local file revision and the API checks the GitHub blob SHA, so changes made after review require a fresh review. This action publishes the selected saved content, which may include edits previously made outside the console.

The existing **Controls → Frontend changes → Commit a web frontend file** workflow remains available for editing a GitHub file directly. It also requires a content review and a matching GitHub blob SHA.

The new `main` commit starts **Verify UFIconnect**. A successful run automatically calls the four Render hooks stored in the protected GitHub environment. The deploy workflow checks that the verified SHA is still the current `main` SHA before sending it to Render. A failed or superseded commit does not deploy.

The **Deployments** controls and the **Deploy Center** can redeploy the current verified `main` commit. They dispatch `deploy-render.yml` with a specific target such as `web`, `office`, or `frontends`; the workflow independently checks the current SHA and its successful verification run before using a hook.

Production setup requires the same `OFFICE_TOKEN` on the API and pipeline services, plus `OFFICE_GITHUB_TOKEN` on the API. Scope that token to `UFIConnect/UFIConnect` with Contents and Actions write access. Keep `RENDER_HOOK_API`, `RENDER_HOOK_WEB`, `RENDER_HOOK_OFFICE`, and `RENDER_HOOK_PIPELINE` in the GitHub environment named `main - uficonnect-pipeline-708r`.

If port 4173 or 4174 is already in use, the command exits instead of silently choosing another port. Stop the process using that port before restarting the console. Stop the console with Ctrl+C when finished. The proxy keeps requests same-origin in the browser, so production does not need to allow a local origin. File editing endpoints exist only in the local release mode and reject requests from other origins; they are not part of the deployed Office build.

# Local release console

The local release console runs Office on `127.0.0.1:4174` and a local copy of the website on `127.0.0.1:4173`. Both bind to loopback. The committed mode files contain relative proxy paths and no credentials. Office reads the production API and pipeline through its development proxy; the website preview uses the live API, so account actions there affect the live service.

Install the locked dependencies once, then start both interfaces from the repository root:

```powershell
npm ci --prefix office
npm ci --prefix web
npm run office:release-local
```

Open `http://127.0.0.1:4174/#local-web`, or choose **Local web** in Office. The hosted Office tab also links to this local workspace. It does not read your computer's files. Local editing and preview do not require an Office token. When you review a public update or open an operational Office tab, enter the production `OFFICE_TOKEN` in the access dialog. The token stays in the current browser tab's memory and is cleared on reload or close.

In **Local web**, choose an existing text file under `web/src`, `web/public`, or `web/index.html`. Edit it and click **Save locally**. The preview updates automatically; use **Open local website** for a separate browser tab, or switch between desktop and mobile preview widths. **Reset unsaved** restores the last loaded or saved content. **Reload file** picks up edits made by your code editor. A revision check prevents an older browser editor from overwriting a file that has changed on disk.

To update the public website, save your edits, then choose **Review for public update**. The console loads the latest GitHub version beside your saved local file. Review both complete versions, write a specific commit message, check the confirmation box, and click **Publish this file**. Publication writes only that reviewed file to `main`; other local edits remain local. The console rechecks the local file revision and the API checks the GitHub blob SHA, so changes made after review require a fresh review. This action publishes the selected saved content, which may include edits previously made outside the console.

The existing **Controls → Frontend changes → Commit a web frontend file** workflow remains available for editing a GitHub file directly. It also requires a content review and a matching GitHub blob SHA.

The new `main` commit starts **Verify UFIconnect**. A successful run automatically calls the four Render hooks stored in the protected GitHub environment. The deploy workflow checks that the verified SHA is still the current `main` SHA before sending it to Render. A failed or superseded commit does not deploy.

The **Deployments** controls and the **Deploy Center** can redeploy the current verified `main` commit. They dispatch `deploy-render.yml` with a specific target such as `web`, `office`, or `frontends`; the workflow independently checks the current SHA and its successful verification run before using a hook.

Production setup requires the same `OFFICE_TOKEN` on the API and pipeline services, plus `OFFICE_GITHUB_TOKEN` on the API. Scope that token to `UFIConnect/UFIConnect` with Contents and Actions write access. Keep `RENDER_HOOK_API`, `RENDER_HOOK_WEB`, `RENDER_HOOK_OFFICE`, and `RENDER_HOOK_PIPELINE` in the GitHub environment named `main - uficonnect-pipeline-708r`.

If port 4173 or 4174 is already in use, the command exits instead of silently choosing another port. Stop the process using that port before restarting the console. Stop the console with Ctrl+C when finished. The proxy keeps requests same-origin in the browser, so production does not need to allow a local origin. File editing endpoints exist only in the local release mode and reject requests from other origins; they are not part of the deployed Office build.

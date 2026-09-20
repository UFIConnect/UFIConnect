# Local release console

The local release console runs the Office interface on your computer while reading the production API and pipeline through its loopback development proxy. It binds only to `127.0.0.1:4174`; the committed mode file contains relative proxy paths and no credentials.

Install the locked Office dependencies once, then start it from the repository root:

```powershell
npm ci --prefix office
npm run office:release-local
```

Open `http://127.0.0.1:4174`. Enter the production `OFFICE_TOKEN` in the access dialog. The token stays in the current browser tab's memory and is cleared on reload or close.

To update the public website, open **Controls**, choose **Frontend changes**, and run **Commit a web frontend file**. Load an existing `web/src`, `web/public`, or `web/index.html` file, review the complete content, enter a specific commit message, and confirm the commit. The API writes that one file to `main` only if its GitHub blob SHA still matches, so a stale editor cannot overwrite a newer change.

The new `main` commit starts **Verify UFIconnect**. A successful run automatically calls the four Render hooks stored in the protected GitHub environment. The deploy workflow checks that the verified SHA is still the current `main` SHA before sending it to Render. A failed or superseded commit does not deploy.

The **Deployments** controls and the **Deploy Center** can redeploy the current verified `main` commit. They dispatch `deploy-render.yml` with a specific target such as `web`, `office`, or `frontends`; the workflow independently checks the current SHA and its successful verification run before using a hook.

Production setup requires the same `OFFICE_TOKEN` on the API and pipeline services, plus `OFFICE_GITHUB_TOKEN` on the API. Scope that token to `UFIConnect/UFIConnect` with Contents and Actions write access. Keep `RENDER_HOOK_API`, `RENDER_HOOK_WEB`, `RENDER_HOOK_OFFICE`, and `RENDER_HOOK_PIPELINE` in the GitHub environment named `main - uficonnect-pipeline-708r`.

If port 4174 is already in use, the command exits instead of silently choosing another port. Stop the process using that port before restarting the console. The proxy keeps administrative requests same-origin in the browser, so production does not need to allow a local web origin.

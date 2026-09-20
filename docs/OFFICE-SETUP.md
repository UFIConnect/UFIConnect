# Office setup

Office's **Setup** tab reads `/office/setup` separately from the API and pipeline. Both requests require the Office token. It displays setting names, presence, and database connection state; it never returns secret values. Refresh after changing a Render environment setting and deploying the service.

**Connected** means an actual database connection is reported. **Configured** means settings exist, not that a provider has accepted them. **Needs setup** identifies missing settings. **Needs attention** identifies an unavailable database or incomplete backup sync. **Disabled** identifies a product feature that remains off even if credentials exist. Missing optional providers do not imply the whole service is unhealthy.

The pipeline needs its own database, persistent signing/encryption keys, Office token, and relevant source and AI keys. Email, media storage, subscription payments, account connections, and reviewed publishing are API responsibilities. Both services must use matching persistent authentication/encryption keys. Do not regenerate these as a routine setup action.

For reviewed publishing and deployment, configure `OFFICE_GITHUB_TOKEN` on the API with Contents and Actions write access to `UFIConnect/UFIConnect`. Keep the four Render hook secrets in the existing GitHub deployment environment. The hooks already authorize workflow deployment; they do not give the running Office API permission to dispatch that workflow. `RENDER_API_KEY` and the four `RENDER_SERVICE_*_ID` values support deployment status inspection.

The feed backup requires a distinct reachable PostgreSQL database, verified TLS, and a successful synchronization. It copies a bounded recent feed snapshot, not accounts or messages. Never point it at the primary database or delete WAL files to repair it.

Provider credentials should be configured in Render, not typed into Office or committed to Git. Some connected-account integrations require provider review or additional implementation and remain disabled until those requirements are met. The inventory intentionally preserves those restrictions.

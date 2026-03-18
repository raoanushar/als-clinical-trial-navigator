**Render Deploy**

This repo is now set up so you can deploy it as a Render web service.

**What To Do**

1. Push this repo to GitHub.
2. In Render, create a new Blueprint or Web Service from that repo.
3. Set `OPENAI_API_KEY` in the Render environment.
4. Deploy.
5. Open your Render URL.

**Shareable Flagged Report URL**

Once deployed, the flagged HTML report is at:

`https://<your-render-service>.onrender.com/api/agent/export-flagged-html`

That is the link you can email to people.

**Important**

- Your local `.env`, `data/`, and `reports/` files are gitignored, so they will not automatically appear on Render.
- After deploy, you will likely need to:
  - sync ClinicalTrials.gov on the deployed app
  - run the agent on the deployed app
- If you want report/data files to persist across restarts, add a persistent disk in Render and point `STORAGE_DIR` to that mount path.

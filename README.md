# ALS Clinical Trial Navigator / SAVA AI Expert Portal

Prototype and reference implementation for an ALS clinical-trial dashboard and expert-portal views. The dashboard ingests ALS studies from ClinicalTrials.gov, normalizes registry fields, and layers curated and AI-assisted classifications on top.

## Start here

- [Production handoff: architecture, data contract, and integration guidance](docs/production-handoff.md)
- `expert-portal-prototype` — active development branch; contains the complete prototype workspace.
- `expert-portal-live` — dashboard-only branch used by the Render deployment. It removes developer-facing navigation and the Study Classification Report.

## Local run

Requires Node.js 20 or newer.

```bash
npm start
```

Open `http://localhost:8000`.

The first data request will use the local cache when available, or retrieve ALS studies from ClinicalTrials.gov when a refresh is required. Do not commit `.env` or locally generated review/conversation files.

## Important note

This is a prototype/reference implementation, not a production data service. The current implementation uses JSON files as its local cache and enrichment store. Production should move these into the team’s database and preserve the contracts in the handoff document.

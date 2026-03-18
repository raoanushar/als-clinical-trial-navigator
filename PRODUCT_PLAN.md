# ALS Clinical Trial Navigator

## Goal

Build a clinician-facing ALS trial intelligence tool that helps providers:

- search and triage relevant clinical trials quickly
- monitor newly posted or updated ALS trials
- understand site availability by geography
- investigate suspicious "trial-like" listings that may be selling products or misleading patients

## Primary Users

- ALS clinicians at academic medical centers
- trial coordinators and research staff
- clinical operations teams monitoring trial landscape changes

## Core Product Areas

### 1. Trial Search Copilot

A clinician chat/search interface backed by structured trial data.

Example asks:

- "Show me ALS trials in Boston"
- "Which interventional trials are recruiting adults in the Northeast?"
- "What changed in ALS studies this week?"
- "Find gene therapy trials with Massachusetts sites"

Requirements:

- natural-language search mapped to structured filters
- transparent filter summary before results
- direct links to source trial records
- clinician-safe output with trial status, phase, intervention, sites, sponsor, and eligibility highlights

### 2. Trial Dashboard

A structured view for comparing trials and tracking changes.

Key widgets:

- recruiting ALS trials by geography
- phase mix and intervention mix
- recently added / recently updated trials
- watchlist for saved institutions, sponsors, cities, or modalities
- clinician notifications feed

### 3. New Trial Notifications

Alert clinicians when new or materially updated ALS trials appear.

Notification triggers:

- new ALS trial posted
- recruitment status changes
- new site added in watched city/state
- inclusion/exclusion criteria materially changed
- sponsor or intervention updates

Delivery:

- in-app notifications
- daily/weekly email digest
- optional Slack or Teams webhook for research groups

### 4. Suspicious Listing Detection Agent

An agent workflow that flags listings that imitate trials while selling products, supplements, devices, or cash-pay services.

Target patterns:

- direct purchase language
- "limited spots" + purchase urgency
- missing IRB / sponsor / identifier details
- exaggerated cure claims
- landing pages that route to checkout or lead forms instead of protocol details

Outputs:

- suspicion score
- explanation of flagged signals
- source evidence snapshots
- recommended review action: ignore, human review, escalate

## Recommended MVP Scope

### Phase 1: Data + Search MVP

- ingest ALS studies from ClinicalTrials.gov API
- normalize studies, conditions, interventions, statuses, and locations
- create search API for city, state, phase, recruitment, sponsor, intervention type
- ship clinician chat UI that converts NL queries into filters
- ship dashboard with saved searches and basic notifications

### Phase 2: Change Detection + Alerting

- scheduled sync every 6-24 hours
- diff against prior snapshots
- generate user-specific alerts
- add watchlists and digest delivery

### Phase 3: Suspicious Listing Agent

- crawl nominated external pages or inbound submissions
- run rules + LLM classification
- store evidence and analyst review state
- build queue for compliance or research ops review

## Data Architecture

### Primary Source

- ClinicalTrials.gov API for canonical study metadata

Suggested normalized entities:

- `trials`
- `trial_sites`
- `sponsors`
- `interventions`
- `conditions`
- `trial_snapshots`
- `saved_searches`
- `watchlists`
- `notifications`
- `suspicious_listings`
- `listing_reviews`

### Important Stored Fields

- NCT ID
- official title
- brief summary
- condition
- recruitment status
- study type
- phase
- sponsor
- interventions
- age/sex eligibility
- inclusion/exclusion text
- start / completion dates
- locations with city, state, country, site status
- source URL
- last updated date

## Backend Plan

### Services

- `ingestion service`: pulls and normalizes ClinicalTrials.gov data
- `search service`: serves structured and semantic search
- `notification service`: diffs snapshots and dispatches alerts
- `agent service`: scores suspicious non-trial pages
- `review service`: human-in-the-loop queue for flagged pages

### Suggested Stack

- Frontend: Next.js or React
- API: Python FastAPI or Node/TypeScript
- Database: Postgres
- Search: Postgres FTS first, Elasticsearch/OpenSearch only if needed later
- Jobs: cron + queue worker
- Auth: clinician / staff authentication with audit logging

## AI / Agent Design

### Trial Chatbot

Use a constrained retrieval flow:

1. parse clinician question into filters
2. query normalized trial dataset
3. generate answer from returned records only
4. display citations to NCT IDs and source pages

Guardrails:

- never invent site availability or eligibility
- expose confidence when location matching is weak
- show "data last synced" timestamp

### Suspicious Listing Agent

Use a two-layer approach:

1. deterministic rules
2. LLM reasoning on extracted page text and metadata

Signals:

- medical claim language
- payment / cart / order flow
- protocol detail absence
- no recognized sponsor or registry references
- patient testimonial density
- cure / reversal promises

Human review remains mandatory before any enforcement action.

## Risks

- ClinicalTrials.gov data quality and inconsistent site metadata
- location normalization issues across city/state names
- false positives in suspicious listing detection
- clinicians over-trusting chat summaries if citations are weak
- alert fatigue without careful thresholds

## Near-Term Build Order

1. Stand up static UI prototype for clinician workflow validation
2. Implement ALS-specific data ingestion from ClinicalTrials.gov
3. Add structured search API and saved searches
4. Add snapshot diffs and notifications
5. Add suspicious listing intake + scoring queue

## Success Metrics

- time to identify relevant Boston-area ALS trials
- number of saved searches / watchlists per clinician
- alert open and click-through rate
- precision of suspicious listing flagging after human review
- reduction in manual trial landscape monitoring effort

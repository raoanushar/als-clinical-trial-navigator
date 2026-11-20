# Production handoff: ALS Clinical Trial Dashboard

## Purpose and current implementation

This project is Anusha Rao’s reference implementation for the SAVA AI / NEALS Expert Portal dashboard. It is intended to show:

- an ALS clinical-trial landscape sourced from ClinicalTrials.gov;
- dashboard filters, chart click-through, and trial-detail views;
- AI-assisted labels for targeted populations, placebo/control design, and intervention landscape; and
- the data fields and semantics required for production integration.

The current public dashboard deployment is a **dashboard-only reference**. The broader prototype includes additional clinician workflows and should be treated as a source of product ideas rather than a production-ready workflow system.

## Branches and URLs

| Branch | Purpose | Use it for |
|---|---|---|
| `expert-portal-prototype` | Full working prototype | Design review, feature exploration, and reference implementation |
| `expert-portal-live` | Shareable dashboard-only version | Render deployment and stakeholder review |

Repository: `https://github.com/raoanushar/als-clinical-trial-navigator`

The Render deployment is a convenience demo. The production team should deploy from its own organization/repository and own the resulting environment, secrets, database, and refresh jobs.

## System flow

```text
ClinicalTrials.gov v2 studies API
        ↓
normalizeStudy() — stable application trial record keyed by NCT ID
        ↓
registry cache + curated exclusions + AI/curated enrichment records
        ↓
dashboard aggregates, click-through filters, and trial detail UI
```

The server retrieves ALS studies from the ClinicalTrials.gov v2 API, normalizes them in `server.js`, and exposes dashboard APIs under `/api/...`.

## Core trial record: CT.gov-derived fields

`normalizeStudy()` in `server.js` is the canonical mapping. Every trial is keyed by `nctId`.

| Application field | CT.gov source / meaning |
|---|---|
| `nctId` | `identificationModule.nctId` |
| `title`, `officialTitle` | Brief and official title |
| `status` | Overall recruitment status |
| `studyType` | Interventional, Observational, Expanded Access, etc. |
| `phase` | Study phases; non-phase designs are retained as not applicable in UI logic |
| `primaryPurpose` | CT.gov design primary purpose |
| `sponsor` | Lead sponsor |
| `conditions` | Registry conditions |
| `interventions`, `interventionTypes`, `interventionDetails` | Arms/interventions module |
| `armGroups` | Registry arm groups, including arm type and description |
| `summary`, `detailedDescription` | Brief and detailed registry descriptions |
| `eligibilityCriteria`, `studyPopulation` | Eligibility module |
| `locations`, `cities`, `states` | Contacts/locations module; a study may have multiple locations/cities |
| `firstPostedAt`, `updatedAt`, `startDate`, completion dates | CT.gov status module dates |
| `url` | Canonical `https://clinicaltrials.gov/study/{NCT_ID}` URL |

### Location model

Locations are one-to-many. Keep a normalized `trial_sites` table in production rather than collapsing locations into a comma-separated field. The dashboard’s city counts count a study once per city, even when it has multiple sites in that city.

## Enrichment records

All enrichments are keyed by NCT ID and should be versioned separately from the CT.gov import. An enrichment must be considered stale when the relevant registry source content changes.

### 1. Targeted populations

Source prototype file: `data/targeting-analyses.json`  
Implementation: `trial-targeting.js`

This classifies whether an interventional trial explicitly targets or excludes a population in four dimensions:

```json
{
  "nctId": "NCT07204977",
  "findings": [{
    "dimension": "gene",
    "value": "C9ORF72",
    "relationship": "required",
    "cohort": "",
    "detail": "Human-readable interpretation",
    "evidence": [{
      "sourceField": "eligibilityCriteria",
      "quote": "Exact registry quote"
    }]
  }],
  "needsReview": false,
  "sourceHash": "sha256...",
  "analyzedAt": "ISO-8601 timestamp"
}
```

Allowed dimensions are `gene`, `phenotype`, `onset`, and `progression`. Production UI semantics:

- **Targeted**: a trial explicitly requires, studies, or has a defined cohort for the population.
- **Excluded**: the population is explicitly excluded.
- No exclusion tag does **not** establish eligibility.
- A trial can appear in more than one gene/population category.

### 2. Placebo / control design

Source prototype files: `reports/placebo-screening/{NCT_ID}.json`, `data/placebo-label-overrides.json`  
Implementation: `placebo-agent.js`, `dashboard-placebo.js`

Dashboard labels are:

- `Placebo` — includes a placebo comparator or sham procedure/device control.
- `No placebo` — available study-arm evidence supports no placebo or sham comparator.
- `Not specified` — registry information does not support a determination.
- `Not relevant` — manually assigned exception for the dashboard view.

Priority is: **manual expert override → current AI result → deterministic CT.gov arm rule**. Store the label, rationale, model/prompt version, `sourceHash`, timestamp, and manual-review metadata separately.

### 3. Intervention landscape

Source prototype file: `reports/intervention-landscape/parent-groups.json`

The dashboard presents parent groups and subcategories separately for:

- ALS treatments; and
- other interventions.

Examples include small molecules, genetic medicines, cell therapies, devices, and supportive/assessment interventions. A trial may belong to more than one parent group; each parent-group count is unique by NCT ID.

This output should become a versioned `trial_intervention_classifications` table with rows such as:

```text
nct_id | classification_set | parent_group | subcategory | confidence | evidence | source_version
```

## Dashboard filters and click-through API contract

All primary dashboard filters return trial summary rows with `nctId`, `title`, `status`, `sponsor`, and `phase`. The right-side drawer combines filters by intersection.

| Endpoint | Parameters | Meaning |
|---|---|---|
| `/api/overview` | `ongoingOnly=true` | Dashboard totals and chart aggregates |
| `/api/dashboard/status-trials` | repeated `status`, `ongoingOnly` | Recruitment-status selection |
| `/api/dashboard/phase-trials` | `phase`, `ongoingOnly` | Interventional phase selection |
| `/api/dashboard/study-type-trials` | `studyType`, `purpose`, `ongoingOnly` | Study-type / purpose selection |
| `/api/dashboard/population-trials` | `population`, `ongoingOnly` | AI-enriched target population selection |
| `/api/dashboard/placebo-trials` | `placebo`, `ongoingOnly` | AI/manual placebo selection |
| `/api/dashboard/intervention-trials` | comma-separated `ids`, `ongoingOnly` | Intervention-landscape selection |
| `/api/trial-details` | `nctId` | Full trial-detail payload |

`ongoingOnly=true` means `Recruiting`, `Active Not Recruiting`, `Not Yet Recruiting`, or `Available` (expanded access).

## Recommended production data model

Use a relational model or equivalent document model with NCT ID as the stable primary key:

```text
clinical_trials
trial_sites
trial_interventions
trial_arms
trial_import_versions
trial_targeting_findings
trial_placebo_assessments
trial_intervention_classifications
curation_decisions
```

Suggested requirements:

1. Preserve the raw CT.gov import or its revision identifier for provenance.
2. Keep CT.gov-derived data separate from AI and manual enrichments.
3. Store source hashes per enrichment so stale AI labels can be identified after a registry refresh.
4. Support multiple values per trial for sites, interventions, genes, phenotypes, and intervention groups.
5. Store manual overrides and decisions as append-only audit records rather than overwriting AI output.
6. Materialize dashboard aggregates or cache them for responsive filtering.

## Production-readiness assessment

### Ready to reuse

- Dashboard information architecture and visual implementation.
- CT.gov normalization logic and dashboard field semantics.
- NCT-ID keyed AI-enrichment contracts and source-hash approach.
- Filter/click-through behavior and API shapes.
- Curated category/group definitions included in the repository.

### Prototype limitations to address before production

- Data is stored in JSON files; replace with the production database and migrations.
- No authentication, authorization, rate limiting, or audit-grade access control is implemented.
- CT.gov refresh is application-driven; production needs a scheduled ingestion job and observability.
- AI calls and prompts need an approved secrets model, usage controls, evaluation, and monitoring.
- The repository has no CI pipeline, automated deployment tests, API contract tests, or formal schema migrations.
- The demo deployment uses seeded data; production needs a governed refresh/review lifecycle.

## Suggested first production milestone

1. Implement CT.gov ingestion and the normalized trial/site/intervention/arm schema.
2. Implement the `/api/overview`, dashboard filter endpoints, and trial-detail endpoint against the production database.
3. Port the dashboard UI and right-side drawer unchanged.
4. Import current curated/enrichment data keyed by NCT ID.
5. Add scheduled CT.gov refresh plus stale-enrichment detection.
6. Add authentication before enabling any clinician-specific review, saved-trial, or editing workflows.

## Prototype code map

| File | Responsibility |
|---|---|
| `server.js` | CT.gov ingestion, normalized record construction, dashboard APIs, and static server |
| `app.js` | Dashboard rendering and client-side UI behavior |
| `phase-drawer.js` | Right-side chart drill-down drawer and multi-filter intersection |
| `trial-targeting.js` | Targeted-population schema, source hashing, validation, and cache attachment |
| `placebo-agent.js` / `dashboard-placebo.js` | Placebo labeling and dashboard fallback logic |
| `intervention-landscape.js` | Intervention-screening result validation |
| `prompts/` | Reference prompts used for agent-assisted enrichment |


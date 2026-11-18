# SAVA AI Expert Portal: design handoff

This folder is the approved design for the Expert Portal, a clinician-facing view of SAVA AI built on this repo's existing ALS trial data. Implement it inside the current app (`index.html`, `styles.css`, `app.js`, `server.js`).

- `screens/` holds one static HTML mockup per screen. Open them in a browser to see the target layout. They link to each other through the sidebar.
- `tokens.css` holds the color, type and shape values. Use these variables in the real implementation instead of the literal hex codes in the mockups.
- All trial names, NCT IDs, counts and the doctor ("Dr. Elena Ruiz") are sample content. Replace them with live data. Text in [brackets] is a placeholder.

## Look and feel

- EverythingALS palette: navy `--navy` sidebar and primary buttons, coral `--coral` accents, blush `--blush` highlights, tan `--tan` for the SAVA AI mark. Page background `--page`, white cards.
- Headings in Poppins 600, body text in Inter, both from Google Fonts (see the `<link>` in any screen).
- Controls are pills (`--radius-pill`). Cards use `--radius-card`, a 1px `--border` and a very light shadow.
- Primary action = navy filled button. Secondary action = white button with a coral outline and `--coral-text` label. Use at most one primary button per area.
- Status is always a word in a pill, never color alone: Recruiting (`--ok`), Not yet recruiting (`--warn`), Active, not recruiting (neutral pill), high risk (`--risk`).
- Do not use `--coral` for small text on white. It is under 4.5:1. Use `--coral-text`.
- Layout is a navy sidebar (about 240px) beside a fluid content column, max width 1280px. Below about 800px the sidebar stacks above the content.

## Shared shell

Every screen has the same sidebar:
1. The SAVA AI mark and name, with "Expert Portal" under it.
2. Navigation: Dashboard, Search & Explore, Saved views (listed under Search & Explore), Trial Updates with a coral count badge.
3. The doctor's profile card at the bottom, linking to the Profile screen.

The current page's nav item takes the blush background.

## Screens

### 1. Dashboard (`screens/dashboard.html`)
An overview of the ALS trial landscape. It replaces and extends the current Dashboard tab.
- Header "ALS trial landscape" with a toggle between "Ongoing trials" and "All statuses". This is the current "Show ongoing trials only" switch.
- A blush banner: "N of your center's trials need an up-to-date check · N flagged trials to screen", linking to Trial Updates.
- KPI row: Ongoing ALS trials, Recruiting now, Interventional, Posted in last 30 days.
- Chart cards in a responsive grid:
  - Recruitment status as a donut with a legend.
  - Interventional vs observational vs expanded access as a stacked bar with counts and percentages.
  - Interventional trials by phase as horizontal bars.
  - Intervention type as horizontal bars.
  - Top U.S. cities as horizontal bars, counting unique trials rather than facilities.
  - Targeted populations, from the targeting data.
- New opportunities: the 3 most recently posted open or opening trials, as cards.
- Data: `/api/overview`, `/api/trials`, `/api/targeting/results`. The current `renderDashboard` logic in `app.js` already computes most of these breakdowns.

### 2. Search & Explore: Ask SAVA (`screens/search-ask.html`)
The default search is a conversation.
- Segmented control at the top right switches between "Ask SAVA" and "Filters".
- Saved views appear as pills under the header.
- The clinician types a question. SAVA answers in plain language, then shows:
  - a "Search used" row of the structured filters it applied, with an "Edit in filters" link that opens the Filters mode with those filters set;
  - compact result cards (title, NCT ID, phase, nearest site and distance, status pill);
  - "Open as table" and "Save as view" buttons;
  - suggested follow-up questions as pill buttons.
- The input is a rounded box at the bottom with a navy send button.
- Data: extend the existing natural-language search (`/api/trials` query parsing and `/api/new-york/chat`) so it returns both the answer text and the structured filters it used.

### 3. Search & Explore: Filters (`screens/search-filters.html`)
Classic search for clinicians who want direct control.
- Search bar, a filter panel (recruitment status, study type, phase, location with distance, intervention), and a results table.
- The table has a Columns button for choosing which columns show, sorting, and a checkbox per row for comparing trials.
- A navy bar appears when trials are selected: "N trials selected · Compare side by side".
- Saved views are named sets of filters and columns, for example "MGH trials", "Actively recruiting ALS trials", "Trials missing site contacts". "Save this view" stores the current filters. Selecting a saved view applies it. Saved views also appear in the sidebar.

### 4. Trial Updates
Two jobs, switched with a segmented control in the header and listed as two sub-items under Trial Updates in the sidebar. Both screens have a SAVA chat panel on the right.

**4a. My center's trials (`screens/trial-updates-my-center.html`)**
The expert keeps every trial listed at their own center (for example NYU Langone) up to date.
- An "Up-to-date check" card names the center and shows how many of its trials are confirmed against how many need a check, with a progress bar and a "Check next trial" button.
- "Needs your check" lists trials sorted by oldest check, each with an issue pill: Contact missing, Dates passed, Not checked.
- The open trial shows a checklist with a ✓ or ! per item:
  - recruitment status, with "Still recruiting" or "Change";
  - the center's site contact, with an input when it is missing;
  - eligibility;
  - timeline.
- Actions: "Not my trial" and "Confirm and submit". Confirming records the date of the check.
- Data: trials whose site list includes the expert's center (from `/api/trials` site data, matched to the profile's primary site). Issue detection can reuse the verification and consistency agents (`/api/inconsistency/*`). Check results and submitted edits need new endpoints and storage.

**4b. Flagged for screening (`screens/trial-updates-screening.html`)**
Experts screen listings SAVA flagged as possibly suspicious.
- Left: the flagged queue with risk pills (High, Medium) and flag dates, plus a link to already screened trials.
- Middle: the selected listing.
  - Registry facts: sponsor, study type, sites, posted date.
  - "Why SAVA flagged it": each reason with a short quote from the listing as evidence.
  - "Your assessment" radio cards: Suspicious, Looks legitimate, Not sure (sends to another expert).
  - An optional note, with "Skip for now" and "Submit assessment".
- Data: `/api/agent/high-risk`, `/api/agent/medium-risk` and `/api/agent/manual-review`. The agent's stored reasons and evidence feed the "Why" list.

**Chat panel (both screens)**
"Ask SAVA to make a change" lets the expert request edits in plain language, for example "Can you add NYU as a site for the Spinogenix trial?". SAVA replies with a proposed-change card listing the trial, the site, the status and the contact, with "Submit change" and "Edit" buttons. Nothing changes until the expert submits. On the screening screen the same panel answers questions about the open listing. This needs a new chat endpoint that turns a request into a structured edit (trial, field, new value) for review.

### 5. Profile (`screens/profile.html`)
The doctor's page.
- Header card: avatar initials, name, role, institution, a "Verified expert" pill and an "Edit profile" button.
- Focus areas as blush pills.
- Affiliated sites (the primary site decides which trials appear under "My center's trials"), Contact, and Notification switches: center trials need a check, new trials flagged for screening, status changes on followed trials, new trials near my sites, weekly email summary.
- Needs new user, profile and preferences storage. Nothing in the repo provides this yet.

## Out of scope for this design
- Sign-in and roles.
- The side-by-side compare view itself (only its entry point is designed).
- Mobile-specific layouts beyond the stacking described above.

const panels = document.querySelectorAll(".panel");
const tabButtons = document.querySelectorAll(".tab-button");
const chipButtons = document.querySelectorAll(".chip");
const queryInput = document.getElementById("query-input");
const runQueryButton = document.getElementById("run-query");
const syncButton = document.getElementById("sync-button");
const syncTimestamp = document.getElementById("sync-timestamp");
const filterSummary = document.getElementById("filter-summary");
const copilotSummary = document.getElementById("copilot-summary");
const resultsTitle = document.getElementById("results-title");
const resultsCount = document.getElementById("results-count");
const queryError = document.getElementById("query-error");
const trialResults = document.getElementById("trial-results");
const statusBars = document.getElementById("status-bars");
const cityList = document.getElementById("city-list");
const recentUpdates = document.getElementById("recent-updates");
const agentLimitInput = document.getElementById("agent-limit");
const agentDaysSelect = document.getElementById("agent-days");
const agentNctIdInput = document.getElementById("agent-nct-id");
const agentQueryInput = document.getElementById("agent-query");
const skipProcessedInput = document.getElementById("skip-processed");
const runAgentButton = document.getElementById("run-agent");
const continueAgentButton = document.getElementById("continue-agent");
const sortScoreButton = document.getElementById("sort-score");
const sortRecencyButton = document.getElementById("sort-recency");
const agentError = document.getElementById("agent-error");
const mediumRiskResults = document.getElementById("medium-risk-results");
const screenedSummary = document.getElementById("screened-summary");
const screenedResults = document.getElementById("screened-results");
const trialDetailModal = document.getElementById("trial-detail-modal");
const trialDetailKicker = document.getElementById("trial-detail-kicker");
const trialDetailTitle = document.getElementById("trial-detail-title");
const trialDetailBody = document.getElementById("trial-detail-body");
const closeTrialDetailButton = document.getElementById("close-trial-detail");

let latestAgentPayload = null;
let agentSortMode = "score";
let agentContinuation = null;

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    tabButtons.forEach((node) => node.classList.remove("is-active"));
    panels.forEach((panel) => panel.classList.remove("is-active"));
    button.classList.add("is-active");
    document.getElementById(button.dataset.panelTarget).classList.add("is-active");
  });
});

chipButtons.forEach((button) => {
  button.addEventListener("click", () => {
    queryInput.value = button.dataset.query;
    runQuery();
  });
});

runQueryButton.addEventListener("click", runQuery);
syncButton.addEventListener("click", syncTrials);
runAgentButton.addEventListener("click", () => runAgent());
continueAgentButton.addEventListener("click", () => runAgent({ continuation: agentContinuation }));
agentNctIdInput.addEventListener("input", updateAgentModeHint);
sortScoreButton.addEventListener("click", () => setAgentSortMode("score"));
sortRecencyButton.addEventListener("click", () => setAgentSortMode("recency"));
closeTrialDetailButton.addEventListener("click", closeTrialDetail);
trialDetailModal.addEventListener("click", (event) => {
  if (event.target.dataset.closeModal === "true") {
    closeTrialDetail();
  }
});

queryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    runQuery();
  }
});

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeArc(centerX, centerY, radius, startAngle, endAngle) {
  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${centerX} ${centerY} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

function renderStatusPie(statusCounts) {
  const colors = ["#1f6feb", "#16794a", "#d97706", "#bb2d3b", "#0f766e", "#7c3aed", "#64748b"];
  const total = statusCounts.reduce((sum, item) => sum + item.count, 0);

  if (!total) {
    statusBars.innerHTML = `<p class="subtle">No recruitment status data available.</p>`;
    return;
  }

  const primarySlices = statusCounts.slice(0, 6);
  const otherSlices = statusCounts.slice(6);
  const otherCount = otherSlices.reduce((sum, item) => sum + item.count, 0);
  const displaySlices = otherCount
    ? [
        ...primarySlices,
        {
          label: "Other",
          count: otherCount,
          percent: Math.round((otherCount / total) * 100),
          breakdown: otherSlices,
        },
      ]
    : primarySlices;

  let angle = 0;
  const slices = displaySlices.map((item, index) => {
    const sweep = (item.count / total) * 360;
    const slice = {
      ...item,
      color: colors[index % colors.length],
      path: describeArc(60, 60, 52, angle, angle + sweep),
    };
    angle += sweep;
    return slice;
  });

  statusBars.innerHTML = `
    <div class="status-pie-layout">
      <div class="status-pie-chart">
        <svg viewBox="0 0 120 120" aria-label="Recruitment status pie chart">
          ${slices.map((slice) => `<path d="${slice.path}" fill="${slice.color}"></path>`).join("")}
          <circle cx="60" cy="60" r="28" fill="#ffffff"></circle>
        </svg>
        <div class="status-pie-center">
          <strong>${total}</strong>
          <span>studies</span>
        </div>
      </div>
      <div class="status-pie-legend">
        ${slices
          .map(
            (slice) => `
              <button class="status-legend-row ${slice.label === "Other" ? "is-clickable" : ""}" type="button" ${slice.label === "Other" ? 'data-status-breakdown="other"' : "disabled"}>
                <div class="status-legend-label">
                  <span class="status-swatch" style="background:${slice.color}"></span>
                  <span>${slice.label}</span>
                </div>
                <div class="status-legend-value">
                  <strong>${slice.count} · ${slice.percent}%</strong>
                  ${slice.label === "Other" ? '<span class="status-dropdown-icon" aria-hidden="true">▾</span>' : ""}
                </div>
              </button>
            `
          )
          .join("")}
        ${
          otherCount
            ? `
              <div id="status-other-breakdown" class="status-breakdown" hidden>
                <p class="eyebrow">Other breakdown</p>
                <div class="status-breakdown-list">
                  ${otherSlices
                    .map(
                      (slice) => `
                        <div class="status-breakdown-row">
                          <span>${slice.label}</span>
                          <strong>${slice.count}</strong>
                        </div>
                      `
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }
      </div>
    </div>
  `;

  const breakdownToggle = statusBars.querySelector("[data-status-breakdown='other']");
  const breakdownPanel = statusBars.querySelector("#status-other-breakdown");
  if (breakdownToggle && breakdownPanel) {
    breakdownToggle.addEventListener("click", () => {
      breakdownPanel.hidden = !breakdownPanel.hidden;
      breakdownToggle.classList.toggle("is-active", !breakdownPanel.hidden);
      const icon = breakdownToggle.querySelector(".status-dropdown-icon");
      if (icon) {
        icon.textContent = breakdownPanel.hidden ? "▾" : "▴";
      }
    });
  }
}

async function fetchJson(url, options = {}) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error("Local API unreachable. Start the app with `node server.js` and open http://127.0.0.1:8000.");
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

function renderOverview(overview) {
  const stats = overview.stats;
  syncTimestamp.textContent = formatDateTime(overview.syncedAt);
  renderStatusPie(stats.statusCounts);

  cityList.innerHTML = stats.topCities
    .map((item) => `<div><strong>${item.city}</strong><span>${item.count} study records with sites</span></div>`)
    .join("");

  recentUpdates.innerHTML = stats.recentUpdates
    .map(
      (trial) => `
        <div>
          <strong>${trial.nctId}</strong>
          <span>${trial.title}</span>
          <span>Updated ${formatDate(trial.updatedAt)}</span>
        </div>
      `
    )
    .join("");

}

function renderFilters(filters) {
  filterSummary.innerHTML = filters.length
    ? filters.map((filter) => `<span class="filter-pill">${filter}</span>`).join("")
    : `<span class="filter-pill">Condition: ALS</span>`;
}

function renderTrials(result) {
  resultsTitle.textContent = result.trials.length ? "Matched ALS trials" : "No trials matched";
  if (result.totalMatches > result.trials.length) {
    resultsCount.textContent = `Showing ${result.trials.length} of ${result.totalMatches} matches`;
  } else {
    resultsCount.textContent = `${result.trials.length} result${result.trials.length === 1 ? "" : "s"}`;
  }
  copilotSummary.textContent = result.summary;

  if (!result.trials.length) {
    trialResults.innerHTML = `<article class="trial-card"><p>No trials matched this query in the current ClinicalTrials.gov ALS dataset.</p></article>`;
    return;
  }

  trialResults.innerHTML = result.trials
    .map(
      (trial) => `
        <article class="trial-card trial-card-clickable" data-open-trial="${trial.nctId}">
          <div class="trial-card-header">
            <div>
              <p class="eyebrow">${trial.nctId}</p>
              <h3>${trial.title}</h3>
            </div>
            <span class="status-badge ${statusClassName(trial.status)}">${trial.status}</span>
          </div>
          ${
            trial.agentAnalysis
              ? `
          <div class="agent-analysis-banner">
            <div class="agent-analysis-header">
              <strong>Stored agent analysis</strong>
              <span class="risk-badge ${trial.agentAnalysis.risk}">${trial.agentAnalysis.risk} risk</span>
            </div>
            <div class="trial-meta">
              <span class="meta-pill">Score ${trial.agentAnalysis.score}</span>
              <span class="meta-pill">${trial.agentHistoryCount || 1} run${trial.agentHistoryCount === 1 ? "" : "s"}</span>
              <span class="meta-pill">Analyzed ${formatDate(trial.agentAnalysis.analyzedAt)}</span>
            </div>
            <p>${trial.agentAnalysis.report}</p>
          </div>
          `
              : ""
          }
          <p>${trial.summary || "No brief summary available."}</p>
          <div class="trial-meta">
            <span class="meta-pill">${trial.phase}</span>
            <span class="meta-pill">${trial.studyType}</span>
            <span class="meta-pill">${trial.interventionSummary}</span>
            <span class="meta-pill">${trial.sponsor}</span>
          </div>
          <p class="trial-sites">${trial.locationSummary}</p>
          <p class="subtle">Updated ${formatDate(trial.updatedAt)} · <a href="${trial.url}" target="_blank" rel="noreferrer">View on ClinicalTrials.gov</a></p>
        </article>
      `
    )
    .join("");

  trialResults.querySelectorAll("[data-open-trial]").forEach((card) => {
    card.addEventListener("click", () => {
      openTrialDetail(card.dataset.openTrial);
    });
  });
}

function sortAgentReports(reports) {
  const cloned = [...reports];

  if (agentSortMode === "recency") {
    return cloned.sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || "") || 0;
      const rightTime = Date.parse(right.updatedAt || "") || 0;
      return rightTime - leftTime;
    });
  }

  return cloned.sort((left, right) => right.score - left.score);
}

function renderAgentResults(payload) {
  latestAgentPayload = payload;
  agentContinuation = payload.continuation || null;

  sortScoreButton.classList.toggle("is-active", agentSortMode === "score");
  sortRecencyButton.classList.toggle("is-active", agentSortMode === "recency");
  continueAgentButton.disabled = !payload.continuation || !payload.continuation.hasMore;
}

function renderMediumRiskTrials(payload) {
  if (!payload.trials.length) {
    mediumRiskResults.innerHTML = `
      <article class="listing-card">
        <p>No stored flagged trials yet.</p>
      </article>
    `;
    return;
  }

  mediumRiskResults.innerHTML = payload.trials
    .map(
      (trial) => `
        <article class="listing-card trial-card-clickable" data-open-trial="${trial.nctId}">
          <div class="listing-card-header">
            <div>
              <p class="eyebrow">${trial.nctId}</p>
              <h3>${trial.title}</h3>
            </div>
            <div class="listing-card-score">
              <span class="risk-badge ${trial.agentAnalysis.risk}">${trial.agentAnalysis.risk} risk</span>
              <div class="score">Score ${trial.agentAnalysis.score}</div>
            </div>
          </div>
          <p class="subtle">${trial.sponsor} · Updated ${formatDate(trial.agentAnalysis.analyzedAt)}</p>
        </article>
      `
    )
    .join("");

  mediumRiskResults.querySelectorAll("[data-open-trial]").forEach((card) => {
    card.addEventListener("click", () => {
      openTrialDetail(card.dataset.openTrial);
    });
  });
}

function renderScreenedTrials(payload) {
  const summary = payload.summary || { totalProcessed: 0, flaggedCount: 0, lowRiskCount: 0 };
  screenedSummary.innerHTML = `
    <span class="meta-pill">Processed ${summary.totalProcessed}</span>
    <span class="meta-pill">Flagged ${summary.flaggedCount}</span>
    <span class="meta-pill">Not flagged ${summary.lowRiskCount}</span>
  `;

  if (!payload.trials.length) {
    screenedResults.innerHTML = `
      <article class="listing-card">
        <p>No screened low-risk trials yet.</p>
      </article>
    `;
    return;
  }

  screenedResults.innerHTML = payload.trials
    .map(
      (trial) => `
        <button class="screened-row" type="button" data-open-trial="${trial.nctId}">
          <div class="screened-row-main">
            <strong>${trial.nctId}</strong>
            <span>${trial.title}</span>
          </div>
          <div class="screened-row-meta">
            <span class="risk-badge ${trial.agentAnalysis.risk}">${trial.agentAnalysis.risk} risk</span>
            <span class="meta-pill">Score ${trial.agentAnalysis.score}</span>
            <span class="subtle">Reviewed ${formatDate(trial.agentAnalysis.analyzedAt)}</span>
          </div>
        </button>
      `
    )
    .join("");

  screenedResults.querySelectorAll("[data-open-trial]").forEach((row) => {
    row.addEventListener("click", () => {
      openTrialDetail(row.dataset.openTrial);
    });
  });
}

function statusClassName(status) {
  return status.toLowerCase().replaceAll(",", "").replaceAll(" ", "-");
}

function updateAgentModeHint() {
  const nctId = agentNctIdInput.value.trim();

  if (nctId) {
    return;
  }
}

function setAgentSortMode(mode) {
  agentSortMode = mode;

  if (latestAgentPayload) {
    renderAgentResults(latestAgentPayload);
  }
}

async function loadOverview() {
  const overview = await fetchJson("/api/overview");
  renderOverview(overview);
}

async function loadMediumRiskTrials() {
  const payload = await fetchJson("/api/agent/medium-risk");
  renderMediumRiskTrials(payload);
}

async function loadScreenedTrials() {
  const payload = await fetchJson("/api/agent/screened");
  renderScreenedTrials(payload);
}

async function runQuery() {
  const query = queryInput.value.trim();
  queryError.hidden = true;
  runQueryButton.disabled = true;
  runQueryButton.textContent = "Searching...";

  try {
    const result = await fetchJson(`/api/trials?q=${encodeURIComponent(query)}`);
    renderFilters(result.filters);
    renderTrials(result);
  } catch (error) {
    queryError.hidden = false;
    queryError.textContent = error.message;
    copilotSummary.textContent = "Search failed.";
    trialResults.innerHTML = "";
  } finally {
    runQueryButton.disabled = false;
    runQueryButton.textContent = "Search";
  }
}

async function syncTrials() {
  syncButton.disabled = true;
  syncButton.textContent = "Syncing...";

  try {
    await fetchJson("/api/sync", { method: "POST" });
    await loadOverview();
    await runQuery();
    await loadMediumRiskTrials();
    await loadScreenedTrials();
  } catch (error) {
    queryError.hidden = false;
    queryError.textContent = error.message;
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = "Sync CT.gov";
  }
}

async function runAgent(options = {}) {
  const limit = Number.parseInt(agentLimitInput.value, 10) || 20;
  const days = Number.parseInt(agentDaysSelect.value, 10) || 90;
  const nctId = agentNctIdInput.value.trim();
  const query = agentQueryInput.value.trim();
  const skipProcessed = skipProcessedInput.checked;
  const continuation = options.continuation || null;

  agentError.hidden = true;
  runAgentButton.disabled = true;
  continueAgentButton.disabled = true;
  runAgentButton.textContent = "Running...";
  continueAgentButton.textContent = "Continuing...";

  try {
    const payload = await fetchJson("/api/agent/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        limit,
        days,
        nctId,
        query,
        skipProcessed,
        cursor: continuation ? continuation.nextCursor : 0,
        sequenceId: continuation ? continuation.sequenceId : "",
        runNumber: continuation ? continuation.nextRunNumber : 1,
      }),
    });

    renderAgentResults(payload);
    await loadMediumRiskTrials();
    await loadScreenedTrials();
  } catch (error) {
    agentError.hidden = false;
    agentError.textContent = error.message;
  } finally {
    runAgentButton.disabled = false;
    runAgentButton.textContent = "Run agent";
    continueAgentButton.textContent = "Continue run";
    if (latestAgentPayload && latestAgentPayload.continuation && latestAgentPayload.continuation.hasMore) {
      continueAgentButton.disabled = false;
    }
  }
}

function closeTrialDetail() {
  trialDetailModal.hidden = true;
  trialDetailBody.innerHTML = "";
}

function renderTrialDetail(payload) {
  const trial = payload.trial;
  const latestRun = (payload.agentHistory || [])[0] || trial.agentAnalysis || null;

  trialDetailKicker.textContent = trial.nctId;
  trialDetailTitle.textContent = trial.title;
  trialDetailBody.innerHTML = `
    <div class="modal-section">
      <p class="eyebrow">Quick links</p>
      <p><a href="${trial.url}" target="_blank" rel="noreferrer">Open this trial on ClinicalTrials.gov</a></p>
    </div>
    <div class="modal-section">
      <p class="eyebrow">AI assessment</p>
      ${
        latestRun
          ? `
            <div class="modal-assessment-card">
              <div class="modal-assessment-header">
                <div class="trial-meta">
                  <span class="risk-badge ${latestRun.risk}">${latestRun.risk} risk</span>
                  <span class="meta-pill">Score ${latestRun.score}</span>
                  <span class="meta-pill">Reviewed ${formatDate(latestRun.analyzedAt)}</span>
                  <span class="meta-pill">Model ${latestRun.model || "unknown"}</span>
                </div>
              </div>
              <div class="modal-copy-block">
                <p class="modal-label">Agent report</p>
                <p>${latestRun.report || "No report available."}</p>
              </div>
              <div class="modal-copy-block">
                <p class="modal-label">Rationale</p>
                <ul class="rationale-list">
                  ${(latestRun.reasons || []).map((reason) => `<li>${reason}</li>`).join("") || "<li>No rationale returned.</li>"}
                </ul>
              </div>
            </div>
          `
          : `<p class="subtle">This trial has not been processed by the agent yet.</p>`
      }
    </div>
    <div class="modal-section">
      <p class="eyebrow">Trial overview</p>
      <div class="trial-meta">
        <span class="meta-pill">${trial.status}</span>
        <span class="meta-pill">${trial.phase}</span>
        <span class="meta-pill">${trial.studyType}</span>
        <span class="meta-pill">${trial.sponsor}</span>
      </div>
      <p class="subtle">${trial.locationSummary}</p>
    </div>
    <div class="modal-section">
      <p class="eyebrow">Brief summary</p>
      <p>${trial.summary || "No brief summary available."}</p>
    </div>
    <div class="modal-section">
      <p class="eyebrow">Detailed description</p>
      <p>${trial.detailedDescription || "No detailed description stored in the current cache. Run a fresh CT.gov sync to populate newer fields."}</p>
    </div>
  `;
}

async function openTrialDetail(nctId) {
  trialDetailModal.hidden = false;
  trialDetailKicker.textContent = nctId;
  trialDetailTitle.textContent = "Loading trial...";
  trialDetailBody.innerHTML = `<div class="modal-section"><p>Loading trial details...</p></div>`;

  try {
    const payload = await fetchJson(`/api/trial-details?nctId=${encodeURIComponent(nctId)}`);
    renderTrialDetail(payload);
  } catch (error) {
    trialDetailBody.innerHTML = `<div class="modal-section"><p class="error-text">${error.message}</p></div>`;
  }
}

async function initialize() {
  try {
    await loadOverview();
    await runQuery();
    await loadMediumRiskTrials();
    await loadScreenedTrials();
    updateAgentModeHint();
  } catch (error) {
    queryError.hidden = false;
    queryError.textContent = error.message;
    copilotSummary.textContent = "Unable to load ClinicalTrials.gov data. The local backend is probably not running.";
  }
}

initialize();

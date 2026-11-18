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
const targetingResultsCount = document.getElementById("targeting-results-count");
const targetingSummary = document.getElementById("targeting-summary");
const targetingResults = document.getElementById("targeting-results");
const nyuSummary = document.getElementById("nyu-summary");
const nyuResultsTitle = document.getElementById("nyu-results-title");
const nyuResultsCount = document.getElementById("nyu-results-count");
const nyuResults = document.getElementById("nyu-results");
const newYorkChatLog = document.getElementById("new-york-chat-log");
const newYorkQuestionInput = document.getElementById("new-york-question");
const newYorkResetChatButton = document.getElementById("new-york-reset-chat");
const runNewYorkChatButton = document.getElementById("run-new-york-chat");
const newYorkChatError = document.getElementById("new-york-chat-error");
const dashboardActiveOnly = document.getElementById("dashboard-active-only");
const dashboardExport = document.getElementById("dashboard-export");
const dashboardFilterError = document.getElementById("dashboard-filter-error");
dashboardActiveOnly.checked = sessionStorage.getItem("dashboard_ongoing_only") !== "false";
function dashboardFilterQuery() {
  return `?ongoingOnly=${dashboardActiveOnly.checked}`;
}
dashboardExport.href = `/api/inconsistency/export-excel${dashboardFilterQuery()}`;
dashboardActiveOnly.addEventListener("change", async () => {
  sessionStorage.setItem("dashboard_ongoing_only", String(dashboardActiveOnly.checked));
  dashboardExport.href = `/api/inconsistency/export-excel${dashboardFilterQuery()}`;
  dashboardFilterError.hidden = true;
  dashboardActiveOnly.disabled = true;
  try {
    await Promise.all([loadOverview(), loadClassificationReport()]);
  } catch (error) {
    dashboardFilterError.textContent = `Could not refresh the dashboard. Reload the page to retry. ${error.message}`;
    dashboardFilterError.hidden = false;
  } finally {
    dashboardActiveOnly.disabled = false;
  }
});
const statusBars = document.getElementById("status-bars");
const studyTypeBreakdown = document.getElementById("study-type-breakdown");
const phaseBreakdown = document.getElementById("phase-breakdown");
const newOpportunityList = document.getElementById("new-opportunity-list");
const classificationReportSummary = document.getElementById("classification-report-summary");
const classificationReportResults = document.getElementById("classification-report-results");
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
const physicianReviewResults = document.getElementById("physician-review-results");
const registryUpdateResults = document.getElementById("registry-update-results");
const verifiedResultsCount = document.getElementById("verified-results-count");
const verifiedResults = document.getElementById("verified-results");
const inconsistencyNctIdInput = document.getElementById("inconsistency-nct-id");
const inconsistencyLimitInput = document.getElementById("inconsistency-limit");
const inconsistencyDaysInput = document.getElementById("inconsistency-days");
const inconsistencyQueryInput = document.getElementById("inconsistency-query");
const inconsistencyStatusInputs = document.querySelectorAll(".inconsistency-status-filter");
const skipInconsistencyProcessedInput = document.getElementById("skip-inconsistency-processed");
const runInconsistencyButton = document.getElementById("run-inconsistency");
const continueInconsistencyButton = document.getElementById("continue-inconsistency");
const inconsistencyError = document.getElementById("inconsistency-error");
const inconsistencySummary = document.getElementById("inconsistency-summary");
const inconsistencyPreviewCount = document.getElementById("inconsistency-preview-count");
const inconsistencyPreviewSummary = document.getElementById("inconsistency-preview-summary");
const inconsistencyPreviewResults = document.getElementById("inconsistency-preview-results");
const inconsistencyMismatchResults = document.getElementById("inconsistency-mismatch-results");
const inconsistencyDrugResults = document.getElementById("inconsistency-drug-results");
const inconsistencyOtherCount = document.getElementById("inconsistency-other-count");
const inconsistencyOtherResults = document.getElementById("inconsistency-other-results");
const trialDetailModal = document.getElementById("trial-detail-modal");
const trialDetailKicker = document.getElementById("trial-detail-kicker");
const trialDetailTitle = document.getElementById("trial-detail-title");
const trialDetailBody = document.getElementById("trial-detail-body");
const closeTrialDetailButton = document.getElementById("close-trial-detail");
const NEW_YORK_CONVERSATION_STORAGE_KEY = "new_york_chat_conversation_id";

let latestAgentPayload = null;
let agentSortMode = "score";
let agentContinuation = null;
let newYorkDatabasePayload = null;
let newYorkConversationId = sessionStorage.getItem(NEW_YORK_CONVERSATION_STORAGE_KEY) || "";
let verificationDemoPayload = null;
let inconsistencyContinuation = null;

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    tabButtons.forEach((node) => { node.classList.remove("is-active"); node.removeAttribute("aria-current"); });
    panels.forEach((panel) => panel.classList.remove("is-active"));
    button.classList.add("is-active");
    button.setAttribute("aria-current", "page");
    document.getElementById(button.dataset.panelTarget).classList.add("is-active");
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
});

chipButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (typeof button.dataset.query === "undefined") {
      return;
    }
    queryInput.value = button.dataset.query;
    runQuery();
  });
});

runQueryButton.addEventListener("click", () => { if (savaPending) savaRequestController?.abort(); else runQuery(); });
syncButton.addEventListener("click", syncTrials);
runAgentButton.addEventListener("click", () => runAgent());
continueAgentButton.addEventListener("click", () => runAgent({ continuation: agentContinuation }));
runInconsistencyButton.addEventListener("click", () => runInconsistencyAgent());
continueInconsistencyButton.addEventListener("click", () => runInconsistencyAgent({ continuation: inconsistencyContinuation }));
runNewYorkChatButton.addEventListener("click", runNewYorkChat);
newYorkResetChatButton.addEventListener("click", resetNewYorkChat);
agentNctIdInput.addEventListener("input", updateAgentModeHint);
[
  inconsistencyNctIdInput,
  inconsistencyLimitInput,
  inconsistencyDaysInput,
  inconsistencyQueryInput,
  skipInconsistencyProcessedInput,
  ...inconsistencyStatusInputs,
].forEach((input) => {
  input.addEventListener("input", loadInconsistencyPreview);
  input.addEventListener("change", loadInconsistencyPreview);
});
sortScoreButton.addEventListener("click", () => setAgentSortMode("score"));
sortRecencyButton.addEventListener("click", () => setAgentSortMode("recency"));
closeTrialDetailButton.addEventListener("click", closeTrialDetail);
trialDetailModal.addEventListener("click", (event) => {
  if (event.target.dataset.closeModal === "true") {
    closeTrialDetail();
  }
});

queryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!runQueryButton.disabled && !savaPending) runQuery();
  }
});

newYorkQuestionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    runNewYorkChat();
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCtgovTrialUrl(nctId) {
  return `https://clinicaltrials.gov/study/${nctId}`;
}

function linkifyNctIds(value) {
  return escapeHtml(value).replace(/\b(NCT\d{8})\b/gi, (match, nctId) => {
    const normalized = String(nctId).toUpperCase();
    return `<a class="inline-nct-link" href="${buildCtgovTrialUrl(normalized)}" target="_blank" rel="noreferrer">${normalized}</a>`;
  });
}

function cleanChatAnswerText(text) {
  let value = String(text || "");

  value = value.replace(/```json\s*[\s\r\n]*\{[\s\S]*?"citedNctIds"[\s\S]*?\}[\s\r\n]*```/gi, "");
  value = value.replace(/```[\s\S]*?```/g, (block) => {
    const inner = block.replace(/^```[a-zA-Z0-9_-]*\s*/i, "").replace(/```$/, "").trim();
    return inner ? `\n${inner}\n` : "\n";
  });
  value = value.replace(/\*\*(.*?)\*\*/g, "$1");
  value = value.replace(/\*(.*?)\*/g, "$1");
  value = value.replace(/`([^`]+)`/g, "$1");
  value = value.replace(/\n{3,}/g, "\n\n");

  return value.trim();
}

function formatChatAnswer(text) {
  const lines = cleanChatAnswerText(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return "<p>No answer returned.</p>";
  }

  const parts = [];
  let currentList = [];

  const flushList = () => {
    if (!currentList.length) {
      return;
    }
    parts.push(`<ul>${currentList.map((item) => `<li>${linkifyNctIds(item)}</li>`).join("")}</ul>`);
    currentList = [];
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      currentList.push(bulletMatch[1]);
      continue;
    }

    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      currentList.push(numberedMatch[1]);
      continue;
    }

    flushList();
    parts.push(`<p>${linkifyNctIds(line)}</p>`);
  }

  flushList();
  return parts.join("");
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
  statusCounts = statusCounts.map(item => ({...item, label: item.label === "Available" ? "Available Expanded Access Programs" : item.label}));
  const colors = ["var(--navy)", "var(--coral)", "var(--tan)", "var(--slate)", "var(--ok)", "var(--warn)", "var(--muted)"];
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
          <circle cx="60" cy="60" r="34" fill="var(--surface)"></circle>
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
                <div class="status-legend-value dashboard-pie-value">
                  <span><strong>${slice.count}</strong> studies<small>${slice.percent}% of total</small></span>
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
    if (error.name === "AbortError") throw error;
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
  document.getElementById('dashboard-top-cities').innerHTML=(stats.topCities||[]).map((city,index)=>`<div class="dashboard-city-row"><small>${index+1}</small><span>${escapeHtml(city.city)}</span><b>${city.count}</b></div>`).join('')||'<p class="subtle">No listed cities in this scope.</p>';
  const syncedAt = new Date(overview.syncedAt);
  syncTimestamp.textContent = overview.syncedAt && !Number.isNaN(syncedAt.getTime())
    ? syncedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "Unknown";
  renderStatusPie(stats.statusCounts);
  window.setupStatusDrawer(statusBars, stats.statusCounts, dashboardActiveOnly.checked);

  renderStudyTypeHierarchy(studyTypeBreakdown, stats.studyTypeCounts || [], overview.totalIndexed);
  renderDashboardPie(phaseBreakdown, (stats.phaseCounts || []).map(item => ({...item, label: item.label === "Not applicable" ? "Not applicable*" : item.label})), "Interventional trials by phase", "trials", "trials");
  window.setupPhaseDrawer(phaseBreakdown, stats.phaseCounts || [], dashboardActiveOnly.checked);
  const kpis = [[dashboardActiveOnly.checked ? "Ongoing ALS trials" : "All ALS trials", overview.totalIndexed], ["Recruiting now", stats.recruitingCount], ["Interventional", stats.phaseTotal], ["Posted in last 30 days", stats.postedLast30Days]];
  document.getElementById("portal-kpis").innerHTML = kpis.map(([label, count], index) => `<article class="stat-card"><span>${label}</span>${index===3?`<button id="recent-trials-count" class="stat-count-link" type="button" aria-label="View ${count ?? 0} trials posted in the last 30 days"><strong>${count ?? "—"}</strong></button>`:`<strong>${count ?? "—"}</strong>`}</article>`).join("");
  renderDashboardBreakdown(document.getElementById("population-breakdown"), (stats.populationCounts || []).filter(group => group.label !== "No positive target identified"), stats.targetingScreenedCount || 0, "trials");
  window.setupPopulationDrawer(document.getElementById("population-breakdown"), (stats.populationCounts || []).filter(group => group.label !== "No positive target identified"), dashboardActiveOnly.checked);
  const placeboContainer = document.getElementById('placebo-breakdown');
  renderDashboardPie(placeboContainer, stats.placeboCounts || [], 'AI placebo classifications', 'trials', 'trials');
  placeboContainer.querySelectorAll('.status-legend-row').forEach((row,index) => {
    const label = stats.placeboCounts[index].label;
    row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`View ${label.toLowerCase()} trials`);
    row.onclick=()=>window.openPlaceboDrawer(label,dashboardActiveOnly.checked);
    row.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();row.click();}};
  });
  const registryPlaceboContainer = document.getElementById('registry-placebo-breakdown');
  renderDashboardBreakdown(registryPlaceboContainer, (stats.registryPlaceboCounts || []).map(item => ({...item,percent:Math.round(item.count/(stats.phaseTotal||1)*100)})), stats.phaseTotal || 0, 'trials');
  registryPlaceboContainer.querySelectorAll('.dashboard-breakdown-row').forEach((row,index) => {
    const label = stats.registryPlaceboCounts[index].label;
    row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`View CT.gov ${label.toLowerCase()} trials`);
    row.onclick=()=>window.openRegistryPlaceboDrawer(label,dashboardActiveOnly.checked);
    row.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();row.click();}};
  });
  const populationRows = [...document.querySelectorAll('#population-breakdown > .dashboard-breakdown-row')];
  const geneRow = populationRows.find(row => row.querySelector('strong')?.textContent === 'Gene-defined');
  if (geneRow && !Array.isArray(stats.geneticPopulationCounts)) {
    const notice = document.createElement('p');
    notice.className = 'subtle genetic-breakdown-restart';
    notice.textContent = 'Restart the app to load the breakdown by gene.';
    geneRow.after(notice);
  }
  if (geneRow && stats.geneticPopulationCounts?.length) {
    const children = document.createElement('div');
    children.className = 'population-gene-children';
    children.setAttribute('aria-label', 'Gene-defined population breakdown');
    const uniqueGeneTrials = (stats.populationCounts || []).find(group => group.label === 'Gene-defined')?.count || 0;
    geneRow.classList.add('population-gene-parent');
    geneRow.querySelector('strong').textContent = 'Genetic populations';
    geneRow.querySelector('.dashboard-breakdown-track')?.remove();
    geneRow.querySelector('.dashboard-breakdown-value').innerHTML = `<b>${uniqueGeneTrials}</b> <span>targeted trials</span>`;
    children.innerHTML = `<table class="population-gene-table"><thead><tr><th scope="col">Gene</th><th scope="col" class="gene-include">Targets gene carriers</th><th scope="col">Excludes gene carriers</th></tr></thead><tbody>${stats.geneticPopulationCounts.map((group,index) => `<tr><th scope="row">${escapeHtml(group.label)}</th>${['include','exclude'].map(relationship => {
      const count = relationship === 'include' ? group.count : group.excludeCount;
      return `<td>${Number.isFinite(count) ? `<button type="button" data-gene="${index}" class="gene-${relationship}" data-relationship="${relationship}" aria-label="View ${count} trials that ${relationship === 'include' ? 'target' : 'exclude'} ${escapeHtml(group.label)} populations">${count}</button>` : '—'}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table><ul class="population-gene-explanation"><li><strong>Targets:</strong> Trials specifically studying people with this gene mutation.</li><li><strong>Excludes:</strong> Trials that exclude these carriers, sometimes only under certain conditions.</li></ul>`;
    geneRow.after(children);
    children.querySelectorAll('button').forEach(button => button.onclick = () => window.openGeneticPopulationDrawer(stats.geneticPopulationCounts[Number(button.dataset.gene)].label, dashboardActiveOnly.checked, button.dataset.relationship));
  }
  document.getElementById("population-note").textContent = `${stats.targetingScreenedCount ?? 0} of ${stats.phaseTotal} interventional trials have targeting analyses. Groups can overlap; exclusions are not counted as targets.`;

  const recentTrials = stats.newOpportunities || [];
  const recentToggle = document.getElementById('toggle-recent-trials');
  let recentExpanded = false;
  function renderRecentTrials(){
  recentToggle.hidden = recentTrials.length <= 3;
  recentToggle.setAttribute('aria-expanded', String(recentExpanded));
  recentToggle.textContent = recentExpanded ? 'Show fewer' : `Show all ${recentTrials.length} trials`;
  newOpportunityList.innerHTML = (recentExpanded ? recentTrials : recentTrials.slice(0, 3))
    .map(
      (trial) => `
        <button class="opportunity-card" type="button" data-open-trial="${escapeHtml(trial.nctId)}">
          <div class="opportunity-card-topline">
            <span class="status-badge ${statusClassName(trial.status)}">${escapeHtml(trial.status)}</span>
            <span>Posted ${formatDate(trial.firstPostedAt)}</span>
          </div>
          <h4>${escapeHtml(trial.title)}</h4>
          <p>${escapeHtml(trial.explainer)}</p>
          <div class="opportunity-card-meta">
            <span>${escapeHtml(trial.studyType)}</span>
            ${trial.studyType === "Interventional" ? `<span>${escapeHtml(trial.phase === "Na" ? "Phase not applicable" : trial.phase)}</span>` : ""}
          </div>
          <div class="opportunity-card-footer"><span>View trial details</span><small>${escapeHtml(trial.nctId)}</small></div>
        </button>`
    )
    .join("") || '<p class="subtle">No trials posted in the last 30 days.</p>';

  newOpportunityList.querySelectorAll("[data-open-trial]").forEach((card) => {
    card.addEventListener("click", () => openTrialDetail(card.dataset.openTrial));
  });
  }
  recentToggle.onclick = () => { recentExpanded = !recentExpanded; renderRecentTrials(); };
  document.getElementById('recent-trials-count').onclick = () => {
    recentExpanded = true; renderRecentTrials();
    const section = document.getElementById('recently-posted-trials');
    section.focus({preventScroll:true});
    section.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  };
  renderRecentTrials();

}

function renderDashboardPie(container, counts, ariaLabel, centerLabel, unit = "studies") {
  const colors = ["var(--navy)", "var(--coral)", "var(--tan)", "var(--slate)", "var(--ok)", "var(--warn)", "var(--muted)"];
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  if (!total) {
    container.innerHTML = `<p class="subtle">No data in the current dashboard filter.</p>`;
    return;
  }

  let angle = 0;
  const slices = counts.map((item, index) => {
    const sweep = (item.count / total) * 360;
    const slice = { ...item, percent: Math.round(item.count / total * 100), color: colors[index % colors.length], path: describeArc(60, 60, 52, angle, angle + sweep) };
    angle += sweep;
    return slice;
  });

  container.innerHTML = `
    <div class="status-pie-layout">
      <div class="status-pie-chart">
        <svg viewBox="0 0 120 120" aria-label="${escapeHtml(ariaLabel)}">
          ${slices.map((slice) => `${slice.count === total ? `<circle cx="60" cy="60" r="52" fill="${slice.color}"></circle>` : `<path d="${slice.path}" fill="${slice.color}"></path>`}`).join("")}
          <circle cx="60" cy="60" r="34" fill="var(--surface)"></circle>
        </svg>
        <div class="status-pie-center"><strong>${total}</strong><span>${escapeHtml(centerLabel)}</span></div>
      </div>
      <div class="status-pie-legend">
        ${slices
          .map(
            (slice) => `
              <div class="status-legend-row">
                <div class="status-legend-label"><span class="status-swatch" style="background:${slice.color}"></span><span>${escapeHtml(slice.label)}</span></div>
                <div class="status-legend-value dashboard-pie-value"><span><strong>${slice.count}</strong> ${escapeHtml(unit)}<small>${slice.percent}% of total</small></span></div>
              </div>`
          )
          .join("")}
      </div>
    </div>`;
}

function renderStudyTypeHierarchy(container, items, total) {
  const children=items.filter(item=>item.label.startsWith('Interventional — '));
  const interventional=children.reduce((sum,item)=>sum+item.count,0);
  const parents=items.filter(item=>!item.label.startsWith('Interventional — '));
  if(children.length)parents.unshift({label:'Interventional',count:interventional});
  container.innerHTML='<div class="study-type-chart"></div>';
  renderDashboardPie(container.querySelector('.study-type-chart'),parents,'Study types','studies','studies');
  if(!interventional){window.setupStudyTypeDrawer(container,parents,[],dashboardActiveOnly.checked);return;}
  const labels=['treatment','other purposes','purpose unspecified'];
  const selections=[];
 const select=(label,ids)=>{const index=selections.length;selections.push({label,ids});return `data-intervention-selection="${index}"`;};
 const colors=['var(--navy)','var(--coral)','var(--tan)'];
  const parts=labels.map((key,index)=>({purpose:key==='other purposes'?'other':key==='purpose unspecified'?'unspecified':'treatment',label:key==='treatment'?'ALS treatments':key==='other purposes'?'Other interventions':'Unspecified',count:children.find(item=>item.label==='Interventional — '+key)?.count||0,color:colors[index]})).filter(item=>item.count);
  const row=container.querySelector('.status-legend-row');
  const group=document.createElement('div');
  group.className='study-interventional-group';
  row.replaceWith(group);
  group.appendChild(row);
  group.insertAdjacentHTML('beforeend',`<div class="study-purpose-inline">${parts.map(item=>`<div class="study-purpose-inline-row"><span><i style="background:${item.color}"></i>${escapeHtml(item.label)}</span><span><b>${item.count}</b> <small>${Math.round(item.count/interventional*100)}%</small></span></div>`).join('')}<p class="study-purpose-inline-note">Other interventions study ALS diagnostics, device feasibility, supportive care, or basic science rather than treatment.</p></div>`);

  window.setupStudyTypeDrawer(container,parents,parts,dashboardActiveOnly.checked);
}

function renderDashboardBreakdown(container, items, total, unit) {
  container.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <div class="dashboard-breakdown-row">
              <div class="dashboard-breakdown-label">
                <strong>${escapeHtml(item.label)}</strong>
                <span class="dashboard-breakdown-value"><b>${item.count}</b> ${escapeHtml(unit)} <small>${item.percent}% of total</small></span>
              </div>
              <div class="dashboard-breakdown-track" aria-hidden="true"><span style="width:${Math.max(0, item.percent)}%"></span></div>
            </div>`
        )
        .join("")
    : `<p class="subtle">No records in the current dashboard filter.</p>`;
  container.setAttribute("aria-label", `${total} ${unit}`);
}

function renderClassificationBanner(report) {
  if (!report) {
    return "";
  }

  return `
    <div class="agent-analysis-banner classification-analysis-banner">
      <div class="agent-analysis-header">
        <strong>Study-type consistency</strong>
        <span class="${inconsistencyBadgeClass(report)}">${escapeHtml(inconsistencyBadgeLabel(report))}</span>
      </div>
      <div class="trial-meta">
        <span class="meta-pill">${report.studyTypeMatch === false ? "Does not agree" : "Agrees"}</span>
        <span class="meta-pill">AI: ${escapeHtml(report.inferredStudyType || "Unclear")}</span>
        <span class="meta-pill">CT.gov: ${escapeHtml(report.registeredStudyType || "")}</span>
        <span class="meta-pill">Confidence ${escapeHtml(report.confidenceScore ?? "")}</span>
      </div>
      <p>${escapeHtml(report.rationale || report.studyTypeIssue || "")}</p>
    </div>
  `;
}

function renderClassificationReport(payload) {
  const summary = payload.summary || {};
  const rows = payload.rows || [];

  classificationReportSummary.textContent = summary.totalTrials
    ? `${summary.reviewedCount} of ${summary.totalTrials} trials reviewed. ${summary.mismatchCount} mismatch${summary.mismatchCount === 1 ? "" : "es"} found. ${summary.unreviewedCount} trials still need AI classification.`
    : "No trials are available in the current cache.";

  const visibleRows = rows.filter((row) => row.reviewed).slice(0, 12);
  classificationReportResults.innerHTML = visibleRows.length
    ? visibleRows
        .map(
          (row) => `
            <article class="listing-card verification-card trial-card-clickable" data-open-trial="${row.nctId}">
              <div class="listing-card-header">
                <div>
                  <p class="eyebrow">${escapeHtml(row.nctId)}</p>
                  <h3>${escapeHtml(row.title)}</h3>
                </div>
                <div class="listing-card-score">
                  <span class="${row.agree === "No" ? "verification-badge physician-review" : "verification-badge verified"}">${row.agree === "No" ? "Mismatch" : "Agrees"}</span>
                  <div class="score">${escapeHtml(row.confidenceScore || "")}</div>
                </div>
              </div>
              <div class="trial-meta">
                <span class="meta-pill">CT.gov: ${escapeHtml(row.ctgovClassification || "")}</span>
                <span class="meta-pill">AI: ${escapeHtml(row.aiClassification || "Not reviewed")}</span>
                ${
                  row.interventionalSubtype
                    ? `<span class="meta-pill">${escapeHtml(row.interventionalSubtype)}</span>`
                    : ""
                }
                ${
                  row.landscapeSubcategory || row.landscapeCategory
                    ? `<span class="meta-pill">${escapeHtml(row.landscapeSubcategory || row.landscapeCategory)}</span>`
                    : ""
                }
                ${
                  row.geneTarget && !["Not applicable", "Sporadic/non-genetic"].includes(row.geneTarget)
                    ? `<span class="meta-pill">Gene ${escapeHtml(row.geneTarget)}</span>`
                    : ""
                }
                ${
                  row.devicePurpose && row.devicePurpose !== "Not applicable"
                    ? `<span class="meta-pill">${escapeHtml(row.devicePurpose)}</span>`
                    : ""
                }
              </div>
              <p class="verification-rationale">${escapeHtml(row.aiExplainer || row.studyTypeIssue || "")}</p>
            </article>
          `
        )
        .join("")
    : `<article class="listing-card"><p>No stored AI classification reviews yet. Run the consistency agent to populate this dashboard report.</p></article>`;

  classificationReportResults.querySelectorAll("[data-open-trial]").forEach((card) => {
    card.addEventListener("click", () => {
      openTrialDetail(card.dataset.openTrial);
    });
  });
}

function renderFilters(filters) {
  filterSummary.innerHTML = filters.length
    ? filters.map((filter) => `<span class="filter-pill">${escapeHtml(filter)}</span>`).join("")
    : "";
}

function humanizeTargetingValue(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\blimb onset\b/gi, "Limb onset")
    .replace(/\bbulbar onset\b/gi, "Bulbar onset")
    .replace(/\bbilateral upper limb paresis\b/gi, "Bilateral upper limb paresis")
    .replace(/\bals\b/gi, "ALS")
    .replace(/\bftd\b/gi, "FTD")
    .replace(/\bc9orf72\b/gi, "C9ORF72")
    .replace(/\bsod1\b/gi, "SOD1")
    .replace(/\bfus\b/gi, "FUS")
    .replace(/\bsetx\b/gi, "SETX");
}

function renderTargetingFindings(targeting, options = {}) {
  if (targeting?.status !== "screened") return "";
  const findings = targeting.findings || [];
  if (!findings.length) {
    return `<div class="targeting-empty">No specific ALS phenotype, onset, progression, or gene targeting found.</div>`;
  }

  return `<div class="targeting-findings ${options.compact ? "is-compact" : ""}">
    ${findings
      .map(
        (finding) => `
          <article class="targeting-finding">
            <div class="targeting-finding-header">
              <span class="targeting-dimension">${escapeHtml(humanizeTargetingValue(finding.dimension))}</span>
              <strong>${escapeHtml(humanizeTargetingValue(finding.value))}</strong>
              <span class="targeting-relationship ${escapeHtml(finding.relationship)}">${escapeHtml(humanizeTargetingValue(finding.relationship))}</span>
            </div>
            ${finding.cohort ? `<p class="targeting-cohort"><strong>Cohort:</strong> ${escapeHtml(finding.cohort)}</p>` : ""}
            <p>${escapeHtml(finding.detail)}</p>
            ${
              options.compact
                ? ""
                : `<details class="targeting-evidence">
                    <summary>View source evidence</summary>
                    ${(finding.evidence || [])
                      .map(
                        (evidence) => `
                          <div class="targeting-quote">
                            <span>${escapeHtml(humanizeTargetingValue(evidence.sourceField))}</span>
                            <blockquote>${escapeHtml(evidence.quote)}</blockquote>
                          </div>`
                      )
                      .join("")}
                  </details>`
            }
          </article>`
      )
      .join("")}
  </div>`;
}

function renderTargetingBanner(targeting) {
  if (targeting?.status !== "screened") return "";
  const specificDimensions = Object.entries(targeting.dimensions || {})
    .filter(([, status]) => status === "specific")
    .map(([dimension]) => humanizeTargetingValue(dimension));
  return `
    <div class="targeting-card-banner">
      <strong>Targeting screened</strong>
      <span>${specificDimensions.length ? escapeHtml(specificDimensions.join(" · ")) : "No specific targeting found"}</span>
    </div>`;
}

function targetingFindingCategory(finding) {
  if (finding.relationship === "excluded") return "excluded";
  if (finding.relationship === "cohort") {
    const detail = String(finding.detail || "");
    const value = String(finding.value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const directlyExcluded = new RegExp(
      `(?:\\b${value}\\b[^.]{0,80}\\b(?:is|are) excluded\\b|\\b(?:is|are) excluded\\b[^.]{0,120}\\b${value}\\b)`,
      "i"
    ).test(detail);
    if (directlyExcluded && !new RegExp(`\\bbesides\\s+${value}\\b`, "i").test(detail)) return "excluded";
  }
  if (finding.relationship === "allowed") return "allowed";
  if (finding.relationship === "required") return "whole";
  if (finding.relationship === "cohort") return "cohort";
  if (finding.relationship === "study_focus") return "focus";
  return "context";
}

function isConditionalExclusionFinding(finding) {
  if (finding.relationship !== "excluded") return true;
  return /\b(?:and (?:is|are) currently|if (?:they|the participant|participants?|patients?|subjects?) (?:is|are) (?:receiving|on|eligible)|while (?:receiving|on))\b/i.test(
    finding.detail || ""
  );
}

function canonicalTargetingCluster(dimension, value) {
  const normalized = String(value || "").toLowerCase();
  if (dimension === "gene") return { key: normalized, label: String(value || "").toUpperCase() };
  if (dimension === "onset") return { key: normalized, label: humanizeTargetingValue(value) };
  if (dimension === "progression") return { key: "progression_constraint", label: "Progression eligibility constraint" };
  if (/^fus[_ -]?als$/.test(normalized)) return { key: "fus_als", label: "FUS-associated ALS" };
  if (/^sod1[_ -]?als$/.test(normalized)) return { key: "sod1_als", label: "SOD1-associated ALS" };
  if (/c9orf72/.test(normalized)) return { key: "c9orf72_als_ftd", label: "C9ORF72-associated ALS/FTD" };
  if (/ftd|frontotemporal/.test(normalized)) return { key: "als_ftd", label: "ALS/FTD" };
  if (/sporadic/.test(normalized)) return { key: "sporadic_als", label: "Sporadic ALS" };
  if (/familial|hereditary/.test(normalized)) return { key: "familial_als", label: "Familial / hereditary ALS" };
  if (/bulbar/.test(normalized)) return { key: "bulbar_involvement", label: "Bulbar involvement" };
  if (/presymptomatic.*gene|premotor.*mutation/.test(normalized)) return { key: "presymptomatic_carriers", label: "Presymptomatic gene carriers" };
  return { key: normalized, label: humanizeTargetingValue(value) };
}

function targetingFindingLabel(finding) {
  return canonicalTargetingCluster(finding.dimension, finding.value).label;
}

function naturalList(values) {
  const uniqueValues = [...new Set(values.filter(Boolean))];
  if (uniqueValues.length < 2) return uniqueValues[0] || "";
  if (uniqueValues.length === 2) return `${uniqueValues[0]} and ${uniqueValues[1]}`;
  return `${uniqueValues.slice(0, -1).join(", ")}, and ${uniqueValues.at(-1)}`;
}

function plainLanguageTargetingSummary(trial) {
  const findings = (trial.targeting.findings || []).filter((finding) => targetingFindingCategory(finding) !== "context");
  const byCategory = (category) => findings.filter((finding) => targetingFindingCategory(finding) === category);
  const required = byCategory("whole");
  const requiredGenes = required.filter((finding) => finding.dimension === "gene").map(targetingFindingLabel);
  const requiredPhenotypes = required.filter((finding) => finding.dimension === "phenotype").map(targetingFindingLabel);
  const remainingRequired = required.filter((finding) => !["gene", "phenotype"].includes(finding.dimension));
  const sentences = [];

  if (requiredGenes.length && requiredPhenotypes.length) {
    sentences.push(`Requires ${naturalList(requiredGenes)}-positive ${naturalList(requiredPhenotypes)}.`);
  } else {
    if (requiredGenes.length) sentences.push(`Requires a qualifying ${naturalList(requiredGenes)} genetic variant.`);
    if (requiredPhenotypes.length) sentences.push(`Requires ${naturalList(requiredPhenotypes)}.`);
  }

  if (remainingRequired.length) {
    sentences.push(`Requires ${naturalList(remainingRequired.map(targetingFindingLabel))}.`);
  }

  const cohorts = byCategory("cohort").map(targetingFindingLabel);
  if (cohorts.length) sentences.push(`Includes a dedicated ${naturalList(cohorts)} cohort.`);

  const focuses = byCategory("focus").map(targetingFindingLabel).filter((label) => !requiredPhenotypes.includes(label));
  if (focuses.length) sentences.push(`Focuses on ${naturalList(focuses)}.`);

  const allowed = byCategory("allowed").map(targetingFindingLabel);
  if (allowed.length) sentences.push(`${naturalList(allowed)} ${allowed.length === 1 ? "is" : "are"} allowed but not required.`);

  const excluded = byCategory("excluded");
  const requiredLabels = new Set(required.map(targetingFindingLabel));
  const narrowedRequired = excluded.filter((finding) => requiredLabels.has(targetingFindingLabel(finding))).map(targetingFindingLabel);
  const remainingExcluded = excluded.filter((finding) => !requiredLabels.has(targetingFindingLabel(finding)));
  const fullyExcluded = remainingExcluded.filter((finding) => !isConditionalExclusionFinding(finding)).map(targetingFindingLabel);
  const conditionallyExcluded = remainingExcluded.filter(isConditionalExclusionFinding).map(targetingFindingLabel);
  if (narrowedRequired.length) sentences.push(`Some ${naturalList(narrowedRequired)} variants or circumstances are excluded.`);
  if (fullyExcluded.length) sentences.push(`Excludes ${naturalList(fullyExcluded)}.`);
  if (conditionallyExcluded.length) sentences.push(`Conditionally excludes some participants with ${naturalList(conditionallyExcluded)}.`);

  return sentences.join(" ") || "No specific population targeting was identified.";
}

function buildTargetingClusters(trials, dimension) {
  const clusters = new Map();
  for (const trial of trials) {
    for (const finding of trial.targeting.findings || []) {
      if (finding.dimension !== dimension) continue;
      const category = targetingFindingCategory(finding);
      if (category === "context") continue;
      const identity = canonicalTargetingCluster(dimension, finding.value);
      if (!clusters.has(identity.key)) clusters.set(identity.key, { ...identity, dimension, trials: new Map() });
      const cluster = clusters.get(identity.key);
      if (!cluster.trials.has(trial.nctId)) cluster.trials.set(trial.nctId, { trial, categories: new Set(), findings: [] });
      const entry = cluster.trials.get(trial.nctId);
      entry.categories.add(category);
      entry.findings.push(finding);
    }
  }

  return [...clusters.values()]
    .map((cluster) => {
      const entries = [...cluster.trials.values()];
      const counts = { whole: 0, cohort: 0, focus: 0, allowed: 0, excluded: 0 };
      for (const entry of entries) for (const category of entry.categories) counts[category]++;
      const targetedTrialCount = entries.filter((entry) => [...entry.categories].some((category) => ["whole", "cohort", "focus"].includes(category))).length;
      return { ...cluster, entries, counts, targetedTrialCount };
    })
    .sort((left, right) => right.targetedTrialCount - left.targetedTrialCount || right.entries.length - left.entries.length || left.label.localeCompare(right.label));
}

function clusterEntryDisposition(entry) {
  const hasTarget = [...entry.categories].some((category) => ["whole", "cohort", "focus"].includes(category));
  const hasExclusion = entry.categories.has("excluded");
  if (hasTarget && hasExclusion) return { key: "mixed", label: "Targeted with exceptions" };
  if (entry.categories.has("whole")) return { key: "required", label: "Required" };
  if (entry.categories.has("cohort")) return { key: "cohort", label: "Cohort" };
  if (entry.categories.has("focus")) return { key: "focus", label: "Study focus" };
  if (entry.categories.has("allowed")) return { key: "allowed", label: "Allowed" };
  const conditional = entry.findings.some(isConditionalExclusionFinding);
  return conditional ? { key: "conditional", label: "Conditional exclusion" } : { key: "excluded", label: "Excluded" };
}

function clusterSpecificInterpretation(entry, cluster) {
  const disposition = clusterEntryDisposition(entry);
  const label = cluster.label;
  if (disposition.key === "mixed") {
    return cluster.dimension === "gene"
      ? `Requires or targets ${label} overall, with specific variants or circumstances excluded.`
      : `Targets ${label}, with narrower criteria excluding some participants.`;
  }
  if (disposition.key === "required") {
    if (cluster.dimension === "gene") return `Requires a qualifying ${label} variant.`;
    if (cluster.dimension === "onset") return `Requires ${label} ALS.`;
    return `Requires ${label}.`;
  }
  if (disposition.key === "cohort") return `Includes a dedicated ${label} cohort; it is not required across the entire trial.`;
  if (disposition.key === "focus") return `Studies ${label}; it is not stated as an enrollment requirement.`;
  if (disposition.key === "allowed") return `${label} is allowed but not required.`;
  if (disposition.key === "conditional") return `${label} is excluded only for some participants or under specific conditions.`;
  return `Excludes participants in the ${label} subgroup.`;
}

function renderClusterTrial(entry, cluster) {
  const disposition = clusterEntryDisposition(entry);
  return `
    <button class="cluster-trial-row" type="button" data-open-targeting-trial="${escapeHtml(entry.trial.nctId)}">
      <span class="cluster-trial-id">${escapeHtml(entry.trial.nctId)}</span>
      <span class="cluster-trial-title">${escapeHtml(entry.trial.title)}</span>
      <span class="cluster-trial-summary">${escapeHtml(clusterSpecificInterpretation(entry, cluster))}</span>
      <span class="cluster-trial-tags"><span class="cluster-tag ${disposition.key}">${escapeHtml(disposition.label)}</span></span>
    </button>`;
}

function renderClusterTrialList(entries, cluster) {
  const visible = entries.length <= 6 ? entries : entries.slice(0, 5);
  const hidden = entries.filter((entry) => !visible.includes(entry));
  return `
    <div class="cluster-trial-list">${visible.map((entry) => renderClusterTrial(entry, cluster)).join("")}</div>
    ${
      hidden.length
        ? `<details class="cluster-more"><summary>Show ${hidden.length} more trial${hidden.length === 1 ? "" : "s"}</summary><div class="cluster-trial-list">${hidden.map((entry) => renderClusterTrial(entry, cluster)).join("")}</div></details>`
        : ""
    }`;
}

function renderClusterRuleGroup(label, entries, cluster, options = {}) {
  if (!entries.length) return "";
  const content = renderClusterTrialList(entries, cluster);
  if (options.collapsed) {
    return `
      <details class="cluster-rule-group ${options.tone || ""}">
        <summary><strong>${escapeHtml(label)}</strong><span>${entries.length} trial${entries.length === 1 ? "" : "s"}</span></summary>
        <div class="cluster-rule-group-content">${content}</div>
      </details>`;
  }
  return `
    <section class="cluster-rule-group ${options.tone || ""}">
      <div class="cluster-rule-group-heading"><strong>${escapeHtml(label)}</strong><span>${entries.length}</span></div>
      ${content}
    </section>`;
}

function renderTargetingCluster(cluster) {
  const entries = [...cluster.entries].sort((left, right) => {
    const order = ["required", "mixed", "cohort", "focus", "allowed", "conditional", "excluded"];
    return order.indexOf(clusterEntryDisposition(left).key) - order.indexOf(clusterEntryDisposition(right).key) || left.trial.nctId.localeCompare(right.trial.nctId);
  });
  const dispositionCounts = entries.reduce((counts, entry) => {
    const key = clusterEntryDisposition(entry).key;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const targetCount = (dispositionCounts.required || 0) + (dispositionCounts.cohort || 0) + (dispositionCounts.focus || 0);
  const summaryParts = [
    targetCount ? `${targetCount} target or include` : "",
    dispositionCounts.mixed ? `${dispositionCounts.mixed} with exceptions` : "",
    dispositionCounts.allowed ? `${dispositionCounts.allowed} allowed` : "",
    dispositionCounts.conditional ? `${dispositionCounts.conditional} conditional exclusion` : "",
    dispositionCounts.excluded ? `${dispositionCounts.excluded} excluded` : "",
  ].filter(Boolean);
  const targetedEntries = entries.filter((entry) => ["required", "mixed", "cohort", "focus"].includes(clusterEntryDisposition(entry).key));
  const allowedEntries = entries.filter((entry) => clusterEntryDisposition(entry).key === "allowed");
  const excludedEntries = entries.filter((entry) => ["conditional", "excluded"].includes(clusterEntryDisposition(entry).key));

  return `
    <article class="targeting-cluster-card">
      <div class="cluster-heading">
        <div>
          <h4>${escapeHtml(cluster.label)}</h4>
          <p>${escapeHtml(summaryParts.join(" · "))}</p>
        </div>
      </div>
      ${renderClusterRuleGroup("Required or targeted", targetedEntries, cluster, { tone: "targeted" })}
      ${renderClusterRuleGroup("Allowed, not required", allowedEntries, cluster, { tone: "allowed" })}
      ${renderClusterRuleGroup("Exclusions", excludedEntries, cluster, { tone: "excluded", collapsed: excludedEntries.length > 3 })}
    </article>`;
}

function renderTargetingClusterSection(title, description, clusters, options = {}) {
  const visibleClusters = clusters.slice(0, options.initialLimit || clusters.length);
  const hiddenClusters = clusters.slice(visibleClusters.length);
  return `
    <section class="content-card targeting-cluster-section">
      <div class="cluster-section-header">
        <div>
          <p class="eyebrow">${escapeHtml(title)}</p>
          <h3>${escapeHtml(description)}</h3>
        </div>
        <span class="results-count">${clusters.length} cluster${clusters.length === 1 ? "" : "s"}</span>
      </div>
      <div class="targeting-cluster-grid">${visibleClusters.map((cluster) => renderTargetingCluster(cluster)).join("")}</div>
      ${
        hiddenClusters.length
          ? `<details class="cluster-section-more"><summary>Show ${hiddenClusters.length} smaller clusters</summary><div class="targeting-cluster-grid">${hiddenClusters.map((cluster) => renderTargetingCluster(cluster)).join("")}</div></details>`
          : ""
      }
    </section>`;
}

function renderTargetingResults(payload) {
  const hasStudyType = payload.trials.some((trial) => Boolean(trial.studyType));
  if (payload.trials.length && !hasStudyType) {
    targetingResultsCount.textContent = "Restart required";
    targetingSummary.textContent = "The running server is using an older targeting response. Restart the navigator to load the interventional breakdown.";
    targetingResults.innerHTML = `
      <article class="content-card targeting-data-warning">
        <strong>Targeting data needs a server restart</strong>
        <p>The saved trial analyses are intact. The running API needs to reload so it can include each trial's study type.</p>
      </article>`;
    return;
  }
  const trials = payload.trials.filter((trial) => trial.studyType === "Interventional");
  const positiveCategories = new Set(["whole", "cohort", "focus"]);
  const hasPositiveTarget = (trial, dimension = "") => (trial.targeting.findings || []).some(
    (finding) => (!dimension || finding.dimension === dimension) && positiveCategories.has(targetingFindingCategory(finding))
  );
  const targetedTrials = trials.filter((trial) => hasPositiveTarget(trial));
  const geneTrials = trials.filter((trial) => hasPositiveTarget(trial, "gene"));
  const phenotypeTrials = trials.filter((trial) => hasPositiveTarget(trial, "phenotype"));
  const onsetOrProgressionTrials = trials.filter((trial) => hasPositiveTarget(trial, "onset") || hasPositiveTarget(trial, "progression"));
  const geneClusters = buildTargetingClusters(trials, "gene");
  const phenotypeClusters = buildTargetingClusters(trials, "phenotype");
  // Demo visibility only: retain phenotype cards through these two groups.
  const phenotypeCutoff = Math.max(...phenotypeClusters.map((cluster, index) =>
    ['bulbar involvement', 'bilateral upper limb paresis'].includes(cluster.label.toLowerCase()) ? index : -1));
  const visiblePhenotypeClusters = phenotypeCutoff >= 0 ? phenotypeClusters.slice(0, phenotypeCutoff + 1) : phenotypeClusters;

  const onsetClusters = buildTargetingClusters(trials, "onset");
  const progressionClusters = buildTargetingClusters(trials, "progression");

  targetingResultsCount.textContent = `${trials.length} interventional trials`;
  targetingSummary.textContent = `${targetedTrials.length} of ${trials.length} interventional trials target a specific population.`;
  targetingResults.innerHTML = `
    <section class="content-card targeting-population-overview" aria-label="Target population breakdown">
      <h3>Target population breakdown</h3>
      <div id="targeting-population-bars" class="dashboard-breakdown"></div>
      <p class="subtle">Trials can appear in more than one group. Exclusions are not counted.</p>
    </section>
    ${renderTargetingClusterSection("Genes", "Gene-defined ALS populations", geneClusters)}
    ${renderTargetingClusterSection("Phenotypes", "Clinical phenotype populations", visiblePhenotypeClusters)}
    <div class="targeting-cluster-columns">
      ${renderTargetingClusterSection("Onset", "Anatomical onset populations", onsetClusters)}
      ${renderTargetingClusterSection("Progression", "Progression-defined eligibility", progressionClusters)}
    </div>`;

  renderDashboardBreakdown(document.getElementById('targeting-population-bars'), [
    {label:'Gene-defined', count:geneTrials.length},
    {label:'Phenotype-defined', count:phenotypeTrials.length},
    {label:'Onset or progression', count:onsetOrProgressionTrials.length},
  ].map(item => ({...item, percent:Math.round(item.count / (targetedTrials.length || 1) * 100)})), targetedTrials.length, 'trials');

  targetingResults.querySelectorAll("[data-open-targeting-trial]").forEach((button) => {
    button.addEventListener("click", () => openTrialDetail(button.dataset.openTargetingTrial));
  });
}

async function loadTargetingResults() {
  try {
    renderTargetingResults(await fetchJson("/api/targeting/results"));
  } catch (error) {
    targetingResultsCount.textContent = "Unavailable";
    targetingSummary.textContent = error.message;
    targetingResults.innerHTML = `<article class="content-card"><p class="error-text">${escapeHtml(error.message)}</p></article>`;
  }
}

let portalSearchResult = null;
let portalFilterMode = false;
function renderTrials(result) {
  portalSearchResult = result;
  resultsTitle.textContent = result.trials.length ? "Matched ALS trials" : "No trials matched";
  resultsCount.textContent = `Showing ${result.trials.length} of ${result.totalMatches} matches`;
  copilotSummary.textContent = result.summary;
  if (!result.trials.length) {
    trialResults.innerHTML = '<p class="subtle">No trials matched. Try broadening your search.</p>';
    return;
  }
  const rows = result.trials.map(trial => portalFilterMode
    ? `<tr><td><button data-open-trial="${escapeHtml(trial.nctId)}">${escapeHtml(trial.title)}</button><small>${escapeHtml(trial.nctId)}</small></td><td><span class="status-badge ${statusClassName(trial.status)}">${escapeHtml(trial.status)}</span></td><td>${escapeHtml(trial.phase)}</td><td>${escapeHtml(trial.locationSummary)}</td></tr>`
    : `<button class="compact-result" data-open-trial="${escapeHtml(trial.nctId)}"><div><p>${escapeHtml(trial.nctId)} · ${escapeHtml(trial.phase)} · ${escapeHtml(trial.studyType)}</p><h3>${escapeHtml(trial.title)}</h3><p>${escapeHtml(trial.locationSummary)}</p></div><span class="status-badge ${statusClassName(trial.status)}">${escapeHtml(trial.status)}</span></button>`).join("");
  trialResults.innerHTML = portalFilterMode ? `<div class="portal-table-scroll"><table class="portal-table"><thead><tr><th>Trial</th><th>Status</th><th>Phase</th><th>Locations</th></tr></thead><tbody>${rows}</tbody></table></div>` : rows;
  trialResults.querySelectorAll("[data-open-trial]").forEach(button => button.addEventListener("click", () => openTrialDetail(button.dataset.openTrial)));
}

function renderTrialCards(targetNode, trials) {
  if (!trials.length) {
    targetNode.innerHTML = `<article class="trial-card"><p>No trials matched in the current ClinicalTrials.gov ALS dataset.</p></article>`;
    return;
  }

  targetNode.innerHTML = trials
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
          ${renderClassificationBanner(trial.inconsistencyAnalysis)}
          ${renderTargetingBanner(trial.targeting)}
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

  targetNode.querySelectorAll("[data-open-trial]").forEach((card) => {
    card.addEventListener("click", () => {
      openTrialDetail(card.dataset.openTrial);
    });
  });
}

function renderNyuTrials(payload) {
  newYorkDatabasePayload = payload;
  const entries = payload.entries || [];
  nyuResultsTitle.textContent = entries.length ? "New York ALS trial database" : "No New York studies found";
  nyuResultsCount.textContent = `${payload.totalMatches} result${payload.totalMatches === 1 ? "" : "s"}`;
  nyuSummary.textContent = payload.summary;
  renderTrialCards(nyuResults, entries);
}

function appendNewYorkChatMessage(role, html) {
  const bubble = document.createElement("article");
  bubble.className = `chat-bubble ${role === "user" ? "user-bubble" : "assistant-bubble"}`;
  bubble.innerHTML = html;
  newYorkChatLog.appendChild(bubble);
  newYorkChatLog.scrollTop = newYorkChatLog.scrollHeight;
  return bubble;
}

function resetNewYorkChat() {
  newYorkConversationId = "";
  sessionStorage.removeItem(NEW_YORK_CONVERSATION_STORAGE_KEY);
  newYorkChatError.hidden = true;
  newYorkChatLog.innerHTML = `
    <article class="chat-bubble assistant-bubble">
      <p>Ask about New York ALS trials, expanded access, sponsors, sites, or specific NCT IDs.</p>
    </article>
  `;
}

function buildCitationHtml(citedNctIds) {
  return Array.isArray(citedNctIds) && citedNctIds.length
    ? `<div class="chat-citations"><p class="subtle">Referenced trials</p><div class="trial-meta">${citedNctIds.map((id) => `<a class="meta-pill inline-nct-link" href="${buildCtgovTrialUrl(String(id).toUpperCase())}" target="_blank" rel="noreferrer">${escapeHtml(String(id).toUpperCase())}</a>`).join("")}</div></div>`
    : "";
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
          <div class="manual-review-actions">
            <button class="secondary-button compact-button" type="button" data-manual-verify="${trial.nctId}">Mark verified</button>
          </div>
        </article>
      `
    )
    .join("");

  mediumRiskResults.querySelectorAll("[data-open-trial]").forEach((card) => {
    card.addEventListener("click", () => {
      openTrialDetail(card.dataset.openTrial);
    });
  });
  attachManualReviewHandlers(mediumRiskResults);
}

function renderScreenedTrials(payload) {
  const summary = payload.summary || { totalProcessed: 0, flaggedCount: 0, lowRiskCount: 0 };
  screenedSummary.innerHTML = `
    <span class="meta-pill">Processed ${summary.totalProcessed}</span>
    <span class="meta-pill">Flagged ${summary.flaggedCount}</span>
    <span class="meta-pill">Not flagged ${summary.lowRiskCount}</span>
    <span class="meta-pill">Manually verified ${summary.manuallyVerifiedCount || 0}</span>
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

async function setManualVerification(nctId, verified) {
  await fetchJson("/api/agent/manual-review", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      nctId,
      verified,
    }),
  });

  await loadMediumRiskTrials();
  await loadScreenedTrials();
  if (!trialDetailModal.hidden && trialDetailKicker.textContent === nctId) {
    await openTrialDetail(nctId);
  }
}

function attachManualReviewHandlers(rootNode) {
  rootNode.querySelectorAll("[data-manual-verify]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const nctId = button.dataset.manualVerify;
      const verified = button.dataset.manualVerified === "true" ? false : true;
      button.disabled = true;
      button.textContent = verified ? "Marking..." : "Undoing...";

      try {
        await setManualVerification(nctId, verified);
      } catch (error) {
        agentError.hidden = false;
        agentError.textContent = error.message;
        button.disabled = false;
        button.textContent = verified ? "Mark verified" : "Undo verified";
      }
    });
  });
}

function verificationBadgeClass(category) {
  if (category === "Physician Review" || category === "Needs Physician Review") {
    return "verification-badge physician-review";
  }

  if (category === "Needs Registry Update") {
    return "verification-badge registry-update";
  }

  return "verification-badge verified";
}

function verificationDisplayLabel(category) {
  return category === "Physician Review" ? "Needs Physician Review" : category;
}

function renderVerificationCard(record, categoryLabel) {
  const reasons = categoryLabel === "Physician Review"
    ? record.physicianReviewReasons || record.integrityConcernSignals || []
    : record.updateNeededReasons || record.missingOrWeakFields || [];
  const rationale = cleanVerificationRationale(record.rationale);

  return `
    <article class="listing-card verification-card trial-card-clickable" data-open-trial="${record.nctId}">
      <div class="listing-card-header">
        <div>
          <p class="eyebrow">${record.nctId}</p>
          <h3>${escapeHtml(record.title)}</h3>
        </div>
        <div class="listing-card-score">
          <span class="${verificationBadgeClass(categoryLabel)}">${verificationDisplayLabel(categoryLabel)}</span>
          <div class="score">Confidence ${record.confidenceScore}</div>
        </div>
      </div>
      <p class="subtle">${escapeHtml(record.sponsor)} · ${escapeHtml(record.status)}</p>
      <p class="verification-rationale">${escapeHtml(rationale)}</p>
      ${
        reasons.length
          ? `<ul class="verification-reasons">${reasons.slice(0, 3).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>`
          : ""
      }
    </article>
  `;
}

function cleanVerificationRationale(value) {
  return String(value || "No rationale available.")
    .replace(/^Primary issue is physician review,\s*not mere registry incompleteness\.\s*/i, "")
    .replace(/^Primary issue:\s*physician review,\s*not merely registry incompleteness\.\s*/i, "");
}

function findVerificationRecord(nctId) {
  const normalized = String(nctId || "").toUpperCase();
  return (verificationDemoPayload?.reports || []).find((record) => String(record.nctId || "").toUpperCase() === normalized) || null;
}

function attachVerificationCardHandlers(targetNode) {
  targetNode.querySelectorAll("[data-open-trial]").forEach((card) => {
    card.addEventListener("click", () => {
      openTrialDetail(card.dataset.openTrial);
    });
  });
}

function renderVerificationDemo(payload) {
  verificationDemoPayload = payload;
  const buckets = payload.buckets || {};
  const physicianReview = buckets.physicianReview || [];
  const registryUpdate = buckets.registryUpdate || [];
  const verified = buckets.verified || [];

  physicianReviewResults.innerHTML = physicianReview.length
    ? physicianReview.map((record) => renderVerificationCard(record, "Physician Review")).join("")
    : `<article class="listing-card"><p>No physician-review cases in this sample.</p></article>`;

  const orderedRegistryUpdate = [
    ...registryUpdate.filter((record) => record.nctId !== "NCT06351592"),
    ...registryUpdate.filter((record) => record.nctId === "NCT06351592"),
  ];

  registryUpdateResults.innerHTML = registryUpdate.length
    ? orderedRegistryUpdate.map((record) => renderVerificationCard(record, "Needs Registry Update")).join("")
    : `<article class="listing-card"><p>No registry-update cases in this sample.</p></article>`;

  verifiedResultsCount.textContent = `${verified.length} example${verified.length === 1 ? "" : "s"}`;
  verifiedResults.innerHTML = verified.length
    ? verified
        .slice(0, 8)
        .map(
          (record) => `
            <button class="screened-row" type="button" data-open-trial="${record.nctId}">
              <div class="screened-row-main">
                <strong>${record.nctId}</strong>
                <span>${escapeHtml(record.title)}</span>
              </div>
              <div class="screened-row-meta">
                <span class="${verificationBadgeClass("Verified")}">Verified</span>
                <span class="meta-pill">Confidence ${record.confidenceScore}</span>
              </div>
            </button>
          `
        )
        .join("")
    : `<article class="listing-card"><p>No verified examples in this sample.</p></article>`;

  attachVerificationCardHandlers(physicianReviewResults);
  attachVerificationCardHandlers(registryUpdateResults);
  attachVerificationCardHandlers(verifiedResults);
}

function inconsistencyBadgeClass(report) {
  if (report.studyTypeMatch === false) {
    return "verification-badge physician-review";
  }
  if (report.interventionalSubtype === "Drug") {
    return "verification-badge verified";
  }
  if (report.interventionalSubtype === "Other") {
    return "verification-badge registry-update";
  }
  return "verification-badge verified";
}

function inconsistencyBadgeLabel(report) {
  if (report.studyTypeMatch === false) {
    return `${report.registeredStudyType || "Registered"} → ${report.inferredStudyType || "Inferred"}`;
  }
  if (report.interventionalSubtype === "Other") {
    return report.otherSubtype ? `Other · ${report.otherSubtype}` : "Other";
  }
  if (report.interventionalSubtype === "Drug") {
    return "Drug";
  }
  return report.interventionalSubtype || "Reviewed";
}

function renderLandscapeMeta(report) {
  const values = [
    report.landscapeSubcategory || report.landscapeCategory,
    report.therapeuticPurpose,
    report.therapyModality && report.therapyModality !== "Not applicable" ? report.therapyModality : "",
    report.geneTarget && !["Not applicable", "Sporadic/non-genetic"].includes(report.geneTarget) ? `Gene ${report.geneTarget}` : "",
    report.deviceCategory && report.deviceCategory !== "Not applicable" ? report.deviceCategory : "",
    report.devicePurpose && report.devicePurpose !== "Not applicable" ? report.devicePurpose : "",
  ].filter(Boolean);

  return values.map((value) => `<span class="meta-pill">${escapeHtml(value)}</span>`).join("");
}

function renderInconsistencyCard(report) {
  const reasons = report.reasons || [];
  return `
    <article class="listing-card verification-card trial-card-clickable" data-open-trial="${report.nctId}">
      <div class="listing-card-header">
        <div>
          <p class="eyebrow">${report.nctId}</p>
          <h3>${escapeHtml(report.title)}</h3>
        </div>
        <div class="listing-card-score">
          <span class="${inconsistencyBadgeClass(report)}">${escapeHtml(inconsistencyBadgeLabel(report))}</span>
          <div class="score">Confidence ${report.confidenceScore}</div>
        </div>
      </div>
      <p class="subtle">${escapeHtml(report.sponsor || "")} · ${escapeHtml(report.registeredStudyType || "")} · ${escapeHtml(report.interventionalSubtype || "")}</p>
      <div class="trial-meta">${renderLandscapeMeta(report)}</div>
      <p class="verification-rationale">${escapeHtml(report.studyTypeIssue || report.rationale || "")}</p>
      ${
        reasons.length
          ? `<ul class="verification-reasons">${reasons.slice(0, 3).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>`
          : ""
      }
    </article>
  `;
}

function renderInconsistencyResults(payload) {
  const summary = payload.summary || {};
  const mismatches = payload.mismatches || [];
  const drugTrials = payload.drugTrials || [];
  const otherTrials = payload.otherTrials || [];

  inconsistencySummary.textContent = summary.totalProcessed
    ? `Reviewed ${summary.totalProcessed} trials. ${summary.mismatchCount} study-type mismatch${summary.mismatchCount === 1 ? "" : "es"}, ${summary.drugCount} drug, ${summary.otherCount} other.`
    : "No consistency reviews stored yet.";

  inconsistencyMismatchResults.innerHTML = mismatches.length
    ? mismatches.map(renderInconsistencyCard).join("")
    : `<article class="listing-card"><p>No stored study-type mismatches yet.</p></article>`;

  inconsistencyDrugResults.innerHTML = drugTrials.length
    ? drugTrials.map(renderInconsistencyCard).join("")
    : `<article class="listing-card"><p>No stored drug-subtype trials yet.</p></article>`;

  inconsistencyOtherCount.textContent = `${otherTrials.length} trial${otherTrials.length === 1 ? "" : "s"}`;
  inconsistencyOtherResults.innerHTML = otherTrials.length
    ? otherTrials.map(renderInconsistencyCard).join("")
    : `<article class="listing-card"><p>No stored other-subtype trials yet.</p></article>`;

  attachVerificationCardHandlers(inconsistencyMismatchResults);
  attachVerificationCardHandlers(inconsistencyDrugResults);
  attachVerificationCardHandlers(inconsistencyOtherResults);
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
  const filter = dashboardFilterQuery();
  const overview = await fetchJson(`/api/overview${filter}`);
  if (filter === dashboardFilterQuery()) renderOverview(overview);
}

async function loadClassificationReport() {
  const filter = dashboardFilterQuery();
  const payload = await fetchJson(`/api/inconsistency/classification-report${filter}`);
  if (filter === dashboardFilterQuery()) renderClassificationReport(payload);
}

async function loadMediumRiskTrials() {
  const payload = await fetchJson("/api/agent/medium-risk");
  renderMediumRiskTrials(payload);
  window.dispatchEvent(new Event("portal-reviews-refresh"));
}

async function loadScreenedTrials() {
  const payload = await fetchJson("/api/agent/screened");
  renderScreenedTrials(payload);
}

async function loadVerificationDemo() {
  const payload = await fetchJson("/reports/verification-sample-20260626-171246/verification-demo-buckets.json");
  renderVerificationDemo(payload);
}

async function loadInconsistencyResults() {
  const payload = await fetchJson("/api/inconsistency/results");
  renderInconsistencyResults(payload);
}

function buildInconsistencyRequestOptions(options = {}) {
  const limit = Number.parseInt(inconsistencyLimitInput.value, 10) || 20;
  const days = Number.parseInt(inconsistencyDaysInput.value, 10);
  const nctId = inconsistencyNctIdInput.value.trim();
  const query = inconsistencyQueryInput.value.trim();
  const statuses = [...inconsistencyStatusInputs].filter((input) => input.checked).map((input) => input.value);
  const skipProcessed = skipInconsistencyProcessedInput.checked;
  const continuation = options.continuation || null;

  return {
    limit,
    days: Number.isFinite(days) ? days : 365,
    nctId,
    query,
    statuses,
    skipProcessed,
    cursor: continuation ? continuation.nextCursor : 0,
    sequenceId: continuation ? continuation.sequenceId : "",
    runNumber: continuation ? continuation.nextRunNumber : 1,
  };
}

function renderInconsistencyPreview(payload) {
  const summary = payload.summary || {};
  const trials = payload.trials || [];
  const total = summary.totalCandidates || 0;
  const batchSize = summary.batchSize || 0;
  const batchCount = summary.batchCount || 0;

  inconsistencyPreviewCount.textContent = `${total} trial${total === 1 ? "" : "s"}`;
  inconsistencyPreviewSummary.textContent = total
    ? `This run will process ${total} selected trial${total === 1 ? "" : "s"} in ${batchCount} batch${batchCount === 1 ? "" : "es"} of up to ${batchSize}. Showing all selected trials in run order.`
    : "No trials match the current consistency-agent criteria.";

  inconsistencyPreviewResults.innerHTML = trials.length
    ? trials
        .map(
          (trial) => `
            <button class="screened-row" type="button" data-open-trial="${trial.nctId}">
              <div class="screened-row-main">
                <strong>${escapeHtml(trial.nctId)}</strong>
                <span>${escapeHtml(trial.title)}</span>
              </div>
              <div class="screened-row-meta">
                <span class="meta-pill">${escapeHtml(trial.status)}</span>
                <span class="meta-pill">${escapeHtml(trial.studyType)}</span>
                <span class="subtle">Updated ${formatDate(trial.updatedAt)}</span>
              </div>
            </button>
          `
        )
        .join("")
    : `<article class="listing-card"><p>No trials match the current consistency-agent criteria.</p></article>`;

  inconsistencyPreviewResults.querySelectorAll("[data-open-trial]").forEach((row) => {
    row.addEventListener("click", () => {
      openTrialDetail(row.dataset.openTrial);
    });
  });
}

async function loadInconsistencyPreview() {
  try {
    const payload = await fetchJson("/api/inconsistency/preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildInconsistencyRequestOptions()),
    });
    renderInconsistencyPreview(payload);
    return payload;
  } catch (error) {
    inconsistencyPreviewCount.textContent = "Preview failed";
    inconsistencyPreviewSummary.textContent = error.message;
    inconsistencyPreviewResults.innerHTML = `<article class="listing-card"><p class="error-text">${escapeHtml(error.message)}</p></article>`;
    return null;
  }
}

async function loadNyuTrials() {
  const payload = await fetchJson("/api/new-york/database");
  renderNyuTrials(payload);
}

async function runNewYorkChat() {
  const question = newYorkQuestionInput.value.trim();
  if (!question) {
    newYorkChatError.hidden = false;
    newYorkChatError.textContent = "Enter a question for the New York trial database.";
    return;
  }

  newYorkChatError.hidden = true;
  runNewYorkChatButton.disabled = true;
  runNewYorkChatButton.textContent = "Thinking...";
  appendNewYorkChatMessage("user", `<p>${escapeHtml(question)}</p>`);

  try {
    const payload = await fetchJson("/api/new-york/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question,
        conversation_id: newYorkConversationId || null,
      }),
    });
    newYorkConversationId = String(payload.conversation_id || "");
    if (newYorkConversationId) {
      sessionStorage.setItem(NEW_YORK_CONVERSATION_STORAGE_KEY, newYorkConversationId);
    }
    appendNewYorkChatMessage("assistant", `${formatChatAnswer(payload.text)}${buildCitationHtml(payload.citedNctIds)}`);
    newYorkQuestionInput.value = "";
  } catch (error) {
    newYorkChatError.hidden = false;
    newYorkChatError.textContent = error.message;
  } finally {
    runNewYorkChatButton.disabled = false;
    runNewYorkChatButton.textContent = "Ask chatbot";
  }
}

let savaHistory = [];
try { savaHistory=JSON.parse(sessionStorage.getItem('sava-search-conversation')||'[]');if(!Array.isArray(savaHistory))savaHistory=[]; } catch {}
function persistSavaConversation(){try{sessionStorage.setItem('sava-search-conversation',JSON.stringify(savaHistory));}catch{}}
let savaPending = null;
queryInput.addEventListener("input", () => ChatUI.autosize(queryInput));
function updateSearchSendButton(busy=false) {
  if (portalFilterMode) { runQueryButton.textContent = busy ? "Searching…" : "Search"; runQueryButton.classList.remove("chat-send"); runQueryButton.setAttribute("aria-label", "Search trials"); }
  else ChatUI.button(runQueryButton,busy);
}
let savaRequestController = null;
function renderSavaConversation() {
  const container = document.getElementById("sava-conversation");
  container.hidden = portalFilterMode;
  container.innerHTML = savaHistory.map(turn => `<article class="sava-turn"><p class="sava-question">${escapeHtml(turn.question)}</p><div class="sava-answer"><strong>SAVA</strong><p>${escapeHtml(turn.answer)}</p>${(turn.citedNctIds||[]).length?`<details class="sava-sources"><summary>Referenced trials (${turn.citedNctIds.length})</summary><div class="sava-source-list">${turn.citedNctIds.map(id=>{const source=(turn.references||[]).find(t=>t.nctId===id);return `<button class="sava-source-link" data-sava-trial="${escapeHtml(id)}"><span>${escapeHtml(source?.title||id)} ↗</span><small>${escapeHtml(source?.sponsor||"")}${source?.sponsor?" · ":""}${escapeHtml(id)}</small></button>`;}).join("")}</div></details>`:""}</div></article>`).join("");
  container.querySelectorAll("[data-sava-trial]").forEach(button => button.addEventListener("click", () => openTrialDetail(button.dataset.savaTrial)));
  document.getElementById("sava-reset").hidden = portalFilterMode || !savaHistory.length;
  if (savaPending) {
    container.insertAdjacentHTML("beforeend", `<article class="sava-turn sava-pending"><p class="sava-question">${escapeHtml(savaPending.question)}</p><div class="sava-answer"><strong>SAVA</strong><p id="sava-stream-text">${escapeHtml(savaPending.text || savaPending.status)}</p></div></article>`);
  }
  container.scrollTop=container.scrollHeight;
  if (!savaHistory.length && !savaPending) container.innerHTML = '<div class="sava-welcome"><span class="chat-welcome-mark" aria-hidden="true">✦</span><h3>What would you like to explore?</h3><p>Ask about trials, eligibility, or research near you.</p></div>';
}
let portalQuerySequence = 0;
async function runQuery(options = {}) {
  if (options.browseOnly && savaPending) return;
  const sequence = ++portalQuerySequence;
  savaRequestController?.abort();
  savaRequestController = new AbortController();
  const query = queryInput.value.trim();
  queryError.hidden = true;
  if (!portalFilterMode && (!query || options.browseOnly)) {
    runQueryButton.disabled = false;
    updateSearchSendButton();
    document.getElementById("copilot-panel").setAttribute("aria-busy", "false");
    return;
  }
  runQueryButton.disabled = true;
  const aiSearch = !portalFilterMode && Boolean(query) && !options.browseOnly;
  updateSearchSendButton(true);
  if (aiSearch) { savaPending={question:query,text:"",status:"Searching trial records…"};queryInput.value="";ChatUI.autosize(queryInput);runQueryButton.disabled=false;renderSavaConversation(); }
  document.getElementById("copilot-panel").setAttribute("aria-busy", "true");

  try {
    const params = new URLSearchParams({ q: query });
    for (const [key, id] of Object.entries(portalFilterFields)) {
      const value = document.getElementById(id).value.trim();
      if (portalFilterMode && value) params.set(key, value);
    }
    const result = aiSearch
      ? await ChatUI.stream("/api/sava/search/stream", {question:query,history:savaHistory.slice(-16)}, {
          signal:savaRequestController.signal,
          onText:text=>{if(sequence!==portalQuerySequence || !savaPending)return;savaPending.text=text;const node=document.getElementById("sava-stream-text");if(node){const log=node.closest(".sava-conversation");const nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<100;node.textContent=text || savaPending.status;if(nearBottom)log.scrollTop=log.scrollHeight;}},
          onStatus:message=>{if(sequence!==portalQuerySequence || !savaPending)return;savaPending.status=message;const node=document.getElementById("sava-stream-text");if(node && !savaPending.text)node.textContent=message;}
        })
      : await fetchJson(`/api/trials?${params}`, { signal:savaRequestController.signal });
    if (sequence !== portalQuerySequence) return;
    if (!aiSearch) renderTrials(result);
    if (aiSearch) {
      savaPending=null;
      savaHistory.push({question:query,answer:result.summary,search:result.search,citedNctIds:result.citedNctIds || [],limitations:result.limitations || [],references:result.references||result.citedTrials||[]});
      savaHistory = savaHistory.slice(-30);persistSavaConversation();
      renderSavaConversation();
      queryInput.placeholder = "Ask a follow-up…";

    }
  } catch (error) {
    if (sequence !== portalQuerySequence) return;
    savaPending=null;renderSavaConversation();
    if (aiSearch && !queryInput.value) { queryInput.value=query;ChatUI.autosize(queryInput); }
    queryError.hidden = false;
    queryError.textContent = error.name === "AbortError" ? "Response stopped. You can edit your message and try again." : error.message;
    copilotSummary.textContent = "Search failed.";
    trialResults.innerHTML = "";
  } finally {
    if (sequence === portalQuerySequence) {
      runQueryButton.disabled = false;
      updateSearchSendButton();
      document.getElementById("copilot-panel").setAttribute("aria-busy", "false");
    }
  }
}

async function syncTrials() {
  syncButton.disabled = true;
  syncButton.textContent = "Syncing...";

  try {
    await fetchJson("/api/sync", { method: "POST" });
    await loadOverview();
    await loadClassificationReport();
    await runQuery({browseOnly:true});
    await loadMediumRiskTrials();
    await loadScreenedTrials();
    await loadVerificationDemo();
    await loadInconsistencyResults();
    await loadInconsistencyPreview();
    await loadNyuTrials();
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
    await loadClassificationReport();
    await loadMediumRiskTrials();
    await loadScreenedTrials();
    await loadVerificationDemo();
    await loadInconsistencyResults();
    await loadInconsistencyPreview();
    await loadNyuTrials();
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

async function runInconsistencyAgent(options = {}) {
  inconsistencyError.hidden = true;
  runInconsistencyButton.disabled = true;
  continueInconsistencyButton.disabled = true;
  runInconsistencyButton.textContent = "Preparing...";
  continueInconsistencyButton.textContent = "Running...";

  try {
    const preview = await loadInconsistencyPreview();
    const totalCandidates = preview?.summary?.totalCandidates || 0;
    const estimatedBatches = preview?.summary?.batchCount || 0;

    if (!totalCandidates) {
      inconsistencySummary.textContent = "No trials match the current consistency-agent criteria.";
      return;
    }

    let currentContinuation = options.continuation || null;
    let processedCount = 0;
    let batchNumber = currentContinuation ? currentContinuation.nextRunNumber : 1;

    while (true) {
      const displayBatch = Math.max(1, batchNumber);
      runInconsistencyButton.textContent = `Running batch ${displayBatch}${estimatedBatches ? ` of ${estimatedBatches}` : ""}...`;
      inconsistencySummary.textContent = `Processing batch ${displayBatch}${estimatedBatches ? ` of ${estimatedBatches}` : ""}. ${processedCount} of ${totalCandidates} trials completed.`;

      const payload = await fetchJson("/api/inconsistency/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildInconsistencyRequestOptions({ continuation: currentContinuation })),
      });

      const batchReviewed = Array.isArray(payload.reports) ? payload.reports.length : 0;
      processedCount += batchReviewed;
      inconsistencyContinuation = payload.continuation || null;
      renderInconsistencyResults(payload.results || payload);
      inconsistencySummary.textContent = `Completed batch ${displayBatch}. ${Math.min(processedCount, totalCandidates)} of ${totalCandidates} trials processed.`;

      if (!payload.continuation?.hasMore || !batchReviewed) {
        break;
      }

      currentContinuation = payload.continuation;
      batchNumber = payload.continuation.nextRunNumber;
    }

    await loadClassificationReport();
    await loadInconsistencyPreview();
    await runQuery({browseOnly:true});
  } catch (error) {
    inconsistencyError.hidden = false;
    inconsistencyError.textContent = error.message;
  } finally {
    runInconsistencyButton.disabled = false;
    runInconsistencyButton.textContent = "Run agent";
    continueInconsistencyButton.textContent = "Continue run";
    if (inconsistencyContinuation && inconsistencyContinuation.hasMore) {
      continueInconsistencyButton.disabled = false;
    }
  }
}

function closeTrialDetail() {
  trialDetailModal.hidden = true;
  trialDetailBody.innerHTML = "";
}

function renderPortalNotes(trial) {
  const groups=[{label:'Trial',notes:trial.portalNotes},...(trial.locations||[]).map(site=>({label:[site.facility,site.participationType==='remote'?'Remote':site.city].filter(Boolean).join(' · '),notes:site.portalNotes}))];
  const content=groups.filter(group=>group.notes?.length).map(group=>`<article><h4>${escapeHtml(group.label)}</h4>${group.notes.map(note=>`<p>${escapeHtml(note.text)}</p><p class="subtle">${escapeHtml(note.author)} · ${escapeHtml(formatDate(note.createdAt))}</p>`).join('')}</article>`).join('');
  return content?`<section class="modal-section"><h3>Clinician notes</h3>${content}</section>`:'';
}

function renderTrialDetail(payload) {
  const trial = payload.trial;
  const latestRun = (payload.agentHistory || [])[0] || trial.agentAnalysis || null;
  const manuallyVerified = trial.manualReview?.status === "verified";
  const verificationRecord = findVerificationRecord(trial.nctId);
  const verificationReasons = verificationRecord?.reviewCategory === "Physician Review"
    ? verificationRecord.physicianReviewReasons || verificationRecord.integrityConcernSignals || []
    : verificationRecord?.updateNeededReasons || verificationRecord?.missingOrWeakFields || [];

  trialDetailKicker.textContent = trial.nctId;
  trialDetailTitle.textContent = trial.title;
  window.renderTrialBookmark?.(trial.nctId);
  trialDetailBody.innerHTML = `
    ${renderPortalNotes(trial)}
    <div class="modal-section">
      <p class="eyebrow">Quick links</p>
      <p><a href="${trial.url}" target="_blank" rel="noreferrer">Open this trial on ClinicalTrials.gov</a></p>
      ${
        latestRun
          ? `
            <div class="manual-review-panel">
              <div>
                <strong>${manuallyVerified ? "Manually verified" : "Manual review"}</strong>
                <p class="subtle">${
                  manuallyVerified
                    ? `Marked verified ${formatDate(trial.manualReview.verifiedAt)}. This trial is excluded from flagged exports.`
                    : "Mark this as verified to remove it from flagged lists and flagged exports."
                }</p>
              </div>
              <button class="secondary-button compact-button" type="button" data-manual-verify="${trial.nctId}" data-manual-verified="${manuallyVerified ? "true" : "false"}">
                ${manuallyVerified ? "Undo verified" : "Mark verified"}
              </button>
            </div>
          `
          : ""
      }
    </div>
    <div class="modal-section">
      <p class="eyebrow">${verificationRecord ? "Verification assessment" : "AI assessment"}</p>
      ${
        verificationRecord
          ? `
            <div class="modal-assessment-card">
              <div class="modal-assessment-header">
                <div class="trial-meta">
                  <span class="${verificationBadgeClass(verificationRecord.reviewCategory)}">${verificationDisplayLabel(verificationRecord.reviewCategory)}</span>
                  <span class="meta-pill">Confidence ${verificationRecord.confidenceScore}</span>
                  <span class="meta-pill">${verificationRecord.verificationStatus}</span>
                  ${
                    verificationRecord.flagForPhysicianReview
                      ? `<span class="meta-pill">Physician review</span>`
                      : verificationRecord.flagForRegistryUpdate
                        ? `<span class="meta-pill">Registry update</span>`
                        : ""
                  }
                </div>
              </div>
              <div class="modal-copy-block">
                <p class="modal-label">Rationale</p>
                <p>${escapeHtml(cleanVerificationRationale(verificationRecord.rationale))}</p>
              </div>
              <div class="modal-copy-block">
                <p class="modal-label">${verificationRecord.reviewCategory === "Physician Review" ? "Review reasons" : "Update reasons"}</p>
                <ul class="rationale-list">
                  ${verificationReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("") || "<li>No reasons returned.</li>"}
                </ul>
              </div>
              ${
                verificationRecord.integrityConcernSignals?.length
                  ? `
                    <div class="modal-copy-block">
                      <p class="modal-label">Integrity signals</p>
                      <ul class="rationale-list">
                        ${verificationRecord.integrityConcernSignals.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
                      </ul>
                    </div>
                  `
                  : ""
              }
            </div>
          `
          : latestRun
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
    ${
      trial.inconsistencyAnalysis
        ? `
    <div class="modal-section">
      <p class="eyebrow">Consistency assessment</p>
      <div class="modal-assessment-card">
        <div class="modal-assessment-header">
          <div class="trial-meta">
            <span class="${inconsistencyBadgeClass(trial.inconsistencyAnalysis)}">${escapeHtml(inconsistencyBadgeLabel(trial.inconsistencyAnalysis))}</span>
            <span class="meta-pill">${trial.inconsistencyAnalysis.studyTypeMatch === false ? "Mismatch" : "Study type matches"}</span>
            <span class="meta-pill">${escapeHtml(trial.inconsistencyAnalysis.interventionalSubtype || "")}</span>
            ${
              trial.inconsistencyAnalysis.otherSubtype
                ? `<span class="meta-pill">${escapeHtml(trial.inconsistencyAnalysis.otherSubtype)}</span>`
                : ""
            }
            <span class="meta-pill">Confidence ${trial.inconsistencyAnalysis.confidenceScore}</span>
          </div>
        </div>
        <div class="modal-copy-block">
          <p class="modal-label">Landscape classification</p>
          <div class="trial-meta">
            ${renderLandscapeMeta(trial.inconsistencyAnalysis) || "<span class=\"meta-pill\">Not classified</span>"}
          </div>
        </div>
        ${
          trial.inconsistencyAnalysis.mechanismOrDesign || trial.inconsistencyAnalysis.landscapeRationale
            ? `
        <div class="modal-copy-block">
          <p class="modal-label">Landscape rationale</p>
          <p>${escapeHtml([trial.inconsistencyAnalysis.mechanismOrDesign, trial.inconsistencyAnalysis.landscapeRationale].filter(Boolean).join(" · "))}</p>
        </div>
            `
            : ""
        }
        <div class="modal-copy-block">
          <p class="modal-label">Rationale</p>
          <p>${escapeHtml(trial.inconsistencyAnalysis.rationale || "")}</p>
        </div>
        <div class="modal-copy-block">
          <p class="modal-label">Reasons</p>
          <ul class="rationale-list">
            ${(trial.inconsistencyAnalysis.reasons || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("") || "<li>No reasons returned.</li>"}
          </ul>
        </div>
      </div>
    </div>
        `
        : ""
    }
    ${
      trial.targeting?.status === "screened"
        ? `
    <div class="modal-section">
      <p class="eyebrow">Phenotype &amp; gene targeting</p>
      <div class="modal-assessment-card targeting-modal-card">
        <div class="targeting-plain-summary">
          <span>Plain-language interpretation</span>
          <strong>${escapeHtml(plainLanguageTargetingSummary(trial))}</strong>
        </div>
        ${renderTargetingFindings(trial.targeting)}
        <p class="subtle">Analyzed ${formatDate(trial.targeting.analyzedAt)} · ${escapeHtml(trial.targeting.model || "Unknown model")}</p>
      </div>
    </div>`
        : ""
    }
    <div class="modal-section">
      <p class="eyebrow">Trial overview</p>
      <div class="trial-meta">
        <span class="meta-pill">${trial.status}</span>
        <span class="meta-pill">${trial.phase}</span>
        <span class="meta-pill">${trial.studyType}</span>
        ${
          trial.interventionTypes?.length
            ? `<span class="meta-pill">${escapeHtml(trial.interventionTypes.join(", "))}</span>`
            : ""
        }
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
  attachManualReviewHandlers(trialDetailBody);
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
    await loadTargetingResults();
    await loadClassificationReport();
    await runQuery({browseOnly:true});
    await loadMediumRiskTrials();
    await loadScreenedTrials();
    await loadVerificationDemo();
    await loadInconsistencyResults();
    await loadInconsistencyPreview();
    await loadNyuTrials();
    updateAgentModeHint();
  } catch (error) {
    queryError.hidden = false;
    queryError.textContent = error.message;
    copilotSummary.textContent = "Unable to load ClinicalTrials.gov data. The local backend is probably not running.";
  }
}

const portalFilterFields = { status: "search-status", studyType: "search-type", phase: "search-phase", city: "search-city" };
function portalNavigate(panel) { document.querySelector(`[data-panel-target="${panel}"]`).click(); }
document.querySelector(".portal-brand").addEventListener("click", event => { event.preventDefault(); portalNavigate("dashboard-panel"); });
document.getElementById("explore-targeting").addEventListener("click", () => portalNavigate("targeting-panel"));
function setPortalMode(filters) {
  if (portalFilterMode !== filters) {
    ++portalQuerySequence; savaRequestController?.abort(); savaPending=null;
    queryInput.value = ""; queryError.hidden = true; runQueryButton.disabled = false;
    document.getElementById("copilot-panel").setAttribute("aria-busy", "false");
  }
  portalFilterMode = filters;
  document.getElementById("copilot-panel").dataset.searchMode = filters ? "filters" : "ask";
  document.getElementById("search-results-card").hidden = !filters;
  document.getElementById("save-view").hidden = !filters;
  document.getElementById("save-view-form").hidden = true;
  updateSearchSendButton();
  queryInput.placeholder = filters ? "Recruiting ALS trials, gene therapy, NCT ID…" : savaHistory.length ? "Ask a follow-up question…" : "Which recruiting trials target SOD1?";
  document.getElementById("sava-reset").hidden = filters;
  renderSavaConversation();
  document.getElementById("portal-filters").hidden = !filters;
  for (const [id, active] of [["ask-mode", !filters], ["filters-mode", filters]]) {
    document.getElementById(id).classList.toggle("is-active", active);
    document.getElementById(id).setAttribute("aria-pressed", String(active));
  }
  if (filters && portalSearchResult) renderTrials(portalSearchResult);
}
document.getElementById("ask-mode").addEventListener("click", () => { setPortalMode(false); runQuery({browseOnly:true}); });
document.getElementById("filters-mode").addEventListener("click", () => { setPortalMode(true); runQuery({browseOnly:true}); });
document.getElementById("sava-reset").addEventListener("click", () => {
  savaHistory = [];persistSavaConversation(); savaPending=null; queryInput.value = "";
  queryInput.placeholder = "Which recruiting trials target SOD1?";
  renderSavaConversation(); runQuery({browseOnly:true});
});
Object.values(portalFilterFields).forEach(id => document.getElementById(id).addEventListener("change", runQuery));
document.getElementById("clear-filters").addEventListener("click", () => {
  Object.values(portalFilterFields).forEach(id => { document.getElementById(id).value = ""; });
  queryInput.value = ""; runQuery();
});
let savedPortalViews = [];
try { const stored = JSON.parse(localStorage.getItem("sava-saved-views") || "[]"); if (Array.isArray(stored)) savedPortalViews = stored.filter(view => view && typeof view.name === "string" && typeof view.query === "string" && view.filters); } catch {}
function renderSavedPortalViews() {
  const list = document.getElementById("saved-view-list");
  list.innerHTML = savedPortalViews.length ? savedPortalViews.map((view, index) => `<div class="saved-view-row"><button data-view="${index}">${escapeHtml(view.name)}</button><button data-delete-view="${index}" aria-label="Delete ${escapeHtml(view.name)}">×</button></div>`).join("") : "";
  list.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
    const view = savedPortalViews[Number(button.dataset.view)];
    setPortalMode(view.mode !== "ask");
    if (view.mode === "ask") { savaHistory = Array.isArray(view.history) ? view.history : []; renderSavaConversation(); }
    queryInput.value = view.query;
    Object.entries(portalFilterFields).forEach(([key,id]) => { document.getElementById(id).value = view.filters[key] || ""; });
    portalNavigate("copilot-panel"); runQuery();
  }));
  list.querySelectorAll("[data-delete-view]").forEach(button => button.addEventListener("click", () => {
    const next = savedPortalViews.filter((_,index) => index !== Number(button.dataset.deleteView));
    try { localStorage.setItem("sava-saved-views", JSON.stringify(next)); savedPortalViews = next; renderSavedPortalViews(); } catch { alert("Saved views could not be updated in this browser."); }
  }));
}
document.getElementById("save-view").addEventListener("click", () => { document.getElementById("save-view-form").hidden = false; document.getElementById("save-view-message").textContent = "Saved views are stored in this browser."; document.getElementById("view-name").focus(); });
document.getElementById("cancel-save-view").addEventListener("click", () => { document.getElementById("save-view-form").hidden = true; });
document.getElementById("save-view-form").addEventListener("submit", event => {
  event.preventDefault(); const name = document.getElementById("view-name").value.trim(); if (!name) return;
  const view = { name, mode: portalFilterMode ? "filters" : "ask", history: portalFilterMode ? [] : queryInput.value.trim() ? savaHistory : savaHistory.slice(0,-1), query: queryInput.value.trim() || (!portalFilterMode ? savaHistory.at(-1)?.question || "" : ""), filters: Object.fromEntries(Object.entries(portalFilterFields).map(([key,id]) => [key, document.getElementById(id).value])) };
  const next = [...savedPortalViews, view];
  try { localStorage.setItem("sava-saved-views", JSON.stringify(next)); savedPortalViews = next; renderSavedPortalViews(); document.getElementById("save-view-form").hidden = true; } catch { document.getElementById("save-view-message").textContent = "Your browser could not save this view."; }
});
renderSavedPortalViews();
renderSavaConversation();
initialize();

window.addEventListener("portal-trial-updated", async event => {
  const nctId=event.detail.nctId;
  const refreshes=[loadOverview(),loadNyuTrials()];
  if(portalFilterMode)refreshes.push(runQuery());else portalSearchResult=null;
  if(!trialDetailModal.hidden && trialDetailKicker.textContent===nctId)refreshes.push(openTrialDetail(nctId));
  await Promise.allSettled(refreshes);
});

async function checkAssistantVersion(){
 try {const health=await fetchJson('/api/health');let notice=document.getElementById('assistant-version-notice');
  if(health.assistantVersion==='conversation-v3'){notice?.remove();return;}
  if(!notice){notice=document.createElement('p');notice.id='assistant-version-notice';notice.className='portal-update-notice';notice.setAttribute('role','status');document.querySelector('main').prepend(notice);}
  notice.textContent='The app server is running an older version. Restart the app to use the updated assistants.';
 }catch{}
}
checkAssistantVersion();window.addEventListener('focus',checkAssistantVersion);

async function renderGroupedLandscape(){
 const target=document.getElementById('landscape-bars');
 try{
 const data=await fetchJson('/reports/intervention-landscape/parent-groups.json');
 const selections=[];
 const select=(label,ids)=>{const index=selections.length;selections.push({label,ids});return `data-intervention-selection="${index}"`;};
 const colors=['var(--navy)','var(--coral)','var(--tan)','var(--slate)','var(--ok)','var(--muted)'];
 target.innerHTML=['treatment','other'].map(key=>{
 const group=data.groups[key],total=group.total;
 // Demo-only visibility; original classifications and totals remain in parent-groups.json.
 const hiddenCategories=new Set(['Traditional Chinese medicine oral preparation']);
 const visibleParents=group.parents.filter(p=>p.label!=='Undisclosed modality').map(p=>{
  const subcategories=p.subcategories.filter(c=>!hiddenCategories.has(c.label));
  return {...p,subcategories,trialIds:[...new Set(subcategories.flatMap(c=>c.trialIds))]};
 }).filter(p=>p.trialIds.length);
 const row=(label,count,color,child=false)=>`<span class="parent-row ${child?'parent-child':''}"><span>${escapeHtml(label)}</span><span class="parent-track"><i style="width:${count/total*100}%;background:${color}"></i></span><b>${count}</b></span>`;
 const groupButton=(p,i)=>`<button type="button" class="intervention-select" ${select(p.label,p.trialIds)}>${row(p.label,p.trialIds.length,colors[i])}</button>`;
 return `<section class="landscape-column"><header><h4>${key==='treatment'?'ALS treatments':'Other interventions'}</h4></header><div class="parent-stacked" aria-label="Intervention groups">${visibleParents.map((p,i)=>`<button type="button" ${select(p.label,p.trialIds)} style="flex:${p.trialIds.length};background:${colors[i]}" aria-label="${escapeHtml(p.label)}: ${p.trialIds.length} trials" title="${escapeHtml(p.label)}: ${p.trialIds.length}"></button>`).join('')}</div>${visibleParents.map((p,i)=>p.subcategories.length>1?`<div class="parent-detail intervention-expandable"><div class="intervention-parent-heading"><button type="button" class="intervention-collapse" aria-expanded="true" aria-label="Collapse ${escapeHtml(p.label)}">⌄</button>${groupButton(p,i)}</div><div class="intervention-children">${p.subcategories.map(c=>`<button type="button" class="intervention-select intervention-subcategory" ${select(c.label,c.trialIds)}>${row(c.label,c.trialIds.length,colors[i],true)}</button>`).join('')}</div></div>`:`<div class="parent-detail parent-single">${groupButton(p,i)}</div>`).join('')}</section>`;
 }).join('');
 const allIds=[...new Set(selections.flatMap(s=>s.ids))];
 target.querySelectorAll('[data-intervention-selection]').forEach(button=>{button.onclick=()=>{const item=selections[Number(button.dataset.interventionSelection)];window.openInterventionDrawer(item.label,item.ids,allIds,dashboardActiveOnly.checked);};});
 target.querySelectorAll('.intervention-collapse').forEach(button=>{button.onclick=()=>{const expanded=button.getAttribute('aria-expanded')==='true';button.setAttribute('aria-expanded',String(!expanded));button.setAttribute('aria-label',button.getAttribute('aria-label').replace(expanded?'Collapse':'Expand',expanded?'Expand':'Collapse'));button.textContent=expanded?'›':'⌄';button.closest('.parent-detail').querySelector('.intervention-children').hidden=expanded;};});
 }catch(e){target.textContent='Grouped screening results are unavailable.';}
}
renderGroupedLandscape();

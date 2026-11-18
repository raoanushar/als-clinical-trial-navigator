const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");
const cachePath = path.join(rootDir, "data", "trials-cache.json");

function loadEnvFile() {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadEnvFile();

  const { buildAgentRun } = require("../server");
  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const sequenceId = process.argv[2] || "agent-sequence-20260902-expanded-new-only";

  const result = await buildAgentRun(cache, {
    limit: 25,
    days: 0,
    query: "",
    skipProcessed: true,
    statuses: [
      "Recruiting",
      "Not Yet Recruiting",
      "Enrolling By Invitation",
      "Active Not Recruiting",
      "Available",
      "Approved For Marketing",
    ],
    sequenceId,
    runNumber: 1,
  });

  console.log(JSON.stringify({
    summary: result.summary,
    reportFile: result.reportFile,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

"use strict";

// CI-friendly serializers for the analyzer report (JSON + PR-comment Markdown).

const pkg = require("../package.json");

function escapePipes(s) {
  return String(s).replace(/\|/g, "\\|");
}

function toJson(report) {
  let gasFindings = 0, securityFindings = 0, highSeverity = 0;
  const files = report.map((f) => {
    const findings = [];
    for (const { rule, hits } of f.sec) {
      securityFindings += hits.length;
      if (rule.severity === "HIGH") highSeverity += hits.length;
      findings.push({
        id: rule.id, type: "security", severity: rule.severity, name: rule.name,
        detail: rule.detail, fix: rule.fix, count: hits.length, lines: hits.map((h) => h.line),
      });
    }
    for (const { rule, hits } of f.gas) {
      gasFindings += hits.length;
      findings.push({
        id: rule.id, type: "gas", severity: "INFO", name: rule.name,
        saving: rule.saving, fix: rule.fix, count: hits.length, lines: hits.map((h) => h.line),
      });
    }
    return { file: f.file, findings };
  });
  return {
    tool: "hardhat-gg-optimizer",
    version: pkg.version,
    generatedAt: new Date().toISOString(),
    summary: {
      filesWithFindings: report.length,
      gasFindings,
      securityFindings,
      highSeverity,
    },
    files,
  };
}

function toMarkdown(report) {
  const j = toJson(report);
  const s = j.summary;
  const lines = [];
  lines.push("## 🔍 gg-optimizer report");
  lines.push("");
  lines.push(
    `**${s.gasFindings} gas** · **${s.securityFindings} security** (${s.highSeverity} high) across ${s.filesWithFindings} file(s)`
  );
  if (j.files.length === 0) {
    lines.push("");
    lines.push("✅ No findings — no low-hanging gas bloat or common vulnerabilities detected.");
    return lines.join("\n") + "\n";
  }
  for (const f of j.files) {
    lines.push("");
    lines.push(`### \`${f.file}\``);
    lines.push("");
    lines.push("| Rule | Severity | Finding | Lines | Fix |");
    lines.push("|---|---|---|---|---|");
    for (const x of f.findings) {
      const sev = x.type === "security" ? x.severity : "GAS";
      lines.push(
        `| ${x.id} | ${sev} | ${escapePipes(x.name)} (x${x.count}) | ${x.lines.slice(0, 8).join(", ")} | ${escapePipes(x.fix)} |`
      );
    }
  }
  lines.push("");
  lines.push(`<sub>hardhat-gg-optimizer v${j.version} · ${j.generatedAt}</sub>`);
  return lines.join("\n") + "\n";
}

// "gg-optimizer clean" README badge (shields.io static badge, no server needed).
function toBadge(report) {
  const s = toJson(report).summary;
  let message, color;
  if (s.highSeverity > 0) {
    message = s.highSeverity + " high severity";
    color = "red";
  } else if (s.gasFindings + s.securityFindings > 0) {
    message = (s.gasFindings + s.securityFindings) + " findings";
    color = "yellow";
  } else {
    message = "clean";
    color = "brightgreen";
  }
  const esc = (t) => String(t).replace(/-/g, "--").replace(/_/g, "__").replace(/ /g, "_");
  const url = `https://img.shields.io/badge/${esc("gg-optimizer")}-${esc(message)}-${color}`;
  const link = "https://www.npmjs.com/package/hardhat-gg-optimizer";
  return { message, color, url, markdown: `[![gg-optimizer](${url})](${link})` };
}

module.exports = { toJson, toMarkdown, toBadge };

"use strict";

const fs = require("fs");
const { stripCommentsAndStrings } = require("./strip");
const { runGasRules } = require("./gasRules");
const { runSecurityRules } = require("./securityRules");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", yellow: "\x1b[33m", green: "\x1b[32m",
  red: "\x1b[31m", magenta: "\x1b[35m", gray: "\x1b[90m",
};

function sevColor(sev) {
  return sev === "HIGH" ? C.red : sev === "MEDIUM" ? C.yellow : C.gray;
}

// Analyze one Solidity file's raw source. Returns { gas, sec, gasCount, secCount }.
function analyzeSource(rawSource) {
  const clean = stripCommentsAndStrings(rawSource);
  const gas = runGasRules(clean, rawSource);
  const sec = runSecurityRules(clean, rawSource);
  const gasCount = gas.reduce((a, r) => a + r.hits.length, 0);
  const secCount = sec.reduce((a, r) => a + r.hits.length, 0);
  return { gas, sec, gasCount, secCount };
}

// Analyze a list of contract source file paths.
function analyzeFiles(files) {
  const report = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    const res = analyzeSource(raw);
    if (res.gasCount > 0 || res.secCount > 0) report.push({ file, ...res });
  }
  return report;
}

function printReport(report, { color = true } = {}) {
  const c = color ? C : new Proxy({}, { get: () => "" });
  const out = [];
  out.push("");
  out.push(`${c.bold}${c.cyan}=====================================================${c.reset}`);
  out.push(`${c.bold}${c.cyan}       GG-CHAIN OPTIMIZER  ·  gas + security          ${c.reset}`);
  out.push(`${c.bold}${c.cyan}=====================================================${c.reset}`);

  let totalGas = 0, totalHigh = 0, totalSec = 0;

  if (report.length === 0) {
    out.push(`${c.green}✔ No low-hanging gas bloat or common vulnerabilities found.${c.reset}`);
    out.push("");
    return { text: out.join("\n"), totalGas, totalSec, totalHigh };
  }

  for (const f of report) {
    out.push("");
    out.push(`${c.bold}▸ ${f.file}${c.reset}`);

    if (f.sec.length) {
      for (const { rule, hits } of f.sec) {
        totalSec += hits.length;
        if (rule.severity === "HIGH") totalHigh += hits.length;
        const sc = color ? sevColor(rule.severity) : "";
        out.push(`  ${sc}● [${rule.severity}] ${rule.id} ${rule.name}${c.reset} ${c.dim}(x${hits.length})${c.reset}`);
        out.push(`      ${c.gray}${rule.detail}${c.reset}`);
        out.push(`      ${c.gray}lines: ${hits.map((h) => h.line).slice(0, 8).join(", ")}${c.reset}`);
        out.push(`      ${c.green}fix:${c.reset} ${rule.fix}`);
      }
    }

    if (f.gas.length) {
      for (const { rule, hits } of f.gas) {
        totalGas += hits.length;
        out.push(`  ${c.yellow}◆ ${rule.id} ${rule.name}${c.reset} ${c.dim}(x${hits.length})${c.reset}`);
        out.push(`      ${c.green}save:${c.reset} ${rule.saving}  ${c.gray}lines: ${hits.map((h) => h.line).slice(0, 8).join(", ")}${c.reset}`);
        out.push(`      ${c.green}fix:${c.reset} ${rule.fix}`);
      }
    }
  }

  out.push("");
  out.push(`${c.bold}-----------------------------------------------------${c.reset}`);
  out.push(
    `${c.bold}Summary:${c.reset} ` +
    `${c.yellow}${totalGas} gas optimizations${c.reset} · ` +
    `${c.red}${totalHigh} high-severity${c.reset} · ` +
    `${totalSec} security findings`
  );
  out.push(`${c.dim}Run ${c.reset}${c.bold}npx hardhat gg-fix${c.reset}${c.dim} to auto-apply safe gas fixes.${c.reset}`);
  out.push("");
  return { text: out.join("\n"), totalGas, totalSec, totalHigh };
}

module.exports = { analyzeSource, analyzeFiles, printReport };

"use strict";

// Hardhat plugin entry. Hooks the compile pipeline and adds a `gg-scan` task.
// Written in plain JS so it runs without a build step.

const path = require("path");
const { task, subtask } = require("hardhat/config");
const {
  TASK_COMPILE_SOLIDITY_EMIT_ARTIFACTS,
} = require("hardhat/builtin-tasks/task-names");
const { analyzeFiles, printReport } = require("./analyzer");
const { fixFile } = require("./fix");
const { planPremiumAction } = require("./quota");

// Gather the project's own .sol sources (skip dependencies).
function collectSources(hre) {
  const sourcesPath = hre.config.paths.sources;
  const glob = [];
  const walk = (dir) => {
    const fs = require("fs");
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".sol")) glob.push(full);
    }
  };
  walk(sourcesPath);
  return glob.filter(
    (p) => !p.includes("node_modules") && !p.includes("@openzeppelin")
  );
}

function runScan(hre, { silent = false } = {}) {
  const files = collectSources(hre);
  const report = analyzeFiles(files);
  const { text, totalHigh } = printReport(report, { color: true });
  if (!silent) console.log(text);
  return { report, totalHigh };
}

// Auto-run after every successful compile (the "free hook").
subtask(TASK_COMPILE_SOLIDITY_EMIT_ARTIFACTS).setAction(
  async (args, hre, runSuper) => {
    const result = await runSuper(args);
    try {
      if (hre.config.ggOptimizer && hre.config.ggOptimizer.autoScan === false) {
        return result;
      }
      runScan(hre);
    } catch (e) {
      console.warn("[gg-optimizer] scan skipped:", e.message);
    }
    return result;
  }
);

// Manual task: npx hardhat gg-scan
task("gg-scan", "Scan contracts for gas savings and common vulnerabilities")
  .setAction(async (_args, hre) => {
    await hre.run("compile");
  });

// Premium task: npx hardhat gg-fix [--yes] [--dry-run]
// Applies only SAFE gas fixes. Charging (after the free allowance) is fully
// transparent: it prints the wallet + cost and refuses to charge without --yes.
task("gg-fix", "Auto-apply safe gas fixes (premium after free allowance)")
  .addFlag("yes", "Confirm any GG charge non-interactively")
  .addFlag("dryRun", "Preview changes without writing files or charging")
  .setAction(async (args, hre) => {
    const files = collectSources(hre);

    // Preview what would change first.
    let totalPreview = 0;
    const perFile = [];
    for (const file of files) {
      const res = require("./fix").applySafeFixes(require("fs").readFileSync(file, "utf8"));
      if (res.changed) { perFile.push({ file, res }); totalPreview += res.count; }
    }

    if (totalPreview === 0) {
      console.log("\n\x1b[32m✔ Nothing to auto-fix. Your gas is already tight.\x1b[0m\n");
      return;
    }

    console.log(`\n\x1b[1mgg-fix will apply ${totalPreview} safe change(s):\x1b[0m`);
    for (const { file, res } of perFile) {
      console.log(`  ${file}: ` + Object.entries(res.byRule).map(([k, v]) => `${k} x${v}`).join(", "));
    }

    if (args.dryRun) {
      console.log("\n\x1b[2m(dry run — no files written, no charge)\x1b[0m\n");
      return;
    }

    // Transparent quota / consent.
    const plan = planPremiumAction();
    console.log(`\n\x1b[36m${plan.message}\x1b[0m`);
    if (plan.chargeNeeded) {
      console.log(`  wallet: \x1b[1m${plan.wallet.address}\x1b[0m  network: ${plan.network}`);
      if (!plan.enough) {
        console.log(
          `\n\x1b[33mNot enough GG. Top up this wallet, then re-run.\x1b[0m` +
          `\n\x1b[2m(testnet/mock: add credits with GG_OPTIMIZER_TOPUP; mainnet coming soon)\x1b[0m\n`
        );
        return;
      }
      if (!args.yes && process.env.GG_OPTIMIZER_YES !== "1") {
        console.log(
          `\n\x1b[33mThis will spend ${plan.cost} GG.\x1b[0m Re-run with \x1b[1m--yes\x1b[0m to confirm.` +
          `\n\x1b[2mNo GG has been spent.\x1b[0m\n`
        );
        return;
      }
    }

    // Commit charge (if any), then write fixes.
    plan.commit();
    let applied = 0;
    for (const { file } of perFile) {
      const res = fixFile(file);
      applied += res.count;
    }
    console.log(`\n\x1b[32m✔ Applied ${applied} safe fix(es). Review the diff with git.\x1b[0m`);
    if (plan.chargeNeeded) console.log(`\x1b[2mCharged ${plan.cost} GG (${plan.network}).\x1b[0m`);
    console.log("");
  });

module.exports = {};

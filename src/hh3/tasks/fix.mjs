import fs from "node:fs";
import { collectSources, fixer, quota } from "../util.mjs";

export default async function ggFix(args, hre) {
  const files = collectSources(hre);

  let totalPreview = 0;
  const perFile = [];
  for (const file of files) {
    const res = fixer.applySafeFixes(fs.readFileSync(file, "utf8"));
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

  const network = process.env.GG_OPTIMIZER_NETWORK || "mock";
  const plan =
    network === "ggchain"
      ? await quota.planPremiumActionOnchain(process.env.GGCHAIN_RPC || quota.DEFAULT_RPC)
      : quota.planPremiumAction();
  console.log(`\n\x1b[36m${plan.message}\x1b[0m`);
  if (plan.chargeNeeded) {
    console.log(`  wallet: \x1b[1m${plan.wallet.address}\x1b[0m  network: ${plan.network}`);
    if (!plan.enough) {
      console.log(
        `\n\x1b[33mNot enough GG. Top up this wallet, then re-run.\x1b[0m` +
        `\n\x1b[2m(mock mode: local credits; ggchain mode: send GG to the wallet above)\x1b[0m\n`
      );
      return;
    }
    if (!args.yes && process.env.GG_OPTIMIZER_YES !== "1") {
      console.log(
        `\n\x1b[33mThis will spend ${plan.cost} GG${network === "ggchain" ? " (real, on-chain burn)" : ""}.\x1b[0m Re-run with \x1b[1m--yes\x1b[0m to confirm.` +
        `\n\x1b[2mNo GG has been spent.\x1b[0m\n`
      );
      return;
    }
  }

  const receipt = await plan.commit();
  let applied = 0;
  for (const { file } of perFile) {
    const res = fixer.fixFile(file);
    applied += res.count;
  }
  console.log(`\n\x1b[32m✔ Applied ${applied} safe fix(es). Review the diff with git.\x1b[0m`);
  if (plan.chargeNeeded) {
    console.log(`\x1b[2mCharged ${plan.cost} GG (${plan.network}).\x1b[0m`);
    if (receipt) console.log(`\x1b[2mburn tx: ${receipt}\x1b[0m`);
  }
  console.log("");
}

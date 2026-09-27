import { runScan } from "../util.mjs";

// Auto-scan after every successful build (opt out with GG_OPTIMIZER_AUTOSCAN=0).
export default async function build(args, hre, runSuper) {
  const result = await runSuper(args);
  try {
    if (process.env.GG_OPTIMIZER_AUTOSCAN !== "0") runScan(hre);
  } catch (e) {
    console.warn("[gg-optimizer] scan skipped:", e.message);
  }
  return result;
}

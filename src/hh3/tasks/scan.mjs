import fs from "node:fs";
import { collectSources, analyzer, report as rpt, runScan } from "../util.mjs";

export default async function scan(args, hre) {
  const ci = args.json || args.markdown || args.badge || !!args.output;
  if (!ci) {
    const { totalHigh } = runScan(hre);
    if (args.failOnHigh && totalHigh > 0) {
      process.exitCode = 1;
      console.error(`[gg-optimizer] ${totalHigh} high-severity finding(s) — failing (--fail-on-high)`);
    }
    return;
  }
  const files = collectSources(hre);
  const report = analyzer.analyzeFiles(files);
  const json = rpt.toJson(report);
  const out = args.badge
    ? rpt.toBadge(report).markdown + "\n"
    : args.markdown ? rpt.toMarkdown(report) : JSON.stringify(json, null, 2) + "\n";
  if (args.output) {
    fs.writeFileSync(args.output, out);
    console.log(`[gg-optimizer] report written to ${args.output}`);
  } else {
    process.stdout.write(out);
  }
  if (args.failOnHigh && json.summary.highSeverity > 0) {
    process.exitCode = 1;
    console.error(`[gg-optimizer] ${json.summary.highSeverity} high-severity finding(s) — failing (--fail-on-high)`);
  }
}

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const analyzer = require("../analyzer");
export const quota = require("../quota");
export const report = require("../report");
export const fixer = require("../fix");

// HH3: hre.config.paths.sources.solidity is an array of absolute dirs/files.
export function collectSources(hre) {
  const src = hre.config.paths.sources;
  let roots = [];
  if (Array.isArray(src)) roots = src;
  else if (src && Array.isArray(src.solidity)) roots = src.solidity;
  else if (typeof src === "string") roots = [src];
  else roots = [path.join(hre.config.paths.root, "contracts")];

  const files = [];
  const walk = (p) => {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isFile()) {
      if (p.endsWith(".sol")) files.push(p);
      return;
    }
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".sol")) files.push(full);
    }
  };
  for (const r of roots) walk(r);
  return files.filter((p) => !p.includes("node_modules") && !p.includes("@openzeppelin"));
}

export function runScan(hre, { silent = false } = {}) {
  const files = collectSources(hre);
  const rep = analyzer.analyzeFiles(files);
  const { text, totalHigh } = analyzer.printReport(rep, { color: true });
  if (!silent) console.log(text);
  return { report: rep, totalHigh };
}

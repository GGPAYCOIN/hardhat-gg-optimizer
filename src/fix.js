"use strict";

// Safe auto-fixer. Only applies transformations that cannot change contract
// behavior. Currently:
//   GG-GAS-03  for-loop `i++`  ->  `++i`
//   GG-GAS-05  redundant `= 0` initialization removed
//
// Every change is line-accurate and the number of edits is reported so the
// developer can review the diff in git.

const fs = require("fs");
const { stripCommentsAndStrings } = require("./analyzer/strip");

// Apply only within code (not comments/strings): we compute edit spans on the
// stripped source, then apply the same spans to the raw source.
function applySafeFixes(rawSource) {
  const clean = stripCommentsAndStrings(rawSource);
  const edits = []; // { start, end, replacement, rule }

  // GG-GAS-03: `; i++ )` / `; i++)` at loop increment  ->  `; ++i )`
  const incRe = /(;\s*)(\w+)(\+\+)(\s*\))/g;
  let m;
  while ((m = incRe.exec(clean)) !== null) {
    const start = m.index + m[1].length;
    const end = start + m[2].length + m[3].length;
    edits.push({ start, end, replacement: "++" + m[2], rule: "GG-GAS-03" });
  }

  // GG-GAS-05: `<type> name = 0;` -> `<type> name;`
  const zeroRe = /((?:uint\d*|int\d*)\s+(?:public\s+|private\s+|internal\s+)?\w+)(\s*=\s*0)(\s*;)/g;
  while ((m = zeroRe.exec(clean)) !== null) {
    const start = m.index + m[1].length;
    const end = start + m[2].length;
    edits.push({ start, end, replacement: "", rule: "GG-GAS-05" });
  }

  if (edits.length === 0) return { changed: false, source: rawSource, count: 0, byRule: {} };

  // Apply edits right-to-left so indices stay valid.
  edits.sort((a, b) => b.start - a.start);
  let out = rawSource;
  const byRule = {};
  for (const e of edits) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    byRule[e.rule] = (byRule[e.rule] || 0) + 1;
  }
  return { changed: true, source: out, count: edits.length, byRule };
}

function fixFile(file, { dryRun = false } = {}) {
  const raw = fs.readFileSync(file, "utf8");
  const res = applySafeFixes(raw);
  if (res.changed && !dryRun) fs.writeFileSync(file, res.source, "utf8");
  return res;
}

module.exports = { applySafeFixes, fixFile };

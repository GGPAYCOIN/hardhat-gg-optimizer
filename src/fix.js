"use strict";

// Safe auto-fixer. Every transform is guarded so it cannot change behavior in a
// way that breaks compilation. gg-fix always runs `hardhat compile` afterwards
// (in index.js) so a broken edit would surface immediately.
//
// Because the comment/string stripper preserves character positions, offsets
// computed on the stripped source map 1:1 onto the raw source.
//
// Transforms:
//   GG-GAS-03  for-loop `i++`               -> `++i`
//   GG-GAS-05  redundant `= 0` init         -> removed
//   GG-GAS-02  read-only `memory` param     -> `calldata`  (external/public, not mutated)
//   GG-GAS-01  `require(cond, "msg")`        -> custom error + `if (!(cond)) revert E();`

const fs = require("fs");
const { stripCommentsAndStrings, extractFunctions } = require("./analyzer/strip");

// ---- simple offset-based edits (GG-GAS-03 / 05 / 02) ----
function simpleEdits(raw, clean) {
  const edits = [];

  // GG-GAS-03: `; i++ )` -> `; ++i )`
  let re = /(;\s*)(\w+)(\+\+)(\s*\))/g, m;
  while ((m = re.exec(clean)) !== null) {
    const start = m.index + m[1].length;
    edits.push({ start, end: start + m[2].length + m[3].length, replacement: "++" + m[2], rule: "GG-GAS-03" });
  }

  // GG-GAS-05: `<type> name = 0;` -> `<type> name;`
  re = /((?:uint\d*|int\d*)\s+(?:public\s+|private\s+|internal\s+)?\w+)(\s*=\s*0)(\s*;)/g;
  while ((m = re.exec(clean)) !== null) {
    const start = m.index + m[1].length;
    edits.push({ start, end: start + m[2].length, replacement: "", rule: "GG-GAS-05" });
  }

  // GG-GAS-02: read-only reference param `memory` -> `calldata`
  for (const fn of extractFunctions(clean)) {
    if (!/\b(?:external|public)\b/.test(fn.header)) continue; // calldata safe here
    const headerText = clean.slice(fn.headerStart, fn.start);
    const pRe = /\b(?:string|bytes|\w+(?:\[\])+)\s+(memory)\s+(\w+)\b/g;
    let pm;
    while ((pm = pRe.exec(headerText)) !== null) {
      const paramName = pm[2];
      // Skip if the body mutates the param (assignment, index-assign, .push, delete).
      const mutRe = new RegExp(
        "\\b" + paramName + "\\b\\s*(?:=[^=]|\\+=|-=|\\*=)|\\b" + paramName + "\\s*\\[[^\\]]*\\]\\s*=|\\b" + paramName + "\\.push\\s*\\(|\\bdelete\\s+" + paramName + "\\b"
      );
      if (mutRe.test(fn.body)) continue;
      const memLocal = pm.index + pm[0].indexOf("memory");
      const start = fn.headerStart + memLocal;
      edits.push({ start, end: start + "memory".length, replacement: "calldata", rule: "GG-GAS-02" });
    }
  }

  return edits;
}

// ---- require(cond, "msg") -> custom error (GG-GAS-01) ----
// Only when the file has exactly ONE contract/library/interface (safe insertion scope).
function customErrorFix(raw, clean) {
  const containers = clean.match(/\b(?:contract|library|interface)\s+\w+[^{]*\{/g) || [];
  if (containers.length !== 1) return { edits: [], inserts: [] };

  const openIdx = clean.indexOf(containers[0]) + containers[0].length;

  const edits = [];
  let counter = 0;
  const errorDecls = [];

  // Scan for `require(` and parse to the matching `)`, tracking paren depth to
  // find the LAST top-level comma (separating condition from the message).
  const reqRe = /\brequire\s*\(/g;
  let rm;
  while ((rm = reqRe.exec(clean)) !== null) {
    let i = rm.index + rm[0].length;
    let depth = 1;
    let lastComma = -1;
    for (; i < clean.length && depth > 0; i++) {
      const ch = clean[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 1) lastComma = i;
    }
    const closeParen = i - 1;
    if (lastComma === -1) continue; // no message -> not a string require

    // Require a trailing semicolon.
    let j = closeParen + 1;
    while (j < clean.length && /\s/.test(clean[j])) j++;
    if (clean[j] !== ";") continue;

    // The message (raw) must be a plain string literal.
    const msgRaw = raw.slice(lastComma + 1, closeParen).trim();
    if (!/^"(?:[^"\\]|\\.)*"$|^'(?:[^'\\]|\\.)*'$/.test(msgRaw)) continue;

    const condRaw = raw.slice(rm.index + rm[0].length, lastComma).trim();
    if (!condRaw) continue;

    counter++;
    const errName = "GG_Revert" + counter;
    errorDecls.push("    error " + errName + "();");
    edits.push({
      start: rm.index,
      end: j + 1, // include the semicolon
      replacement: "if (!(" + condRaw + ")) revert " + errName + "();",
      rule: "GG-GAS-01",
    });
  }

  const inserts = errorDecls.length
    ? [{ at: openIdx, text: "\n" + errorDecls.join("\n") }]
    : [];
  return { edits, inserts };
}

function applySafeFixes(rawSource) {
  const clean = stripCommentsAndStrings(rawSource);
  let edits = simpleEdits(rawSource, clean);
  const ce = customErrorFix(rawSource, clean);
  edits = edits.concat(ce.edits);

  const inserts = ce.inserts;
  if (edits.length === 0 && inserts.length === 0) {
    return { changed: false, source: rawSource, count: 0, byRule: {} };
  }

  // Combine edits + inserts as position-based operations, apply right-to-left.
  const ops = edits
    .map((e) => ({ start: e.start, end: e.end, replacement: e.replacement, rule: e.rule }))
    .concat(inserts.map((ins) => ({ start: ins.at, end: ins.at, replacement: ins.text, rule: "insert" })));
  ops.sort((a, b) => b.start - a.start);

  let out = rawSource;
  const byRule = {};
  for (const op of ops) {
    out = out.slice(0, op.start) + op.replacement + out.slice(op.end);
    if (op.rule !== "insert") byRule[op.rule] = (byRule[op.rule] || 0) + 1;
  }
  const count = edits.length;
  return { changed: true, source: out, count, byRule };
}

function fixFile(file, { dryRun = false } = {}) {
  const raw = fs.readFileSync(file, "utf8");
  const res = applySafeFixes(raw);
  if (res.changed && !dryRun) fs.writeFileSync(file, res.source, "utf8");
  return res;
}

module.exports = { applySafeFixes, fixFile };

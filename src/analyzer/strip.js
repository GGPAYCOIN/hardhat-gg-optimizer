"use strict";

// Remove comments and string/hex literals from Solidity source so that
// pattern rules don't match inside comments or strings (kills false positives).
// Positions are preserved by replacing removed spans with spaces (keeps line numbers).
function stripCommentsAndStrings(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let state = "code"; // code | line | block | dq | sq

  const keepNewlines = (s) => s.replace(/[^\n]/g, " ");

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; out += "  "; i += 2; continue; }
      if (c === '"') { state = "dq"; out += " "; i += 1; continue; }
      if (c === "'") { state = "sq"; out += " "; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += "\n"; i += 1; continue; }
      out += " "; i += 1; continue;
    }
    if (state === "block") {
      if (c === "*" && c2 === "/") { state = "code"; out += "  "; i += 2; continue; }
      out += c === "\n" ? "\n" : " "; i += 1; continue;
    }
    if (state === "dq") {
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === '"') { state = "code"; out += " "; i += 1; continue; }
      out += c === "\n" ? "\n" : " "; i += 1; continue;
    }
    if (state === "sq") {
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === "'") { state = "code"; out += " "; i += 1; continue; }
      out += c === "\n" ? "\n" : " "; i += 1; continue;
    }
  }
  return out;
}

// Map a character index in the source to a 1-based line number.
function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

module.exports = { stripCommentsAndStrings, lineAt, extractFunctions };

// Extract Solidity function bodies from (already comment/string-stripped) source
// via brace matching. Returns [{ name, header, body, start, line }].
function extractFunctions(clean) {
  const fns = [];
  const re = /\bfunction\s+(\w+)\s*\([^;]*?\)[^{;]*\{/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const headerStart = m.index;
    let depth = 0;
    let i = m.index + m[0].length - 1; // at the opening '{'
    let bodyStart = i;
    for (; i < clean.length; i++) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    fns.push({
      name: m[1],
      header: m[0],
      headerStart: headerStart,
      body: clean.slice(bodyStart, i + 1),
      start: bodyStart,
      line: lineAt(clean, headerStart),
    });
    re.lastIndex = i + 1;
  }
  return fns;
}

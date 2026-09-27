"use strict";

// Gas optimization rules. Each rule scans comment/string-stripped source.
// `find` returns an array of { line, snippet } matches.

const { lineAt } = require("./strip");

function collect(clean, raw, regex) {
  const hits = [];
  let m;
  regex.lastIndex = 0;
  while ((m = regex.exec(clean)) !== null) {
    const line = lineAt(raw, m.index);
    const snippet = raw.split("\n")[line - 1].trim().slice(0, 90);
    hits.push({ line, snippet });
    if (m.index === regex.lastIndex) regex.lastIndex++;
  }
  return hits;
}

const GAS_RULES = [
  {
    id: "GG-GAS-01",
    name: "require() with string message",
    saving: "~50 gas/call + ~10k deploy",
    fix: "Use a custom error: error Unauthorized(); ... if (!ok) revert Unauthorized();",
    // After comment/string stripping the message literal becomes blanks, so a
    // string-message require looks like: require(cond,      );
    find: (clean, raw) => collect(clean, raw, /\brequire\s*\([^;]*,\s*\)\s*;/g),
  },
  {
    id: "GG-GAS-02",
    name: "memory used for read-only reference args",
    saving: "~60-300 gas/call",
    fix: "Change 'memory' to 'calldata' for external/public function params you don't mutate.",
    find: (clean, raw) =>
      collect(clean, raw, /function\s+\w+\s*\([^)]*\b(?:string|bytes|\w+\[\])\s+memory\s+\w+/g),
  },
  {
    id: "GG-GAS-03",
    name: "post-increment counter in for-loop",
    saving: "~30-40 gas/iteration",
    fix: "Use ++i and wrap in unchecked { ++i; } when overflow is impossible.",
    find: (clean, raw) => collect(clean, raw, /for\s*\([^;]*;[^;]*;\s*\w+\+\+\s*\)/g),
  },
  {
    id: "GG-GAS-04",
    name: ".length read directly in loop condition",
    saving: "~100 gas/iteration (SLOAD each pass)",
    fix: "Cache the length: uint256 len = arr.length; for (uint256 i; i < len; ) { ... }",
    find: (clean, raw) => collect(clean, raw, /for\s*\([^;]*;[^;]*\.length\s*;/g),
  },
  {
    id: "GG-GAS-05",
    name: "explicit zero-initialization of variable",
    saving: "~3 gas + bytecode",
    fix: "Remove '= 0'; uint/bool default to 0/false already (e.g. 'uint256 i;').",
    find: (clean, raw) =>
      collect(clean, raw, /\b(?:uint\d*|int\d*)\s+\w+\s*=\s*0\s*;/g),
  },
  {
    id: "GG-GAS-06",
    name: "x > 0 comparison on unsigned integer",
    saving: "~3-6 gas/check",
    fix: "Use 'x != 0' instead of 'x > 0' for uint (cheaper opcode).",
    find: (clean, raw) => collect(clean, raw, /\b\w+\s*>\s*0\b/g),
  },
  {
    id: "GG-GAS-07",
    name: "public function with no internal caller (external candidate)",
    saving: "~20-200 gas/call",
    fix: "Mark as 'external' if the function is only called from outside the contract.",
    find: (clean, raw) =>
      collect(clean, raw, /function\s+\w+\s*\([^)]*\)\s*public\b/g),
  },
  {
    id: "GG-GAS-08",
    name: "state variable set once (immutable/constant candidate)",
    saving: "~2100 gas/read (SLOAD -> code)",
    fix: "If only set in constructor, mark 'immutable'; if fixed at compile time, mark 'constant'.",
    find: (clean, raw) =>
      collect(clean, raw, /\b(?:address|uint\d*|bytes32)\s+(?:public|private|internal)\s+\w+\s*=\s*[^;]+;/g),
  },
  {
    id: "GG-GAS-09",
    name: "Small-type state variables not packed",
    saving: "~2000 gas/slot saved by packing",
    fix: "Declare small state vars (bool, uint8..uint128, address) adjacently so they share one 32-byte storage slot.",
    find: (clean, raw) => {
      const re = /^\s*(?:bool|uint(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128)|address)\s+(?:public|private|internal)\s+\w+\s*(?:=[^;]+)?;/gm;
      const all = collect(clean, raw, re);
      // Only meaningful when there are at least 2 packable state vars.
      return all.length >= 2 ? all : [];
    },
  },
];

function runGasRules(cleanSource, rawSource) {
  const results = [];
  for (const rule of GAS_RULES) {
    const hits = rule.find(cleanSource, rawSource);
    if (hits.length > 0) results.push({ rule, hits });
  }
  return results;
}

module.exports = { GAS_RULES, runGasRules };

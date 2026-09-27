"use strict";

// Security / vulnerability rules. Heuristic source-level checks that catch the
// most common real-world Solidity mistakes. Conservative to limit false alarms.

const { lineAt, extractFunctions } = require("./strip");

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

const SEC_RULES = [
  {
    id: "GG-SEC-01",
    severity: "HIGH",
    name: "tx.origin used for authorization",
    detail: "tx.origin can be phished by a malicious intermediate contract.",
    fix: "Use msg.sender for access control, never tx.origin.",
    find: (clean, raw) => collect(clean, raw, /\btx\.origin\b/g),
  },
  {
    id: "GG-SEC-02",
    severity: "HIGH",
    name: "Unchecked low-level call return value",
    detail: "A .call/.delegatecall whose success bool is ignored can silently fail.",
    fix: "Capture and check: (bool ok, ) = target.call{...}(...); require(ok);",
    find: (clean, raw) =>
      collect(clean, raw, /[^=)\s]\s*\.\s*(?:call|delegatecall|staticcall)\s*(?:\{[^}]*\})?\s*\(/g),
  },
  {
    id: "GG-SEC-03",
    severity: "MEDIUM",
    name: "block.timestamp / blockhash used as randomness",
    detail: "Miners/validators can influence these; not safe for randomness or lotteries.",
    fix: "Use a VRF / commit-reveal scheme for on-chain randomness.",
    find: (clean, raw) =>
      collect(clean, raw, /\b(?:block\.timestamp|block\.number|blockhash|block\.prevrandao)\b/g),
  },
  {
    id: "GG-SEC-04",
    severity: "HIGH",
    name: "selfdestruct present",
    detail: "selfdestruct can permanently remove the contract and forward all ETH.",
    fix: "Avoid selfdestruct; if required, guard with strong access control + timelock.",
    find: (clean, raw) => collect(clean, raw, /\bselfdestruct\s*\(/g),
  },
  {
    id: "GG-SEC-05",
    severity: "HIGH",
    name: "delegatecall to variable / untrusted target",
    detail: "delegatecall runs foreign code in your storage context; a hijacked target = total takeover.",
    fix: "Only delegatecall to a hardcoded, audited implementation; validate the target.",
    find: (clean, raw) => collect(clean, raw, /\.delegatecall\s*\(/g),
  },
  {
    id: "GG-SEC-06",
    severity: "LOW",
    name: "Floating pragma",
    detail: "^0.8.x lets the contract compile on unexpected compiler versions.",
    fix: "Pin the version: pragma solidity 0.8.20;",
    find: (clean, raw) => collect(clean, raw, /pragma\s+solidity\s+[\^>]/g),
  },
  {
    id: "GG-SEC-07",
    severity: "MEDIUM",
    name: "Native transfer via .transfer() / .send()",
    detail: "2300-gas stipend breaks with contract recipients and gas repricing.",
    fix: "Use (bool ok,) = payable(to).call{value: amount}(''); require(ok);",
    find: (clean, raw) => collect(clean, raw, /\.(?:transfer|send)\s*\(/g),
  },
  {
    id: "GG-SEC-08",
    severity: "MEDIUM",
    name: "State-changing external function with no access control",
    detail: "An externally callable function that writes state and has no owner/role check may be unprotected.",
    fix: "If it should be restricted, add onlyOwner / a role check (or an explicit msg.sender check).",
    find: (clean, raw) => {
      const hits = [];
      const writeRe = /(?:\b\w+(?:\[[^\]]*\])?\s*(?:=[^=]|\+=|-=|\*=)|\.push\s*\(|\bdelete\s+\w)/;
      const accessRe = /(?:only\w+|msg\.sender\s*(?:==|!=)|require\s*\(\s*msg\.sender|_checkOwner|hasRole|onlyRole)/;
      for (const fn of extractFunctions(clean)) {
        if (!/\b(?:public|external)\b/.test(fn.header)) continue;
        if (/\b(?:view|pure)\b/.test(fn.header)) continue;
        if (!writeRe.test(fn.body)) continue;
        if (accessRe.test(fn.header) || accessRe.test(fn.body)) continue;
        const absLine = lineAt(raw, fn.start);
        const snippet = raw.split("\n")[absLine - 1].trim().slice(0, 90);
        hits.push({ line: absLine, snippet });
      }
      return hits;
    },
  },
  {
    id: "GG-SEC-09",
    severity: "HIGH",
    name: "Possible reentrancy (state write after external call)",
    detail: "A value-bearing external call followed by a state change in the same function is the classic reentrancy pattern.",
    fix: "Follow checks-effects-interactions: update state BEFORE the external call, or add a nonReentrant guard.",
    find: (clean, raw) => {
      const hits = [];
      const callRe = /\.\s*(?:call|transfer|send)\s*(?:\{[^}]*value[^}]*\})?\s*\(/;
      const writeRe = /(?:\b\w+(?:\[[^\]]*\])?\s*(?:=|\+=|-=)[^=])/;
      for (const fn of extractFunctions(clean)) {
        const idx = fn.body.search(callRe);
        if (idx === -1) continue;
        const after = fn.body.slice(idx);
        if (writeRe.test(after)) {
          const absLine = lineAt(raw, fn.start + idx);
          const snippet = raw.split("\n")[absLine - 1].trim().slice(0, 90);
          hits.push({ line: absLine, snippet });
        }
      }
      return hits;
    },
  },
];

function runSecurityRules(cleanSource, rawSource) {
  const results = [];
  for (const rule of SEC_RULES) {
    const hits = rule.find(cleanSource, rawSource);
    if (hits.length > 0) results.push({ rule, hits });
  }
  return results;
}

module.exports = { SEC_RULES, runSecurityRules };

"use strict";

// Standalone test harness — proves the analyzer engine works without a full
// Hardhat install. Runs the real rules against test/contracts and asserts
// expected findings + checks that comments/strings do NOT create false positives.

const path = require("path");
const assert = require("assert");
const { analyzeSource, analyzeFiles, printReport } = require("../src/analyzer");

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log("  \x1b[32mPASS\x1b[0m " + name);
  } else {
    console.log("  \x1b[31mFAIL\x1b[0m " + name);
    failures++;
  }
}

// 1) Real scan of the sample contract.
const samplePath = path.join(__dirname, "contracts", "Sample.sol");
const report = analyzeFiles([samplePath]);
const printed = printReport(report, { color: true });
console.log(printed.text);

const f = report[0];
const secIds = f.sec.map((r) => r.rule.id);
const gasIds = f.gas.map((r) => r.rule.id);

console.log("\nAssertions:");
check("detects tx.origin (GG-SEC-01)", secIds.includes("GG-SEC-01"));
check("detects unchecked low-level call (GG-SEC-02)", secIds.includes("GG-SEC-02"));
check("detects block randomness (GG-SEC-03)", secIds.includes("GG-SEC-03"));
check("detects .transfer native send (GG-SEC-07)", secIds.includes("GG-SEC-07"));
check("detects missing access control (GG-SEC-08)", secIds.includes("GG-SEC-08"));
check("detects require string (GG-GAS-01)", gasIds.includes("GG-GAS-01"));
check("detects memory->calldata (GG-GAS-02)", gasIds.includes("GG-GAS-02"));
check("detects i++ loop (GG-GAS-03)", gasIds.includes("GG-GAS-03"));
check("detects .length in loop (GG-GAS-04)", gasIds.includes("GG-GAS-04"));
check("detects = 0 init (GG-GAS-05)", gasIds.includes("GG-GAS-05"));
check("detects > 0 on uint (GG-GAS-06)", gasIds.includes("GG-GAS-06"));
check("high severity count > 0", printed.totalHigh > 0);
check("detects reentrancy (GG-SEC-09)", secIds.includes("GG-SEC-09"));

// gg-fix safe auto-fixer.
const { applySafeFixes } = require("../src/fix");
const fixIn = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
contract F {
    uint256 total = 0;
    function loop(uint256 n) public {
        for (uint256 i = 0; i < n; i++) { total += i; }
    }
}`;
const fixed = applySafeFixes(fixIn);
console.log("\ngg-fix auto-fixer:");
check("fixer reports changes", fixed.changed && fixed.count >= 2);
check("fixer converts i++ to ++i", /;\s*\+\+i\s*\)/.test(fixed.source) && !/i\+\+\s*\)/.test(fixed.source));
check("fixer removes = 0 init", !/=\s*0\s*;/.test(fixed.source));
check("fixer preserves pragma/string safely", fixed.source.includes("pragma solidity 0.8.20;"));

// Reentrancy false-positive guard: external call with NO state write after.
const noReentry = analyzeSource(`pragma solidity 0.8.20;
contract Safe { function pay(address to) external {
  uint256 amt = 1; (bool ok,) = to.call{value: amt}(""); require(ok);
}}`);
check("no reentrancy FP when state written before call / none after",
  !noReentry.sec.some((r) => r.rule.id === "GG-SEC-09"));

// 2) False-positive guard: a clean, well-optimized contract with tricky comments/strings.
const cleanContract = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
contract Good {
    // this comment mentions tx.origin and selfdestruct but is only a comment
    error NotOwner();
    address private immutable _owner;
    string private constant NOTE = "use require with a string here in a literal > 0 tx.origin";
    constructor() { _owner = msg.sender; }
    function ping(uint256[] calldata xs) external pure returns (uint256 s) {
        uint256 len = xs.length;
        for (uint256 i; i < len; ) { s += xs[i]; unchecked { ++i; } }
    }
    function guard() external view { if (msg.sender != _owner) revert NotOwner(); }
}`;
const clean = analyzeSource(cleanContract);
console.log("\nFalse-positive guard (clean contract):");
check("no tx.origin false positive from comment/string", !clean.sec.some((r) => r.rule.id === "GG-SEC-01"));
check("no selfdestruct false positive from comment", !clean.sec.some((r) => r.rule.id === "GG-SEC-04"));
check("no require-string false positive from string literal", !clean.gas.some((r) => r.rule.id === "GG-GAS-01"));
check("no i++ false positive (uses ++i)", !clean.gas.some((r) => r.rule.id === "GG-GAS-03"));
check("no .length-in-loop false positive (cached)", !clean.gas.some((r) => r.rule.id === "GG-GAS-04"));
check("floating pragma NOT flagged when pinned", !clean.sec.some((r) => r.rule.id === "GG-SEC-06"));

console.log("");
if (failures > 0) {
  console.log("\x1b[31m" + failures + " test(s) failed\x1b[0m");
  process.exit(1);
}
console.log("\x1b[32mAll analyzer tests passed.\x1b[0m");

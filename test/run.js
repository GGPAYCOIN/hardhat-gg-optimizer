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

// calldata + custom-error fixers.
const advIn = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
contract Adv {
    mapping(address => uint256) public bal;
    function sum(uint256[] memory xs) external pure returns (uint256 s) {
        for (uint256 i = 0; i < xs.length; i++) { s += xs[i]; }
    }
    function mutate(bytes memory data) public { data[0] = 0x01; }
    function pay(uint256 amt) external {
        require(amt > 0, "zero");
        require(bal[msg.sender] >= amt, "low balance");
        bal[msg.sender] -= amt;
    }
}`;
const adv = applySafeFixes(advIn);
console.log("\ncalldata + custom-error fixers:");
check("memory->calldata on read-only param (sum)", /uint256\[\]\s+calldata\s+xs/.test(adv.source));
check("does NOT touch mutated param (mutate keeps memory)", /bytes\s+memory\s+data/.test(adv.source));
check("require string -> revert custom error", /if\s*\(!\(amt > 0\)\)\s*revert\s+GG_Revert\d+\(\);/.test(adv.source));
check("custom error declaration injected", /error\s+GG_Revert\d+\(\);/.test(adv.source));
check("no require-with-string left", !/require\s*\([^;]*,\s*["']/.test(adv.source));

// Safety: multi-contract file must NOT get custom-error injection (wrong scope risk).
const multi = applySafeFixes(`pragma solidity 0.8.20;
contract A { function f(uint256 x) external { require(x > 0, "a"); } }
contract B { function g(uint256 y) external { require(y > 0, "b"); } }`);
check("multi-contract file skips custom-error fix", !/revert GG_Revert/.test(multi.source));

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

// 3) Keystore + official RPC lock (v0.3.0 security features)
const { encryptKey, decryptKey } = require("../src/keystore");
const quota = require("../src/quota");
const fsT = require("fs");
const osT = require("os");

console.log("\nKeystore + RPC lock:");
const ksPriv = "0x" + "ab".repeat(32);
const ks = encryptKey(ksPriv, "s3cret");
check("keystore holds no plaintext key", !JSON.stringify(ks).includes("ab".repeat(32)));
check("keystore decrypts with right password", decryptKey(ks, "s3cret") === ksPriv);
let wrongPw = false;
try { decryptKey(ks, "nope"); } catch (e) { wrongPw = true; }
check("wrong password rejected", wrongPw);

const tmpWallet = path.join(osT.tmpdir(), "gg-test-wallet-" + Date.now() + ".json");
fsT.writeFileSync(tmpWallet, JSON.stringify({ address: "0x1234", priv: ksPriv, createdAt: "x" }));
quota.encryptWalletInPlace("pw123", tmpWallet);
const encW = JSON.parse(fsT.readFileSync(tmpWallet, "utf8"));
check("wallet file encrypted in place (v2, no plaintext priv)", encW.version === 2 && !!encW.keystore && encW.priv === undefined);
check("encrypted wallet key decryptable", quota.decryptWalletKey("pw123", tmpWallet) === ksPriv);
let noPw = false;
try { quota.decryptWalletKey(null, tmpWallet); } catch (e) { noPw = true; }
check("decrypt without password refused", noPw);
fsT.unlinkSync(tmpWallet);

check("official RPC accepted", quota.resolveRpc("https://rpc.gghyper.net") === "https://rpc.gghyper.net");
check("official RPC accepted (trailing slash)", quota.resolveRpc("https://rpc.gghyper.net/") === "https://rpc.gghyper.net");
check("empty defaults to official RPC", quota.resolveRpc(undefined) === "https://rpc.gghyper.net");
let badRpc = false;
try { quota.resolveRpc("https://evil-rpc.example.com"); } catch (e) { badRpc = true; }
check("unofficial RPC rejected", badRpc);
let httpRpc = false;
try { quota.resolveRpc("http://rpc.gghyper.net"); } catch (e) { httpRpc = true; }
check("non-https RPC rejected", httpRpc);

// 4) CI report mode (JSON + Markdown)
const { toJson, toMarkdown } = require("../src/report");
console.log("\nCI report mode:");
const ciReport = analyzeFiles([samplePath]);
const j = toJson(ciReport);
check("json has tool + version", j.tool === "hardhat-gg-optimizer" && typeof j.version === "string");
check("json summary counts high severity", j.summary.highSeverity > 0);
check("json findings carry lines arrays", j.files[0].findings.length > 0 && Array.isArray(j.files[0].findings[0].lines));
check("json round-trips through JSON.stringify", JSON.parse(JSON.stringify(j)).files.length === j.files.length);
const md = toMarkdown(ciReport);
check("markdown has report header", md.includes("gg-optimizer report"));
check("markdown has findings table", md.includes("| Rule | Severity |"));
check("empty markdown report says no findings", toMarkdown([]).includes("No findings"));

// 5) README badge generator
const { toBadge } = require("../src/report");
console.log("\nBadge generator:");
const cleanBadge = toBadge([]);
check("clean badge is brightgreen 'clean'", cleanBadge.message === "clean" && cleanBadge.color === "brightgreen");
check("badge escapes dashes for shields.io", cleanBadge.url.includes("gg--optimizer-clean-brightgreen"));
check("badge markdown links to npm", cleanBadge.markdown.includes("img.shields.io") && cleanBadge.markdown.includes("npmjs.com/package/hardhat-gg-optimizer"));
const highBadge = toBadge(ciReport);
check("high-severity badge is red", highBadge.color === "red" && highBadge.message.includes("high"));
const gasOnly = [{ file: "x.sol", sec: [], gas: [{ rule: { id: "GG-GAS-03", name: "n", saving: "s", fix: "f" }, hits: [{ line: 1 }, { line: 2 }] }] }];
const yellowBadge = toBadge(gasOnly);
check("findings-only badge is yellow with count", yellowBadge.color === "yellow" && yellowBadge.message === "2 findings");

console.log("");
if (failures > 0) {
  console.log("\x1b[31m" + failures + " test(s) failed\x1b[0m");
  process.exit(1);
}
console.log("\x1b[32mAll analyzer tests passed.\x1b[0m");

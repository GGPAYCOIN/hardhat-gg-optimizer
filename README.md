# hardhat-gg-optimizer

A free, zero-config Hardhat plugin that scans your Solidity for **gas savings** and **common vulnerabilities** — printed automatically right after every `compile`. No account, no signup.

## Install

```bash
npm install --save-dev hardhat-gg-optimizer
```

```js
// hardhat.config.js
require("hardhat-gg-optimizer");

module.exports = {
  solidity: "0.8.20",
  // ggOptimizer: { autoScan: false }  // opt out of auto-run after compile
};
```

That's it. Run `npx hardhat compile` (or `npx hardhat gg-scan`) and you'll get a report like:

```
=====================================================
       GG-CHAIN OPTIMIZER  ·  gas + security
=====================================================

▸ contracts/MyToken.sol
  ● [HIGH] GG-SEC-01 tx.origin used for authorization (x1)
      fix: Use msg.sender for access control, never tx.origin.
  ◆ GG-GAS-01 require() with string message (x4)
      save: ~50 gas/call + ~10k deploy
      fix: Use a custom error: error X(); ... if (!ok) revert X();

Summary: 17 gas optimizations · 2 high-severity · 9 security findings
```

## What it checks

**Gas (GG-GAS-\*)**: string `require` messages, `memory` vs `calldata`, `i++` vs unchecked `++i`, `.length` in loop conditions, redundant `= 0` init, `x > 0` vs `x != 0`, `public` → `external` candidates, `immutable`/`constant` candidates.

**Security (GG-SEC-\*)**: `tx.origin` auth, unchecked low-level calls, weak on-chain randomness, `selfdestruct`, risky `delegatecall`, floating pragma, `.transfer()`/`.send()` stipend pitfalls, externally-callable state-changers with no visible access modifier.

Comments and string literals are stripped before analysis, so findings point at real code, not documentation.

## Notes

These are heuristic, source-level hints to help you review faster — not a substitute for a full professional audit. All analysis runs **locally**; nothing leaves your machine.

MIT licensed.

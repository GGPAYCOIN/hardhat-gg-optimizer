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

## Auto-fix (gg-fix)

```bash
npx hardhat gg-fix            # apply safe fixes
npx hardhat gg-fix --dry-run  # preview only
```

`gg-fix` applies only **behavior-safe** transforms and then re-compiles to prove nothing broke:

- `i++` → `++i` in loops (GG-GAS-03)
- redundant `= 0` initializers removed (GG-GAS-05)
- read-only `memory` params → `calldata` (GG-GAS-02, only when the param isn't mutated)
- `require(cond, "msg")` → a custom error + `if (!(cond)) revert E();` (GG-GAS-01, single-contract files)

### Pricing (transparent)

Scanning is free forever. `gg-fix` includes a free allowance, then costs a small amount of **GG**:

- Nothing is ever charged without an explicit `--yes` (or `GG_OPTIMIZER_YES=1`).
- The command prints your local wallet address and the exact cost first.
- Default mode is `mock` (local credits, no real chain). To use real on-chain GG:

```bash
export GG_OPTIMIZER_NETWORK=ggchain
export GGCHAIN_RPC=https://rpc.gghyper.net   # optional, this is the default
npx hardhat gg-fix --yes                     # burns GG from your local wallet (needs `ethers`)
```

In `ggchain` mode a wallet is generated at `~/.gg-optimizer/wallet.json`; send it a little GG to cover fixes + gas.

## What it checks

**Gas (GG-GAS-\*)**: string `require` messages, `memory` vs `calldata`, `i++` vs unchecked `++i`, `.length` in loop conditions, redundant `= 0` init, `x > 0` vs `x != 0`, `public` → `external` candidates, `immutable`/`constant` candidates, unpacked small-type storage variables.

**Security (GG-SEC-\*)**: `tx.origin` auth, unchecked low-level calls, weak on-chain randomness, `selfdestruct`, risky `delegatecall`, floating pragma, `.transfer()`/`.send()` stipend pitfalls, externally-callable state-changers with no access control, and possible reentrancy (state write after an external value call).

Comments and string literals are stripped before analysis, so findings point at real code, not documentation.

## Notes

These are heuristic, source-level hints to help you review faster — not a substitute for a full professional audit. All analysis runs **locally**; nothing leaves your machine.

MIT licensed.

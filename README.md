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

### Pricing (transparent & exact)

Scanning is free forever. `gg-fix`:

| | |
|---|---|
| First **3** `gg-fix` runs | **free** |
| After that | **1 GG per run** (fixed in code, no surprises) |

- Nothing is ever charged without an explicit `--yes` (or `GG_OPTIMIZER_YES=1`).
- The command prints your wallet address, balance and the exact cost first — `--dry-run` never charges.
- Default mode is `mock` (local credits, no real chain). To use real on-chain GG:

```bash
export GG_OPTIMIZER_NETWORK=ggchain
npx hardhat gg-fix --yes   # burns GG from your local wallet (needs `ethers`)
```

In `ggchain` mode a wallet is generated at `~/.gg-optimizer/wallet.json`; send it a little GG to cover fixes + gas.

**Official RPC lock:** `ggchain` mode only ever talks to the official endpoint `https://rpc.gghyper.net`. Any other `GGCHAIN_RPC` value is rejected — this protects your wallet from RPC spoofing / malicious nodes.

### Wallet security

- **Encrypted keystore:** the private key can be password-encrypted at rest (scrypt + AES-256-GCM) so a stolen `wallet.json` alone cannot spend your GG:

  ```bash
  npx hardhat gg-wallet            # show address + encryption status
  npx hardhat gg-wallet --encrypt  # password-protect the key (prompted, hidden input)
  ```

  Or set `GG_OPTIMIZER_PASSWORD` (e.g. in CI) — new wallets are then created encrypted, and existing plaintext ones are upgraded automatically. **`ggchain` mode refuses to run with an unencrypted key.** The password is never stored; if you lose it, the key is unrecoverable — back it up.
- The keyfile lives at `~/.gg-optimizer/wallet.json` (`chmod 600`). **Back it up** and keep only **small amounts** in it — treat it like petty cash, not a vault.
- The displayed address is the real on-chain address derived from the stored key.
- We will **never** ask for your private key. Anyone who does is scamming you.
- Install only the official package: `hardhat-gg-optimizer` (source: [github.com/GGPAYCOIN/hardhat-gg-optimizer](https://github.com/GGPAYCOIN/hardhat-gg-optimizer)). Beware of look-alike names.

> ⚠️ **About the `require` → custom-error fix (GG-GAS-01):** it changes the revert data from a string to an error selector (dApps/tests matching the revert *string* must be updated), and it is applied **only to files containing a single contract**. Review the diff with git before committing — as with all auto-fixes.

## CI report mode

`gg-scan` can emit machine-readable reports so teams can post findings on pull requests automatically:

```bash
npx hardhat gg-scan --json                                      # JSON to stdout
npx hardhat gg-scan --markdown --output gg-report.md            # PR-comment-ready Markdown file
npx hardhat gg-scan --json --fail-on-high                       # exit 1 on any HIGH-severity finding
```

GitHub Actions example (posts the report as a sticky PR comment and fails the job on high-severity findings):

```yaml
- run: npx hardhat gg-scan --markdown --output gg-report.md --fail-on-high
- uses: marocchino/sticky-pull-request-comment@v2
  if: always()
  with:
    path: gg-report.md
```

## What it checks

**Gas (GG-GAS-\*)**: string `require` messages, `memory` vs `calldata`, `i++` vs unchecked `++i`, `.length` in loop conditions, redundant `= 0` init, `x > 0` vs `x != 0`, `public` → `external` candidates, `immutable`/`constant` candidates, unpacked small-type storage variables.

**Security (GG-SEC-\*)**: `tx.origin` auth, unchecked low-level calls, weak on-chain randomness, `selfdestruct`, risky `delegatecall`, floating pragma, `.transfer()`/`.send()` stipend pitfalls, externally-callable state-changers with no access control, and possible reentrancy (state write after an external value call).

Comments and string literals are stripped before analysis, so findings point at real code, not documentation.

## Notes

These are heuristic, source-level hints to help you review faster — not a substitute for a full professional audit. All analysis runs **locally**; nothing leaves your machine.

MIT licensed.

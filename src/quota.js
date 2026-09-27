"use strict";

// Transparent GG COIN quota / license check for premium actions (e.g. gg-fix).
//
// Principles (NOT silent):
//  - Read-only scanning is ALWAYS free and unlimited.
//  - Premium actions get a free allowance, then require a GG credit.
//  - A local wallet is generated the first time AND its address is printed.
//  - No charge ever happens without an explicit --yes / GG_OPTIMIZER_YES=1.
//  - Default network is "mock" (no real chain calls) until the user opts into
//    testnet/mainnet. Nothing is burned silently.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const HOME = path.join(os.homedir(), ".gg-optimizer");
const WALLET_FILE = path.join(HOME, "wallet.json");
const USAGE_FILE = path.join(HOME, "usage.json");

const FREE_PREMIUM_RUNS = 3; // free gg-fix runs before a GG credit is needed
const COST_PER_FIX = 1;      // GG credits per gg-fix run

function ensureDir() {
  if (!fs.existsSync(HOME)) fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
}

// Deterministic pseudo-address from a random private key (mock; not a real signer).
function getOrCreateWallet() {
  ensureDir();
  if (fs.existsSync(WALLET_FILE)) {
    return JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"));
  }
  const priv = crypto.randomBytes(32).toString("hex");
  const address =
    "0x" + crypto.createHash("sha256").update(priv).digest("hex").slice(0, 40);
  const wallet = { address, createdAt: new Date().toISOString() };
  // Private key stored locally with tight perms; address is what we display.
  fs.writeFileSync(WALLET_FILE, JSON.stringify({ ...wallet, priv }, null, 2), {
    mode: 0o600,
  });
  return wallet;
}

function readUsage() {
  ensureDir();
  if (fs.existsSync(USAGE_FILE)) return JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
  return { premiumRuns: 0, creditsSpent: 0 };
}

function writeUsage(u) {
  ensureDir();
  fs.writeFileSync(USAGE_FILE, JSON.stringify(u, null, 2));
}

// Mock balance store (per-wallet) so testnet flow is testable without a chain.
function mockBalance(address, delta = 0) {
  const f = path.join(HOME, "mock_balance.json");
  let bal = {};
  if (fs.existsSync(f)) bal = JSON.parse(fs.readFileSync(f, "utf8"));
  if (bal[address] === undefined) bal[address] = 0;
  bal[address] += delta;
  fs.writeFileSync(f, JSON.stringify(bal, null, 2));
  return bal[address];
}

// Decide whether a premium action may proceed. Returns a plan object; the caller
// prints it and (if a charge is needed) requires explicit consent before commit().
function planPremiumAction({ network = process.env.GG_OPTIMIZER_NETWORK || "mock" } = {}) {
  const wallet = getOrCreateWallet();
  const usage = readUsage();
  const freeLeft = Math.max(0, FREE_PREMIUM_RUNS - usage.premiumRuns);

  if (freeLeft > 0) {
    return {
      wallet,
      network,
      chargeNeeded: false,
      cost: 0,
      freeLeft: freeLeft - 1,
      message: `Free allowance: ${freeLeft} premium run(s) left (no GG needed).`,
      commit() {
        usage.premiumRuns += 1;
        writeUsage(usage);
      },
    };
  }

  const balance = mockBalance(wallet.address, 0);
  const enough = balance >= COST_PER_FIX;
  return {
    wallet,
    network,
    chargeNeeded: true,
    cost: COST_PER_FIX,
    balance,
    enough,
    message: enough
      ? `This premium run costs ${COST_PER_FIX} GG (network: ${network}). Balance: ${balance} GG.`
      : `Free allowance used. Need ${COST_PER_FIX} GG to continue. Wallet ${wallet.address} balance: ${balance} GG.`,
    commit() {
      if (!enough) throw new Error("insufficient GG balance");
      mockBalance(wallet.address, -COST_PER_FIX);
      usage.premiumRuns += 1;
      usage.creditsSpent += COST_PER_FIX;
      writeUsage(usage);
    },
  };
}

module.exports = {
  planPremiumAction,
  getOrCreateWallet,
  readUsage,
  mockBalance,
  FREE_PREMIUM_RUNS,
  COST_PER_FIX,
  HOME,
};

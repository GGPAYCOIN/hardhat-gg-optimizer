"use strict";

// Transparent GG COIN quota / license check for premium actions (e.g. gg-fix).
//
// Principles (NOT silent):
//  - Read-only scanning is ALWAYS free and unlimited.
//  - Premium actions get a free allowance, then require a GG credit.
//  - A local wallet is generated the first time AND its address is printed.
//  - No charge ever happens without an explicit --yes / GG_OPTIMIZER_YES=1.
//  - Default network is "mock" (no real chain calls) until the user opts in.
//  - ggchain mode ONLY talks to the official RPC (anti-spoofing) and REQUIRES
//    the wallet key to be password-encrypted at rest.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { encryptKey, decryptKey } = require("./keystore");

const HOME = path.join(os.homedir(), ".gg-optimizer");
const WALLET_FILE = path.join(HOME, "wallet.json");
const USAGE_FILE = path.join(HOME, "usage.json");

const FREE_PREMIUM_RUNS = 3; // free gg-fix runs before a GG credit is needed
const COST_PER_FIX = 1;      // GG credits per gg-fix run

// ---- official RPC lock (anti RPC-spoofing) ----
const OFFICIAL_RPCS = ["https://rpc.gghyper.net"];
const DEFAULT_RPC = OFFICIAL_RPCS[0];

function resolveRpc(requested) {
  const rpc = String(requested || DEFAULT_RPC).replace(/\/+$/, "");
  if (!OFFICIAL_RPCS.includes(rpc)) {
    throw new Error(
      "[gg-optimizer] unofficial RPC rejected: " + requested +
      "\n  ggchain mode only accepts the official endpoint: " + OFFICIAL_RPCS.join(", ") +
      "\n  (this protects your wallet from RPC spoofing / malicious nodes)"
    );
  }
  return rpc;
}

function ensureDir() {
  if (!fs.existsSync(HOME)) fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
}

function loadEthers() {
  try { return require("ethers"); } catch (e) { return null; }
}

// Real EVM address derivation (needs ethers). Returns null when unavailable.
function realAddressFromPriv(priv) {
  const ethers = loadEthers();
  if (!ethers) return null;
  try {
    return new ethers.Wallet(priv.startsWith("0x") ? priv : "0x" + priv).address;
  } catch (e) {
    return null;
  }
}

function readWalletFile(file = WALLET_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function walletStatus(file = WALLET_FILE) {
  if (!fs.existsSync(file)) return { exists: false, file };
  const w = readWalletFile(file);
  return { exists: true, file, address: w.address, encrypted: !!w.keystore };
}

// Convert a plaintext (v1) wallet file to an encrypted (v2) keystore in place.
function encryptWalletInPlace(password, file = WALLET_FILE) {
  const w = readWalletFile(file);
  if (w.keystore) return { already: true, address: w.address };
  if (!password) throw new Error("password required to encrypt the wallet key");
  const address = w.address || realAddressFromPriv(w.priv);
  const record = {
    version: 2,
    address,
    keystore: encryptKey(w.priv, password),
    createdAt: w.createdAt || new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2), { mode: 0o600 });
  return { already: false, address };
}

// Return the private key: plaintext for v1 files, decrypted for v2 keystores.
function decryptWalletKey(password, file = WALLET_FILE) {
  const w = readWalletFile(file);
  if (!w.keystore) return w.priv;
  if (!password) throw new Error("password required to unlock the encrypted wallet key");
  return decryptKey(w.keystore, password);
}

// Hidden-input password prompt (TTY only). Resolves null when non-interactive.
function promptHidden(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(null);
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(question);
    rl._writeToOutput = function () {};
    rl.question("", (ans) => {
      rl.close();
      process.stdout.write("\n");
      resolve(ans);
    });
  });
}

// Password source order: GG_OPTIMIZER_PASSWORD env, then interactive prompt.
async function getPassword({ confirm = false } = {}) {
  if (process.env.GG_OPTIMIZER_PASSWORD) return process.env.GG_OPTIMIZER_PASSWORD;
  const p1 = await promptHidden("[gg-optimizer] wallet password: ");
  if (p1 === null) return null;
  if (!p1) throw new Error("empty password not allowed");
  if (confirm) {
    const p2 = await promptHidden("[gg-optimizer] confirm password: ");
    if (p1 !== p2) throw new Error("passwords do not match");
  }
  return p1;
}

function getOrCreateWallet() {
  ensureDir();
  if (fs.existsSync(WALLET_FILE)) {
    const w = readWalletFile();
    if (w.keystore) return { address: w.address, encrypted: true };
    // v1 plaintext file. Migration: older versions stored a pseudo (hash)
    // address — replace it with the REAL address derived from the private key
    // so funds are never sent to an unspendable address.
    const real = realAddressFromPriv(w.priv);
    if (real && w.address !== real) {
      w.address = real;
      fs.writeFileSync(WALLET_FILE, JSON.stringify(w, null, 2), { mode: 0o600 });
      console.warn("[gg-optimizer] wallet address corrected to the real on-chain address: " + real);
    }
    if (process.env.GG_OPTIMIZER_PASSWORD) {
      encryptWalletInPlace(process.env.GG_OPTIMIZER_PASSWORD);
      console.warn("[gg-optimizer] wallet key encrypted at rest (AES-256-GCM + scrypt).");
      return { address: w.address, encrypted: true };
    }
    console.warn(
      "[gg-optimizer] wallet key is UNENCRYPTED at rest. Protect it: " +
      "npx hardhat gg-wallet --encrypt (or set GG_OPTIMIZER_PASSWORD)."
    );
    return { address: w.address, encrypted: false };
  }

  const ethers = loadEthers();
  let priv, address;
  if (ethers) {
    const w = ethers.Wallet.createRandom();
    priv = w.privateKey;
    address = w.address; // real, spendable address
  } else {
    priv = "0x" + crypto.randomBytes(32).toString("hex");
    address = null; // derived on first on-chain use (needs ethers)
  }
  const pw = process.env.GG_OPTIMIZER_PASSWORD;
  const createdAt = new Date().toISOString();
  const record = pw
    ? { version: 2, address, keystore: encryptKey(priv, pw), createdAt }
    : { address, priv, createdAt };
  fs.writeFileSync(WALLET_FILE, JSON.stringify(record, null, 2), { mode: 0o600 });
  console.warn(
    "\n[gg-optimizer] New local wallet created: " + (address || "(install ethers to see the on-chain address)") +
    "\n  * key at rest: " + (pw
      ? "ENCRYPTED (AES-256-GCM + scrypt)"
      : "UNENCRYPTED — run `npx hardhat gg-wallet --encrypt` to protect it") +
    "\n  * BACK UP ~/.gg-optimizer/wallet.json — losing it loses any GG in the wallet." +
    "\n  * Keep only SMALL amounts here." +
    "\n  * We will NEVER ask for your private key.\n"
  );
  return { address, encrypted: !!pw };
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

  const balance = mockBalance(wallet.address || "local", 0);
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
      mockBalance(wallet.address || "local", -COST_PER_FIX);
      usage.premiumRuns += 1;
      usage.creditsSpent += COST_PER_FIX;
      writeUsage(usage);
    },
  };
}

// ---- real on-chain GG burn (opt-in via GG_OPTIMIZER_NETWORK=ggchain) ----
// GG is the native coin of GGChain, so a "burn" = sending value to the standard
// dead address. Requires `ethers` (peer) and the local wallet to hold GG + gas.
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

async function onchainBalanceByAddress(address, rpc) {
  const ethers = loadEthers();
  if (!ethers) throw new Error("ethers not installed (npm i ethers) — needed for on-chain GG mode");
  const provider = new ethers.JsonRpcProvider(resolveRpc(rpc));
  const wei = await provider.getBalance(address);
  return Number(ethers.formatEther(wei));
}

async function onchainBurn(privKey, rpc, amountGg) {
  const ethers = loadEthers();
  if (!ethers) throw new Error("ethers not installed (npm i ethers) — needed for on-chain GG mode");
  const provider = new ethers.JsonRpcProvider(resolveRpc(rpc));
  const wallet = new ethers.Wallet(privKey.startsWith("0x") ? privKey : "0x" + privKey, provider);
  const tx = await wallet.sendTransaction({
    to: BURN_ADDRESS,
    value: ethers.parseEther(String(amountGg)),
  });
  const receipt = await tx.wait();
  return receipt.hash;
}

// Async planner for the real on-chain path.
async function planPremiumActionOnchain(rpcRequested) {
  const rpc = resolveRpc(rpcRequested); // official endpoint only
  getOrCreateWallet(); // ensures wallet exists + migrates any pseudo-address
  let status = walletStatus();

  // ggchain mode requires the key encrypted at rest (a stolen file alone must
  // not be able to spend GG).
  if (!status.encrypted) {
    const pw = await getPassword({ confirm: true });
    if (!pw) {
      throw new Error(
        "[gg-optimizer] ggchain mode requires an encrypted wallet key.\n" +
        "  Set GG_OPTIMIZER_PASSWORD or run: npx hardhat gg-wallet --encrypt"
      );
    }
    encryptWalletInPlace(pw);
    console.warn("[gg-optimizer] wallet key encrypted at rest before on-chain use.");
    status = walletStatus();
  }
  if (!status.address) {
    throw new Error("[gg-optimizer] wallet has no derived address — install `ethers` and re-run");
  }

  const usage = readUsage();
  const freeLeft = Math.max(0, FREE_PREMIUM_RUNS - usage.premiumRuns);
  if (freeLeft > 0) {
    return {
      wallet: { address: status.address }, network: "ggchain", chargeNeeded: false,
      cost: 0, freeLeft: freeLeft - 1,
      message: `Free allowance: ${freeLeft} premium run(s) left (no GG needed).`,
      commit: async () => { usage.premiumRuns += 1; writeUsage(usage); },
    };
  }

  const gg = await onchainBalanceByAddress(status.address, rpc);
  const enough = gg >= COST_PER_FIX;
  return {
    wallet: { address: status.address }, network: "ggchain", chargeNeeded: true,
    cost: COST_PER_FIX, balance: gg, enough,
    message: enough
      ? `This premium run burns ${COST_PER_FIX} GG on GGChain (official RPC: ${rpc}). Balance: ${gg} GG.`
      : `Free allowance used. Need ${COST_PER_FIX} GG on GGChain. Wallet ${status.address} balance: ${gg} GG.`,
    commit: async () => {
      if (!enough) throw new Error("insufficient GG balance");
      const pw = await getPassword();
      const priv = decryptWalletKey(pw);
      const hash = await onchainBurn(priv, rpc, COST_PER_FIX);
      usage.premiumRuns += 1; usage.creditsSpent += COST_PER_FIX; writeUsage(usage);
      return hash;
    },
  };
}

module.exports = {
  planPremiumAction,
  planPremiumActionOnchain,
  onchainBalanceByAddress,
  getOrCreateWallet,
  walletStatus,
  encryptWalletInPlace,
  decryptWalletKey,
  getPassword,
  resolveRpc,
  readUsage,
  mockBalance,
  FREE_PREMIUM_RUNS,
  COST_PER_FIX,
  BURN_ADDRESS,
  DEFAULT_RPC,
  OFFICIAL_RPCS,
  HOME,
  WALLET_FILE,
};

import { quota } from "../util.mjs";

export default async function ggWallet(args) {
  quota.getOrCreateWallet();
  const s = quota.walletStatus();
  console.log(`\nWallet file : ${s.file}`);
  console.log(`Address     : ${s.address || "(install ethers to derive the on-chain address)"}`);
  console.log(
    `Key at rest : ${s.encrypted ? "\x1b[32mENCRYPTED (AES-256-GCM + scrypt)\x1b[0m" : "\x1b[33mUNENCRYPTED\x1b[0m"}`
  );
  if (!args.encrypt) {
    if (!s.encrypted) {
      console.log(`\nEncrypt it: \x1b[1mnpx hardhat gg-wallet --encrypt\x1b[0m (or set GG_OPTIMIZER_PASSWORD)\n`);
    } else {
      console.log("");
    }
    return;
  }
  if (s.encrypted) {
    console.log("\nAlready encrypted — nothing to do.\n");
    return;
  }
  const pw = await quota.getPassword({ confirm: true });
  if (!pw) {
    throw new Error("No password available. Set GG_OPTIMIZER_PASSWORD or run in an interactive terminal.");
  }
  quota.encryptWalletInPlace(pw);
  console.log(`\n\x1b[32m✔ Wallet key encrypted at rest.\x1b[0m Remember the password — it cannot be recovered.\n`);
}

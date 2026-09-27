import { task, overrideTask } from "hardhat/config";

// Hardhat 3 plugin entry (ESM). The Hardhat 2 entry stays at the package root.
// Usage in hardhat.config.ts:
//   import ggOptimizer from "hardhat-gg-optimizer/hh3";
//   export default { plugins: [ggOptimizer], ... };

const plugin = {
  id: "hardhat-gg-optimizer",
  tasks: [
    task("gg-scan", "Scan contracts for gas savings and common vulnerabilities")
      .addFlag({ name: "json", description: "Print the report as JSON (CI-friendly)" })
      .addFlag({ name: "markdown", description: "Print the report as Markdown (PR comment)" })
      .addFlag({ name: "badge", description: "Print a README badge (Markdown) for the scan result" })
      .addFlag({ name: "failOnHigh", description: "Exit with code 1 when high-severity findings exist" })
      .addOption({ name: "output", description: "Write the report to a file instead of stdout", defaultValue: "" })
      .setAction(() => import("./tasks/scan.mjs"))
      .build(),
    task("gg-fix", "Auto-apply safe gas fixes (premium after free allowance)")
      .addFlag({ name: "yes", description: "Confirm any GG charge non-interactively" })
      .addFlag({ name: "dryRun", description: "Preview changes without writing files or charging" })
      .setAction(() => import("./tasks/fix.mjs"))
      .build(),
    task("gg-wallet", "Show the local gg-optimizer wallet and encrypt its key at rest")
      .addFlag({ name: "encrypt", description: "Password-encrypt the private key (AES-256-GCM + scrypt)" })
      .setAction(() => import("./tasks/wallet.mjs"))
      .build(),
    overrideTask("build")
      .setAction(() => import("./tasks/build.mjs"))
      .build(),
  ],
};

export default plugin;

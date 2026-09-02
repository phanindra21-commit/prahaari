import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const envTargets = [join(repoRoot, "apps", "api"), join(repoRoot, "services", "ml")];

for (const dir of envTargets) {
  const example = join(dir, ".env.example");
  const target = join(dir, ".env");

  if (!existsSync(example)) {
    console.warn(`[setup] Skipping ${target} — no .env.example found at ${example}`);
    continue;
  }

  if (existsSync(target)) {
    console.log(`[setup] Skipping ${target} — already exists`);
    continue;
  }

  copyFileSync(example, target);
  console.log(`[setup] Created ${target}`);
}

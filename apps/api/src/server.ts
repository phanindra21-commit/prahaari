import "dotenv/config";
import { createApp } from "./app";
import { connectDb } from "./lib/db";
import { env } from "./lib/env";

async function main(): Promise<void> {
  await connectDb(env.MONGODB_URI);
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`[api] PRAHARI API listening on http://localhost:${env.PORT}`);
  });
}

main().catch((error: unknown) => {
  console.error("[api] Failed to start:", error);
  process.exitCode = 1;
});

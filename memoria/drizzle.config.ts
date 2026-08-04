import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Next.js loads .env.local automatically; the drizzle-kit CLI does not.
if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

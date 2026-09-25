import { config as loadDotenv } from "dotenv";
import { loadEnv } from "../config/env";
import { runMigrations } from "./migrations-runner";

// Standalone (not through Nest's ConfigModule), so .env needs loading here too.
loadDotenv();

runMigrations(loadEnv(process.env).DATABASE_URL, console.log).catch((err) => {
  console.error(err);
  process.exit(1);
});

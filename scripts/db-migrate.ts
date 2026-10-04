// Creates the tables on the Neon database in DATABASE_URL. Safe to run repeatedly.
// Usage: npm run db:migrate
import { createNeonRunner, migrate } from "../src/db/index.js";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

await migrate(createNeonRunner(url));
console.log("schema is up to date");

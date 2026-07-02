import 'dotenv/config';
import { db } from './src/db/index.ts';
import { sql } from 'drizzle-orm';

async function reset() {
  console.log("Dropping tables...");
  await db.execute(sql`DROP TABLE IF EXISTS transaction_logs CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS master_receipts CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS temp_receipts CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS balances CASCADE;`);
  await db.execute(sql`DROP TABLE IF EXISTS users CASCADE;`);
  console.log("Tables dropped.");
  process.exit(0);
}

reset();

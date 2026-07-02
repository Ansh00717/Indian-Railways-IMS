import 'dotenv/config';
import { db } from './src/db/index.ts';
import { sql } from 'drizzle-orm';

async function verify() {
  try {
    const result = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema='public';
    `);
    console.log("Existing Tables:");
    result.rows.forEach((row: any) => console.log(` - ${row.table_name}`));
    process.exit(0);
  } catch (err) {
    console.error("Failed to verify tables:", err);
    process.exit(1);
  }
}

verify();

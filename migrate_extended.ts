import 'dotenv/config';
import pg from 'pg';

async function migrate() {
  const pool = new pg.Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
  });
  await pool.query('ALTER TABLE temp_receipts ADD COLUMN IF NOT EXISTS extended_fields TEXT');
  await pool.query('ALTER TABLE master_receipts ADD COLUMN IF NOT EXISTS extended_fields TEXT');
  console.log('Migration complete: extended_fields column added');
  await pool.end();
}

migrate().catch(console.error);

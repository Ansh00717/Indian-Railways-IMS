import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.SQL_HOST || 'localhost',
    user: process.env.SQL_USER || 'postgres',
    password: process.env.SQL_PASSWORD || 'postgres',
    database: process.env.SQL_DB_NAME || 'postgres',
    ssl: false
  },
});

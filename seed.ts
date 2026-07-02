import 'dotenv/config';
import { db } from './src/db/index.ts';
import { users } from './src/db/schema.ts';
import bcrypt from 'bcryptjs';

async function seed() {
  try {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await db.insert(users).values({
      fullName: 'Administrator',
      email: 'admin@rdso.local',
      username: 'admin',
      passwordHash: passwordHash,
      isActive: 1,
    });
    console.log("Seed user 'admin' created successfully!");
    process.exit(0);
  } catch (err: any) {
    if (err.message.includes('duplicate key value violates unique constraint')) {
       console.log("Seed user already exists. Skipping.");
       process.exit(0);
    }
    console.error("Failed to create seed user:", err);
    process.exit(1);
  }
}

seed();

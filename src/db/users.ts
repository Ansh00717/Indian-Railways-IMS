import { db } from './index.ts';
import { users } from './schema.ts';

import { eq, or } from 'drizzle-orm';

export async function createUser(data: typeof users.$inferInsert) {
  const result = await db.insert(users).values(data).returning();
  return result[0];
}

export async function getUserByUsernameOrEmail(identifier: string) {
  const result = await db.select().from(users).where(
    or(
      eq(users.username, identifier),
      eq(users.email, identifier)
    )
  );
  return result[0] || null;
}

export async function getUserById(id: number) {
  const result = await db.select().from(users).where(eq(users.id, id));
  return result[0] || null;
}

export async function updateUserLastLogin(id: number) {
  await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, id));
}

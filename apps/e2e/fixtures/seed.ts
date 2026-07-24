import { prisma } from '@cue-room/api/src/db';
import { hashPassword } from '@cue-room/api/src/lib/password';

function assertSafeDatabase() {
  const url = process.env.DATABASE_URL ?? '';
  const looksLocal = /localhost|127\.0\.0\.1/.test(url);
  if (!looksLocal) {
    throw new Error(
      `cleanupAll() refused to run: DATABASE_URL does not look like a local database (${url ? 'value set but not localhost' : 'not set'}). This function deletes all session/expense/customer/rate/creditEntry rows — refusing to risk wiping a non-local database.`
    );
  }
}

export async function seedUser(email: string, password: string, role: 'OWNER' | 'ADMIN' | 'CASHIER') {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, name: role, role },
    update: { passwordHash, role },
  });
}

export async function cleanupAll() {
  assertSafeDatabase();
  await prisma.creditEntry.deleteMany();
  await prisma.session.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.rate.deleteMany();
  await prisma.user.deleteMany({ where: { email: { contains: '@e2e.test' } } });
}

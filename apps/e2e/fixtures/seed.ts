import { prisma } from '@cue-room/api/src/db';
import { hashPassword } from '@cue-room/api/src/lib/password';

export async function seedUser(email: string, password: string, role: 'OWNER' | 'ADMIN' | 'CASHIER') {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, name: role, role },
    update: { passwordHash, role },
  });
}

export async function cleanupAll() {
  await prisma.creditEntry.deleteMany();
  await prisma.session.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.rate.deleteMany();
  await prisma.user.deleteMany({ where: { email: { contains: '@e2e.test' } } });
}

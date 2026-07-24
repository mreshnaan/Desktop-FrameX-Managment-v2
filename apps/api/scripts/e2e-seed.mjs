// Seeds (or resets) a known test user for apps/desktop's e2e suite, plus a
// couple of e2e-scoped fixture rows. Run as a plain node script (not via
// Prisma migrate) so apps/desktop's e2e/global-setup.ts can invoke it as a
// child process without needing its own Prisma/bcrypt dependency -- it
// borrows apps/api's, since this script only ever runs inside apps/api's
// own workspace context (`pnpm --filter @cue-room/api exec node ...`).
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

export const E2E_USERNAME = 'e2e-owner';
export const E2E_PIN = '1234';

async function main() {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'OWNER' } });
  const pinHash = await bcrypt.hash(E2E_PIN, 12);
  await prisma.user.upsert({
    where: { username: E2E_USERNAME },
    create: { username: E2E_USERNAME, pinHash, name: 'E2E Owner', roleId: role.id },
    update: { pinHash, roleId: role.id },
  });
  console.log(`Seeded e2e user "${E2E_USERNAME}"`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

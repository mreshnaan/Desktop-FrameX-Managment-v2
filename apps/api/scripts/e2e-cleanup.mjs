// Removes everything apps/desktop's e2e suite creates -- the seeded user
// plus any category/station/product rows the specs create (all prefixed
// "E2E " so this cleanup can target them precisely without touching real
// data). Run after the suite, win or lose.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const E2E_USERNAME = 'e2e-owner';

async function main() {
  await prisma.user.deleteMany({ where: { username: E2E_USERNAME } });
  await prisma.orderItem.deleteMany({ where: { order: { customerId: null } } });
  const e2eProducts = await prisma.product.findMany({ where: { name: { startsWith: 'E2E ' } } });
  await prisma.stockMovement.deleteMany({ where: { productId: { in: e2eProducts.map((p) => p.id) } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
  await prisma.productCategory.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
  const e2eStations = await prisma.station.findMany({ where: { name: { startsWith: 'E2E ' } } });
  await prisma.session.deleteMany({ where: { stationId: { in: e2eStations.map((s) => s.id) } } });
  await prisma.station.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
  console.log('e2e cleanup complete');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

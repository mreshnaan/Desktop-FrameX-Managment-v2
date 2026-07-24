// Removes everything the desktop and web e2e suites create -- the seeded
// user(s), any user a spec creates through the UI (all usernames prefixed
// "e2e-"), plus any category/station/product/customer rows the specs create
// (all prefixed "E2E " so this cleanup can target them precisely without
// touching real data). Run after each suite, win or lose.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Users before roles: Role.id is FK-RESTRICTed by User.roleId, so a
  // custom role created by the roles spec can't be deleted while the user
  // it was assigned to still exists. RolePermission rows cascade with it.
  await prisma.user.deleteMany({ where: { username: { startsWith: 'e2e-' } } });
  await prisma.role.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
  // customerId on Session/CreditEntry is a plain string column, not a Prisma
  // relation (see schema.prisma) -- filter by id list rather than a nested
  // `customer: {...}` where, which only works through a declared relation.
  const e2eCustomers = await prisma.customer.findMany({ where: { name: { startsWith: 'E2E ' } } });
  const e2eCustomerIds = e2eCustomers.map((c) => c.id);
  await prisma.creditEntry.deleteMany({ where: { customerId: { in: e2eCustomerIds } } });
  await prisma.session.deleteMany({ where: { customerId: { in: e2eCustomerIds } } });
  await prisma.customer.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
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

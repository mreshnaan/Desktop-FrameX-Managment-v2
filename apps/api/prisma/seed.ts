import { PrismaClient } from '@prisma/client';
import { PERMISSION_KEYS, SYSTEM_ROLE_SEED } from '../src/shared/constants/roles';

const prisma = new PrismaClient();

async function seedRolesAndPermissions() {
  const permissionIdByKey = new Map<string, string>();
  for (const p of PERMISSION_KEYS) {
    const row = await prisma.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, label: p.label },
      update: { label: p.label },
    });
    permissionIdByKey.set(p.key, row.id);
  }

  for (const roleSeed of SYSTEM_ROLE_SEED) {
    const role = await prisma.role.upsert({
      where: { name: roleSeed.name },
      create: { name: roleSeed.name, isSystem: true },
      update: { isSystem: true },
    });
    const permissionIds = roleSeed.permissions.map((key) => permissionIdByKey.get(key)!);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
    });
  }

  console.log(`Seeded ${PERMISSION_KEYS.length} permissions and ${SYSTEM_ROLE_SEED.length} system roles.`);
}

interface CategorySeed {
  name: string;
  billingType: 'time' | 'frame';
  stations: string[];
  rate: { hour: number; half: number } | { value: number };
}

// Mirrors apps/web's former hardcoded CATEGORIES/DEFAULT_RATES constants.
// This seed is now the single source of truth for the category/station list --
// apps/web and apps/desktop both pull it from here via sync instead of
// hardcoding it locally.
const SEED_CATEGORIES: CategorySeed[] = [
  {
    name: '8-Ball',
    billingType: 'time',
    stations: ['Table 1', 'Table 2', 'Table 3'],
    rate: { hour: 200, half: 100 },
  },
  {
    name: 'Snooker',
    billingType: 'frame',
    stations: ['Table 1'],
    rate: { value: 150 },
  },
  {
    name: 'PlayStation',
    billingType: 'time',
    stations: ['Station 1', 'Station 2'],
    rate: { hour: 100, half: 50 },
  },
];

async function main() {
  await seedRolesAndPermissions();

  for (const seed of SEED_CATEGORIES) {
    const category = await prisma.category.upsert({
      where: { name: seed.name },
      create: { name: seed.name, billingType: seed.billingType },
      update: { billingType: seed.billingType },
    });

    for (const stationName of seed.stations) {
      const existing = await prisma.station.findFirst({
        where: { categoryId: category.id, name: stationName },
      });
      if (!existing) {
        await prisma.station.create({ data: { categoryId: category.id, name: stationName } });
      }
    }

    const isFrame = 'value' in seed.rate;
    await prisma.rate.upsert({
      where: { categoryId: category.id },
      create: {
        categoryId: category.id,
        hour: isFrame ? null : seed.rate.hour,
        half: isFrame ? null : seed.rate.half,
        value: isFrame ? seed.rate.value : null,
      },
      update: {},
    });
  }

  console.log(`Seeded ${SEED_CATEGORIES.length} categories.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

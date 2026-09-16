import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import { PERMISSIONS, ROLE_PERMISSIONS } from "../src/lib/rbac";

export async function seedPermissions() {
  const permissionKeys = Object.values(PERMISSIONS);
  for (const key of permissionKeys) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }

  console.log(`Seeded ${permissionKeys.length} permissions and ${Object.keys(ROLE_PERMISSIONS).length} known roles.`);
}

async function main() {
  await seedPermissions();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

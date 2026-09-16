import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import { PERMISSIONS } from "../src/lib/rbac";
import { parseSeedAdmin, seedSuperAdmin } from "../src/lib/seed-admin";

async function main() {
  const permissionKeys = Object.values(PERMISSIONS);
  for (const key of permissionKeys) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  console.log(`Seeded ${permissionKeys.length} permissions.`);

  const admin = parseSeedAdmin(process.env);
  if (!admin) {
    console.log("No SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD set; skipping super admin.");
    return;
  }

  const outcome = await seedSuperAdmin(prisma, admin);
  console.log(`Super admin ${admin.email}: ${outcome}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

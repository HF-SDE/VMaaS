import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { PERMISSIONS, PLATFORM_ROLE, ROLE_PERMISSIONS } from "../src/lib/rbac";

async function main() {
  const permissionKeys = Object.values(PERMISSIONS);
  for (const key of permissionKeys) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }

  for (const [roleName, permissionKeysForRole] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, isPlatformRole: roleName === PLATFORM_ROLE },
    });

    for (const permissionKey of permissionKeysForRole) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  console.log(`Seeded ${permissionKeys.length} permissions and ${Object.keys(ROLE_PERMISSIONS).length} roles.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

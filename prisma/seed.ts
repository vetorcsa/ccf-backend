import { PrismaClient, UserRole } from '@prisma/client';
import { hash } from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hash('123456', 10);

  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {
      name: 'Admin',
      passwordHash,
      role: UserRole.ADMIN,
    },
    create: {
      name: 'Admin',
      email: 'admin@example.com',
      passwordHash,
      role: UserRole.ADMIN,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

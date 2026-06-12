import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.log('Usage: node make-admin.js <user-email>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    console.log(`User ${email} not found.`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { role: 'SYSTEM_ADMIN', organizationId: null },
  });

  console.log(`User ${email} is now a SYSTEM_ADMIN.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

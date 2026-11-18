const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  const hash = bcrypt.hashSync('admin123', 10);
  await p.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@enterprise.local',
      passwordHash: hash,
      fullName: 'System Administrator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log('admin seeded');
  await p.$disconnect();
})().catch(e=>{console.error(e);process.exit(1);});

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    const rows = await p.$queryRawUnsafe('SELECT * FROM missions WHERE id = ?', 1);
    console.log('qmark:', rows);
  } catch (e) {
    console.log('qmark error:', e.message);
  }
  try {
    const rows2 = await p.$queryRawUnsafe('SELECT * FROM missions WHERE id = $1', 1);
    console.log('dollar:', rows2);
  } catch (e) {
    console.log('dollar error:', e.message);
  }
  await p.$disconnect();
})().catch(e=>{console.error(e);process.exit(1);});

// reset-farel-admin.js — Reset akun farel ke kredensial awal
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, testConnection } = require('./db');

async function reset() {
  await testConnection();
  const username = 'farel';
  const originalPassword = 'fareladminsitimulyo0001';
  const hash = await bcrypt.hash(originalPassword, 12);

  await query(
    `UPDATE users SET username = ?, password_hash = ? WHERE username IN (?, ?)`,
    [username, hash, 'farel', 'farelrunin']
  );

  console.log('✅ Akun farel telah direset.');
  console.log('   Username:', username);
  console.log('   Password:', originalPassword);
  process.exit(0);
}

reset().catch(e => {
  console.error('❌ Gagal reset akun:', e.message);
  process.exit(1);
});
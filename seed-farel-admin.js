// ════════════════════════════════════════
//  seed-farel-admin.js — Buat akun Superadmin farel
//  Jalankan sekali: node seed-farel-admin.js
// ════════════════════════════════

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, testConnection } = require('./db');

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

async function seed() {
  await testConnection();

  const username = 'farel';
  const password = 'farel123'; // Ganti setelah login pertama!
  const role     = 'Superadmin';

  // Cek apakah sudah ada
  const existing = await query('SELECT id FROM users WHERE username = ?', [username]);
  if (existing.length) {
    console.log(`⚠️  User "${username}" sudah ada. Tidak perlu seed ulang.`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);
  const id   = genId();

  await query(
    'INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)',
    [id, username, hash, role]
  );

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('  ✅ Akun Superadmin berhasil dibuat!');
  console.log('═══════════════════════════════════════');
  console.log(`  Username : ${username}`);
  console.log(`  Password : ${password}`);
  console.log(`  Role     : ${role}`);
  console.log('');
  console.log('  ⚠️  GANTI PASSWORD setelah login pertama!');
  console.log('═══════════════════════════════════════');
  process.exit(0);
}

seed().catch(e => { console.error('❌ Gagal:', e.message); process.exit(1); });
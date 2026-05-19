// create-test-user.js — Buat akun user biasa untuk testing
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, testConnection } = require('../db');

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

async function create() {
  await testConnection();
  const username = 'testuser';
  const password = 'testuser123';
  const role = 'Kader';

  const existing = await query('SELECT id FROM users WHERE username = ?', [username]);
  if (existing.length) {
    console.log(`⚠️ User "${username}" sudah ada.`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);
  const id = genId();

  await query(
    'INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)',
    [id, username, hash, role]
  );

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('  ✅ Akun User Biasa berhasil dibuat!');
  console.log('═══════════════════════════════════════');
  console.log(`  Username : ${username}`);
  console.log(`  Password : ${password}`);
  console.log(`  Role     : ${role}`);
  console.log('');
  console.log('  Gunakan akun ini untuk testing tampilan user biasa.');
  console.log('═══════════════════════════════════════');
  process.exit(0);
}

create().catch(e => {
  console.error('❌ Gagal:', e.message);
  process.exit(1);
});

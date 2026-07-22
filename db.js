// ════════════════════════════════════════
//  db.js — Koneksi MySQL & Query Helpers
// ════════════════════════════════════════
require('dotenv').config();
const mysql = require('mysql2/promise');

// ── Connection Pool ───────────────────────────────────
// Pool lebih efisien dari single connection:
// bisa menangani banyak request sekaligus tanpa antri
const pool = mysql.createPool({
  host     : process.env.DB_HOST     || 'localhost',
  port     : process.env.DB_PORT     || 3306,
  user     : process.env.DB_USER     || 'root',
  password : process.env.DB_PASSWORD || '',
  database : process.env.DB_NAME     || 'pendataan_pemilih',
  waitForConnections: true,
  connectionLimit   : 15,
  queueLimit        : 0,
  charset           : 'utf8mb4',
  // Cegah koneksi mati saat query berat berjalan lama
  connectTimeout    : 60000,
  enableKeepAlive   : true,
  keepAliveInitialDelay: 10000,
});

// ── Test koneksi saat server start ───────────────────
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL terhubung:', process.env.DB_NAME);
    conn.release();
  } catch (err) {
    console.error('❌ Gagal koneksi MySQL:', err.message);
    console.error('   Pastikan .env sudah benar dan MySQL server berjalan.');
    process.exit(1);
  }
}

// ── Query helper ─────────────────────────────────────
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

module.exports = { pool, query, testConnection };

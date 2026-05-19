// ════════════════════════════════════════
//  run-migration.js — Jalankan migration
// ════════════════════════════════════════

const fs = require('fs');
const { pool } = require('../db');

async function runMigration(file) {
  try {
    console.log(`📂 Membaca file migration: ${file}`);
    const sql = fs.readFileSync(file, 'utf8');
    
    const conn = await pool.getConnection();
    console.log('✅ Terhubung ke database');
    
    // Split SQL statements (simple approach - split by ;)
    const statements = sql.split(';').filter(s => s.trim());
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (!stmt) continue;
      
      console.log(`⏳ Menjalankan statement ${i + 1}/${statements.length}...`);
      await conn.query(stmt);
    }
    
    conn.release();
    console.log('✅ Migration berhasil!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

const migrationFile = process.argv[2] || 'migration-v6-rt.sql';
runMigration(migrationFile);

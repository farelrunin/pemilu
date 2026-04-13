require('dotenv').config();
const { query, testConnection } = require('./db');

async function migrate() {
  await testConnection();

  try {
    console.log('Menambah kolom dusun...');
    await query('ALTER TABLE kader ADD COLUMN dusun VARCHAR(100) NOT NULL DEFAULT "" AFTER nomor');

    console.log('Menambah kolom kordus...');
    await query('ALTER TABLE kader ADD COLUMN kordus VARCHAR(100) NOT NULL DEFAULT "" AFTER dusun');

    console.log('Menambah kolom korlap...');
    await query('ALTER TABLE kader ADD COLUMN korlap VARCHAR(100) DEFAULT NULL AFTER kordus');

    console.log('✅ Migration v5 berhasil!');
  } catch (e) {
    if (e.message.includes('Duplicate column name')) {
      console.log('⚠️  Kolom sudah ada, migration dilewati.');
    } else {
      console.error('❌ Error:', e.message);
    }
  }

  process.exit(0);
}

migrate();
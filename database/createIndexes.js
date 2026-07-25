const { query } = require('../db');

async function addDatabaseIndexes() {
  try {
    const indexQueries = [
      'ALTER TABLE pemilih ADD INDEX idx_nama (nama)',
      'ALTER TABLE pemilih ADD INDEX idx_nik (nik)',
      'ALTER TABLE pemilih ADD INDEX idx_kader_id_status (kader_id, status)',
      'ALTER TABLE pemilih ADD INDEX idx_tanggal_lahir (tanggal_lahir)',
      'ALTER TABLE kader ADD INDEX idx_dusun (dusun)',
      'ALTER TABLE kader ADD INDEX idx_nomor (nomor)',
      'ALTER TABLE kader ADD INDEX idx_koordinator_id (koordinator_id)',
      'ALTER TABLE log_duplikat ADD INDEX idx_nik_target (nik_target)',
      'ALTER TABLE hasil_perbandingan ADD INDEX idx_data_tps_id (data_tps_id)',
      'ALTER TABLE hasil_perbandingan ADD INDEX idx_pemilih_id (pemilih_id)',
      'ALTER TABLE hasil_perbandingan ADD INDEX idx_status_cocok (status_cocok)'
    ];

    for (const indexQuery of indexQueries) {
      try {
        await query(indexQuery);
        console.log('✅ Index ditambahkan:', indexQuery.substring(0, 40) + '...');
      } catch (err) {
        if (err.message.includes('Duplicate key name')) {
          // Index sudah ada, skip
        } else {
          console.warn('⚠️ Index gagal:', err.message.substring(0, 60));
        }
      }
    }
  } catch (err) {
    console.error('❌ Gagal menambah indexes:', err.message);
  }
}

module.exports = { addDatabaseIndexes };

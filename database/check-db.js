
require('dotenv').config();
const { query, testConnection } = require('../db');

async function checkKader() {
    try {
        await testConnection();
        console.log('✅ Koneksi DB OK');
        
        const kaders = await query('SELECT id, nama, nomor, koordinator_id FROM kader');
        console.log(`📊 Jumlah Kader di DB: ${kaders.length}`);
        if (kaders.length > 0) {
            console.log('📝 Contoh Data:', kaders[0]);
        }

        const koordinators = await query('SELECT id, nama FROM koordinator');
        console.log(`📊 Jumlah Koordinator di DB: ${koordinators.length}`);
        
        process.exit(0);
    } catch (err) {
        console.error('❌ Gagal cek DB:', err.message);
        process.exit(1);
    }
}

checkKader();

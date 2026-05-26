const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host     : '127.0.0.1',
  port     : process.env.DB_PORT     || 3306,
  user     : process.env.DB_USER     || 'root',
  password : process.env.DB_PASSWORD || '',
  database : process.env.DB_NAME     || 'pendataan_pemilih',
  waitForConnections: true,
  connectionLimit   : 1,
  charset           : 'utf8mb4'
});

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function search() {
  try {
    console.log("=== PENCARIAN DATA DI DATA_TPS ===");
    
    // Cari nama-nama yang mirip dengan pemilih yang tidak cocok
    const namesToSearch = [
      'BEJO SASTRO',
      'NGADIKAN',
      'SUPARDIONO',
      'DJUMARNI',
      'SOFYAN'
    ];

    for (const name of namesToSearch) {
      const results = await query(`
        SELECT id, nama, nama_tps, usia, rt, rw, dusun 
        FROM data_tps 
        WHERE nama LIKE ?
      `, [`%${name}%`]);
      
      console.log(`\nPencarian "%${name}%" di data_tps:`);
      if (results.length === 0) {
        console.log("   (Tidak ditemukan)");
      } else {
        results.forEach(row => {
          console.log(`   - ID: ${row.id} | Nama: "${row.nama}" | TPS: ${row.nama_tps} | Usia: ${row.usia} | RT/RW: ${row.rt}/${row.rw} | Dusun: ${row.dusun}`);
        });
      }
    }

  } catch (err) {
    console.error("Error searching:", err);
  } finally {
    await pool.end();
  }
}

search();

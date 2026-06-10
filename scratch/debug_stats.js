const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host     : process.env.DB_HOST     || 'localhost',
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

async function debug() {
  try {
    const totalDataTps = await query("SELECT COUNT(*) AS c FROM data_tps");
    console.log("Total data_tps:", totalDataTps[0].c);

    const dupCheck = await query(`
      SELECT data_tps_id, COUNT(*) AS c 
      FROM hasil_perbandingan 
      GROUP BY data_tps_id 
      HAVING c > 1
    `);
    console.log("Duplicate data_tps_id in hasil_perbandingan:", dupCheck.length);

    const stats = await query(`
      SELECT 
        CASE 
          WHEN LOWER(TRIM(COALESCE(k.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Alamat Umum (Belum Terinci)'
          ELSE 'Lainnya'
        END AS dusun,
        COUNT(dt.id) AS total_pemilih_tps
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      LEFT JOIN pemilih p ON p.id = hp.pemilih_id
      LEFT JOIN kader k ON k.id = p.kader_id
      GROUP BY 1
    `);
    console.log("Stats output:", stats);

    // Let's see if the join itself is multiplying rows
    const countWithJoins = await query(`
      SELECT COUNT(*) AS c
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      LEFT JOIN pemilih p ON p.id = hp.pemilih_id
      LEFT JOIN kader k ON k.id = p.kader_id
    `);
    console.log("Total rows with joins:", countWithJoins[0].c);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

debug();

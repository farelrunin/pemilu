const { query } = require('../db');

async function test() {
  try {
    const list = await query(`
      SELECT dusun, COUNT(*) AS total
      FROM data_tps
      GROUP BY dusun
      ORDER BY total DESC
    `);
    console.log("data_tps counts grouped by raw dt.dusun:", list);
  } catch (e) {
    console.error(e);
  }
}
test();

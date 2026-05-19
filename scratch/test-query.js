const { query } = require('../db');

async function test() {
  try {
    const data = await query(`
      SELECT 
        CASE 
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Sitimulyo'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari') THEN 'Gondobari-Somokaton'
          ELSE TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun))
        END AS dusun,
        COUNT(dt.id) AS total_pemilih_tps,
        COUNT(CASE WHEN hp.status_cocok = 'COCOK' THEN 1 END) AS cocok,
        COUNT(CASE WHEN hp.status_cocok = 'PERLU_DICEK' THEN 1 END) AS perlu_dicek,
        COUNT(CASE WHEN hp.status_cocok = 'TIDAK_COCOK' OR hp.status_cocok IS NULL THEN 1 END) AS tidak_cocok,
        ROUND(COUNT(CASE WHEN hp.status_cocok = 'COCOK' THEN 1 END) / COUNT(dt.id) * 100, 2) AS persentase_cocok,
        ROUND(COUNT(CASE WHEN hp.status_cocok IN ('COCOK', 'PERLU_DICEK') THEN 1 END) / COUNT(dt.id) * 100, 2) AS persentase_optimal
      FROM data_tps dt
      LEFT JOIN hasil_perbandingan hp ON hp.data_tps_id = dt.id
      LEFT JOIN pemilih p ON p.id = hp.pemilih_id
      LEFT JOIN kader k ON k.id = p.kader_id
      LEFT JOIN (
        SELECT rt, rw, MAX(dusun) AS dusun
        FROM (
          SELECT COALESCE(p_sub.rt, k_sub.rt) AS rt, COALESCE(p_sub.rw, k_sub.rw) AS rw, k_sub.dusun
          FROM pemilih p_sub
          JOIN kader k_sub ON k_sub.id = p_sub.kader_id
          UNION ALL
          SELECT rt, rw, dusun
          FROM kader
        ) AS combined
        WHERE rt IS NOT NULL AND rt <> ''
        GROUP BY rt, rw
      ) AS rt_mapping ON rt_mapping.rt = dt.rt AND rt_mapping.rw = dt.rw
      GROUP BY 
        CASE 
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('', 'sitimulyo') THEN 'Sitimulyo'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan', 'banyakan 1', 'banyakan i') THEN 'Banyakan 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 2', 'banyakan ii', 'gentingsari banyakan ii') THEN 'Banyakan 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('banyakan 3', 'banyakan iii') THEN 'Banyakan 3'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('cepoko', 'cepokojajar', 'cepokosari') THEN 'Cepoko'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('kuden', 'kuden cepin', 'cepin rt 6 kuden') THEN 'Kuden'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang gayam', 'karanggayam', 'k. gayam') THEN 'Karang Gayam'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karang ploso', 'karangploso', 'k. ploso') THEN 'Karang Ploso'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 1', 'pagergunung 1', 'p. gunung 1') THEN 'Pager Gunung 1'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('pager gunung 2', 'pagergunung 2', 'p. gunung 2') THEN 'Pager Gunung 2'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('nglengis', 'ngelengis', 'karangasem nglengis') THEN 'Nglengis'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('karanganom', 'karang anom') THEN 'Karang Anom'
          WHEN LOWER(TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun, ''))) IN ('gondobari somokaton', 'gondobari-somokaton', 'gondobari') THEN 'Gondobari-Somokaton'
          ELSE TRIM(COALESCE(k.dusun, rt_mapping.dusun, dt.dusun))
        END
      ORDER BY persentase_cocok DESC
    `);
    console.log('Success! Count:', data.length);
  } catch (err) {
    console.error('Error running query:', err);
  }
  process.exit(0);
}

test();

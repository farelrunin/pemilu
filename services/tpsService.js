const { query } = require('../db');
const {
  computeNameSimilarity,
  computeAgeSignal,
  computeLocationSignal,
  askGeminiForMatch
} = require('../utils/tpsMatcher');

async function runTPSComparison(namaTps) {
  const dataTps = await query(`
    SELECT id, nama, jenis_kelamin, usia, dusun, alamat, rt, rw FROM data_tps WHERE nama_tps = ?
  `, [namaTps]);

  if (!dataTps.length) {
    const error = new Error('TPS tidak ditemukan');
    error.statusCode = 404;
    throw error;
  }

  const pemilihLokal = await query(`
    SELECT p.id, p.nama, p.jenis_kelamin, 
           COALESCE(p.rt, k.rt) AS rt,
           COALESCE(p.rw, k.rw) AS rw,
           TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS usia,
           k.dusun, k.kordus
    FROM pemilih p
    LEFT JOIN kader k ON k.id = p.kader_id
    WHERE p.id NOT IN (
        SELECT DISTINCT hp.pemilih_id 
        FROM hasil_perbandingan hp
        JOIN data_tps dt ON dt.id = hp.data_tps_id
        WHERE hp.pemilih_id IS NOT NULL 
          AND hp.status_cocok IN ('COCOK', 'PERLU_DICEK')
          AND dt.nama_tps <> ?
      )
  `, [namaTps]);

  const startTime = Date.now();
  let cocok = 0, perluDicek = 0, tidakCocok = 0;

  await query(`
    DELETE hp
    FROM hasil_perbandingan hp
    JOIN data_tps dt ON dt.id = hp.data_tps_id
    WHERE dt.nama_tps = ?
  `, [namaTps]);

  const potentialMatches = [];
  for (const tps of dataTps) {
    for (const pemilih of pemilihLokal) {
      const namaSimilarity = computeNameSimilarity(tps.nama, pemilih.nama);
      const ageSignal = computeAgeSignal(tps.usia, pemilih.usia);
      const locationSignal = computeLocationSignal(tps, pemilih);

      let namaWeight = 0.70;
      let ageWeight = 0.15;
      let locationWeight = 0.15;

      // Jika data usia tidak tersedia di salah satu pihak, distribusikan bobot usia ke nama
      if (tps.usia == null || pemilih.usia == null) {
        namaWeight += ageWeight;
        ageWeight = 0;
      }

      // Jika data lokasi tidak tersedia di salah satu pihak, distribusikan ke nama
      const tpsHasLoc = !!(tps.dusun || tps.alamat || tps.rt);
      const pemilihHasLoc = !!(pemilih.dusun || pemilih.rt);
      if (!tpsHasLoc || !pemilihHasLoc) {
        namaWeight += locationWeight;
        locationWeight = 0;
      }

      let locationScore = locationSignal.dusunScore;
      if (locationSignal.rtScore !== null) {
        locationScore = (locationSignal.dusunScore + locationSignal.rtScore) / 2;
      }

      const totalScore = Math.round(
        (namaSimilarity * namaWeight) +
        (ageSignal * ageWeight) +
        (locationScore * locationWeight)
      );

      if (totalScore >= 50) {
        potentialMatches.push({
          tpsId: tps.id,
          pemilihId: pemilih.id,
          score: totalScore,
          namaSimilarity,
          ageSignal,
          locationSignal
        });
      }
    }
  }

  potentialMatches.sort((a, b) => b.score - a.score);

  const matchedTpsIds = new Set();
  const matchedPemilihIds = new Set();
  const finalMatches = [];

  for (const match of potentialMatches) {
    if (matchedTpsIds.has(match.tpsId) || matchedPemilihIds.has(match.pemilihId)) {
      continue;
    }

    matchedTpsIds.add(match.tpsId);
    matchedPemilihIds.add(match.pemilihId);

    let status = 'PERLU_DICEK';
    let finalScore = match.score;
    let catatan = `Skor: ${match.score}% (nama: ${match.namaSimilarity}%, usia: ${match.ageSignal}%, lokasi: ${Math.round((match.locationSignal.dusunScore + match.locationSignal.rtScore) / 2)}%)`;

    if (match.score >= 85) {
      status = 'COCOK';
      cocok++;
    } else {
      // PANGGIL GEMINI SENYAP JIKA SKOR DI AREA ABU-ABU (60-84) UNTUK MEMUTUSKAN KECOCOKAN
      if (match.score >= 60 && process.env.GEMINI_API_KEY) {
        try {
          const tpsRow = dataTps.find(t => t.id === match.tpsId);
          const pemilihRow = pemilihLokal.find(p => p.id === match.pemilihId);
          if (tpsRow && pemilihRow) {
            const aiDecision = await askGeminiForMatch(tpsRow, pemilihRow);
            if (aiDecision && aiDecision.isMatch && aiDecision.confidence >= 80) {
              status = 'COCOK';
              cocok++;
              finalScore = Math.max(match.score, 85); // Naikkan skor ke cocok
              catatan = `Disetujui AI (${aiDecision.confidence}%): ${aiDecision.reason}`;
            } else {
              perluDicek++;
            }
          } else {
            perluDicek++;
          }
        } catch (e) {
          perluDicek++;
        }
      } else {
        perluDicek++;
      }
    }

    finalMatches.push({
      tpsId: match.tpsId,
      pemilihId: match.pemilihId,
      status,
      score: finalScore,
      namaSimilarity: match.namaSimilarity,
      ageSignal: match.ageSignal,
      locationSignal: match.locationSignal,
      catatan
    });
  }

  for (const tps of dataTps) {
    if (!matchedTpsIds.has(tps.id)) {
      tidakCocok++;
      finalMatches.push({
        tpsId: tps.id,
        pemilihId: null,
        status: 'TIDAK_COCOK',
        score: 0,
        namaSimilarity: 0,
        ageSignal: 0,
        locationSignal: { dusunScore: 0, rtScore: 0 }
      });
    }
  }

  if (finalMatches.length > 0) {
    const values = finalMatches.map(m => [
      m.tpsId,
      m.pemilihId,
      m.status,
      m.score,
      m.catatan || `Skor: ${m.score}% (nama: ${m.namaSimilarity}%, usia: ${m.ageSignal}%, lokasi: ${Math.round(m.locationSignal.rtScore !== null ? (m.locationSignal.dusunScore + m.locationSignal.rtScore) / 2 : m.locationSignal.dusunScore)}%)`
    ]);

    await query(
      `INSERT INTO hasil_perbandingan (data_tps_id, pemilih_id, status_cocok, skor_total, catatan) VALUES ?`,
      [values]
    );
  }

  return {
    durasi_ms: Date.now() - startTime,
    statistik: {
      total_data_tps: dataTps.length,
      total_pemilih: pemilihLokal.length,
      cocok,
      perlu_dicek: perluDicek,
      tidak_cocok: tidakCocok,
      persentase_cocok: dataTps.length ? Math.round((cocok / dataTps.length) * 100) : 0,
      persentase_optimal: dataTps.length ? Math.round(((cocok + perluDicek) / dataTps.length) * 100) : 0
    }
  };
}

async function refreshTPSComparisonIfNeeded(namaTps) {
  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM data_tps WHERE nama_tps = ?`,
    [namaTps]
  );
  const total = Number(countRow?.total || 0);

  if (total === 0) {
    await query(`
      DELETE hp
      FROM hasil_perbandingan hp
      JOIN data_tps dt ON dt.id = hp.data_tps_id
      WHERE dt.nama_tps = ?
    `, [namaTps]);
    return null;
  }

  return runTPSComparison(namaTps);
}

module.exports = {
  runTPSComparison,
  refreshTPSComparisonIfNeeded
};

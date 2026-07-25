const { query } = require('../db');
const {
  computeNameSimilarity,
  computeAgeSignal,
  computeLocationSignal,
  askGeminiForMatch
} = require('../utils/tpsMatcher');

// Chunk array menjadi potongan-potongan kecil
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// Pre-index pemilih berdasarkan huruf pertama nama untuk fast lookup
function buildPemilihIndex(pemilihList) {
  const index = new Map();
  for (const p of pemilihList) {
    const key = (p.nama || '').toLowerCase().charAt(0);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(p);
  }
  return index;
}

// Ambil kandidat pemilih yang relevan berdasarkan huruf pertama nama
// Fallback ke semua pemilih jika tidak ada kandidat cukup
function getCandidates(tpsNama, pemilihIndex, pemilihAll, minCandidates = 50) {
  const key = (tpsNama || '').toLowerCase().charAt(0);
  const byFirstChar = pemilihIndex.get(key) || [];
  if (byFirstChar.length >= minCandidates) return byFirstChar;
  // Jika terlalu sedikit, kembalikan semua (nama pendek/inisial)
  return pemilihAll;
}

async function runTPSComparison(namaTps) {
  const dataTps = await query(
    'SELECT id, nama, jenis_kelamin, usia, dusun, alamat, rt, rw FROM data_tps WHERE nama_tps = ?',
    [namaTps]
  );

  if (!dataTps.length) {
    const error = new Error('TPS tidak ditemukan');
    error.statusCode = 404;
    throw error;
  }

  // Ganti NOT IN (subquery berat) dengan LEFT JOIN + IS NULL
  const pemilihLokal = await query(`
    SELECT p.id, p.nama, p.jenis_kelamin,
           COALESCE(p.rt, k.rt) AS rt,
           COALESCE(p.rw, k.rw) AS rw,
           TIMESTAMPDIFF(YEAR, p.tanggal_lahir, CURDATE()) AS usia,
           k.dusun, k.kordus
    FROM pemilih p
    LEFT JOIN kader k ON k.id = p.kader_id
    LEFT JOIN hasil_perbandingan hp
      ON hp.pemilih_id = p.id
      AND hp.status_cocok IN ('COCOK','PERLU_DICEK')
    LEFT JOIN data_tps dt
      ON dt.id = hp.data_tps_id
      AND dt.nama_tps <> ?
    WHERE dt.id IS NULL
  `, [namaTps]);

  // Buat index pemilih untuk pre-filter cepat
  const pemilihIndex = buildPemilihIndex(pemilihLokal);

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
    // Pre-filter: hanya bandingkan pemilih dengan huruf pertama nama yang sama
    // Ini memangkas 80-90% komparasi yang tidak perlu
    const candidates = getCandidates(tps.nama, pemilihIndex, pemilihLokal);

    // Hitung bobot sekali per TPS record (tidak berubah antar pemilih)
    const tpsHasLoc = !!(tps.dusun || tps.alamat || tps.rt);
    let baseNamaWeight     = 0.70;
    let baseAgeWeight      = 0.15;
    let baseLocationWeight = 0.15;
    if (tps.usia == null) {
      baseNamaWeight += baseAgeWeight;
      baseAgeWeight   = 0;
    }
    if (!tpsHasLoc) {
      baseNamaWeight     += baseLocationWeight;
      baseLocationWeight  = 0;
    }

    for (const pemilih of candidates) {
      // Early exit: jika huruf pertama sangat berbeda, skip Levenshtein
      const tpsFirst  = (tps.nama  || '').toLowerCase().charAt(0);
      const pemFirst  = (pemilih.nama || '').toLowerCase().charAt(0);
      const charDiff  = Math.abs(tpsFirst.charCodeAt(0) - pemFirst.charCodeAt(0));
      if (charDiff > 3) continue; // beda lebih dari 3 huruf alfabet, skip

      const namaSimilarity = computeNameSimilarity(tps.nama, pemilih.nama);
      // Early exit: jika nama similarity sudah sangat rendah, skip sinyal lain
      if (namaSimilarity < 30) continue;

      let namaWeight     = baseNamaWeight;
      let ageWeight      = baseAgeWeight;
      let locationWeight = baseLocationWeight;

      if (pemilih.usia == null && ageWeight > 0) {
        namaWeight += ageWeight;
        ageWeight   = 0;
      }
      const pemilihHasLoc = !!(pemilih.dusun || pemilih.rt);
      if (!pemilihHasLoc && locationWeight > 0) {
        namaWeight     += locationWeight;
        locationWeight  = 0;
      }

      const ageSignal      = ageWeight > 0 ? computeAgeSignal(tps.usia, pemilih.usia) : 0;
      const locationSignal = locationWeight > 0 ? computeLocationSignal(tps, pemilih) : { dusunScore: 0, rtScore: null };

      const locationScore = locationSignal.rtScore !== null
        ? (locationSignal.dusunScore + locationSignal.rtScore) / 2
        : locationSignal.dusunScore;

      const totalScore = Math.round(
        (namaSimilarity * namaWeight) +
        (ageSignal      * ageWeight) +
        (locationScore  * locationWeight)
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
    const allValues = finalMatches.map(m => [
      m.tpsId,
      m.pemilihId,
      m.status,
      m.score,
      m.catatan || `Skor: ${m.score}% (nama: ${m.namaSimilarity}%, usia: ${m.ageSignal}%, lokasi: ${Math.round(m.locationSignal.rtScore !== null ? (m.locationSignal.dusunScore + m.locationSignal.rtScore) / 2 : m.locationSignal.dusunScore)}%)`
    ]);
    // Chunk insert agar tidak timeout saat data banyak
    const CHUNK_SIZE = 200;
    for (const chunk of chunkArray(allValues, CHUNK_SIZE)) {
      await query(
        'INSERT INTO hasil_perbandingan (data_tps_id, pemilih_id, status_cocok, skor_total, catatan) VALUES ?',
        [chunk]
      );
    }
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

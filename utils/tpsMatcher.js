const fetch = global.fetch; // Node 18+ native fetch

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGender(value) {
  const raw = normalizeMatchText(value);
  if (!raw) return null;
  if (['l', 'lk', 'lakilaki', 'laki laki', 'male', 'pria'].includes(raw)) return 'L';
  if (['p', 'pr', 'perempuan', 'female', 'wanita'].includes(raw)) return 'P';
  return null;
}

function normalizeAge(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseInt(String(value).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAreaCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (digits) return String(parseInt(digits, 10));
  return normalizeMatchText(raw);
}

function levenshteinDistance(a = '', b = '', maxDist = Infinity) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  // Early exit: jika perbedaan panjang sudah melebihi maxDist, tidak perlu hitung
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;

  // Gunakan dua baris saja (hemat memori, lebih cepat)
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }

    // Early exit: jika skor minimum baris ini sudah melewati maxDist
    if (rowMin > maxDist) return maxDist + 1;

    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

// Cache normalisasi agar nama yang sama tidak dinormalisasi berulang kali
const _normalizeCache = new Map();
function normalizeMatchTextCached(value) {
  const key = String(value || '');
  if (_normalizeCache.has(key)) return _normalizeCache.get(key);
  const result = normalizeMatchText(key);
  // Batasi cache agar tidak terlalu besar
  if (_normalizeCache.size < 50000) _normalizeCache.set(key, result);
  return result;
}

function computeNameSimilarity(sourceName, candidateName) {
  const source = normalizeMatchTextCached(sourceName);
  const candidate = normalizeMatchTextCached(candidateName);
  if (!source || !candidate) return 0;

  // Exact match setelah strip spasi
  if (source.replace(/\s+/g, '') === candidate.replace(/\s+/g, '')) return 100;

  const sourceWords = source.split(' ').filter(Boolean);
  const candidateWords = candidate.split(' ').filter(Boolean);
  const sourceTokens = new Set(sourceWords);
  const candidateTokens = new Set(candidateWords);

  // Hitung token overlap dulu — ini O(n) dan sangat cepat
  const overlap = [...sourceTokens].filter(t => candidateTokens.has(t)).length;
  const tokenScore = (sourceTokens.size || candidateTokens.size)
    ? overlap / Math.min(sourceTokens.size, candidateTokens.size)
    : 0;

  // Jika token overlap sudah 100%, tidak perlu Levenshtein
  if (tokenScore === 1) return 100;

  const lenDiff = Math.abs(source.length - candidate.length);
  const maxLength = Math.max(source.length, candidate.length, 1);

  // Hitung maxDist yang masih bisa menghasilkan skor ≥ 30% dari Levenshtein
  // (50% Lev + 50% Token). Jika token = 0 dan kita butuh total ≥ 50 (threshold),
  // maka Lev harus ≥ 0 — tetap hitung. Tapi kalau perbedaan panjang sendiri
  // sudah memastikan Lev score < 10%, skip.
  const maxAllowedDist = Math.floor(maxLength * 0.7); // Lev score > 30%
  if (lenDiff > maxAllowedDist && tokenScore === 0) return 0;

  const distance = levenshteinDistance(source, candidate, maxAllowedDist);
  const levScore = Math.max(0, 1 - (distance / maxLength));

  return Math.round(((levScore * 0.5) + (tokenScore * 0.5)) * 100);
}

function computeAgeSignal(tpsAge, pemilihAge) {
  if (tpsAge == null || pemilihAge == null) return 0;
  const diff = Math.abs(Number(tpsAge) - Number(pemilihAge));
  
  if (diff === 0) return 100;
  if (diff <= 1) return 100; 
  if (diff <= 2) return 95;  
  if (diff <= 3) return 85;  
  if (diff <= 5) return 60;  
  return 0;
}

function computeLocationSignal(tpsRow, pemilihRow) {
  const areaSource = normalizeMatchText([tpsRow.dusun, tpsRow.alamat].filter(Boolean).join(' '));
  const areaTarget = normalizeMatchText([pemilihRow.dusun, pemilihRow.kordus].filter(Boolean).join(' '));
  const rtSource = normalizeAreaCode(tpsRow.rt);
  const rtTarget = normalizeAreaCode(pemilihRow.rt);

  let dusunScore = 0;
  if (areaSource && areaTarget) {
    if (areaSource.includes(areaTarget) || areaTarget.includes(areaSource)) {
      dusunScore = 100;
    } else {
      dusunScore = computeNameSimilarity(areaSource, areaTarget);
    }
  }

  let rtScore = null;
  if (rtSource && rtTarget) {
    rtScore = rtSource === rtTarget ? 100 : 0;
  }

  return { dusunScore, rtScore };
}

async function askGeminiForMatch(tpsRow, pemilihRow) {
  if (!process.env.GEMINI_API_KEY) return null;

  try {
    const prompt = `Anda adalah otak AI untuk sistem verifikasi pemilu. Bandingkan kedua data pemilih berikut dan tentukan apakah mereka 95%+ kemungkinan adalah ORANG YANG SAMA.

Data TPS (KPU):
- Nama: ${tpsRow.nama}
- Jenis Kelamin: ${tpsRow.jenis_kelamin || '-'}
- Usia: ${tpsRow.usia || '-'}
- Dusun/Alamat: ${tpsRow.dusun || ''} ${tpsRow.alamat || ''}
- RT/RW: ${tpsRow.rt || '-'}/${tpsRow.rw || '-'}

Data Database Lokal (Target):
- Nama: ${pemilihRow.nama}
- Jenis Kelamin: ${pemilihRow.jenis_kelamin || '-'}
- Usia: ${pemilihRow.usia || '-'}
- Dusun/Alamat: ${pemilihRow.dusun || ''}
- RT/RW: ${pemilihRow.rt || '-'}/${pemilihRow.rw || '-'}

Kembalikan jawaban Anda dalam format JSON (dan HANYA JSON, tanpa backticks markdown \`\`\`) dengan properti berikut:
{
  "isMatch": boolean (true jika kemungkinan besar orang yang sama, false jika berbeda),
  "confidence": number (skor keyakinan 0-100),
  "reason": "alasan singkat dalam Bahasa Indonesia"
}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    const json = await response.json();
    const textResult = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (textResult) {
      return JSON.parse(textResult.trim());
    }
  } catch (err) {
    console.error('Gagal memanggil Gemini API:', err.message);
  }
  return null;
}

function findSpreadsheetColumnIndex(headers = [], aliases = []) {
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeMatchText(headers[i]);
    if (aliases.some(alias => normalizeMatchText(alias) === h)) return i;
  }
  return -1;
}

function getSpreadsheetValue(row = [], aliases = []) {
  return '';
}

function getRawVal(row, index) {
  if (index === undefined || index === -1 || row[index] === undefined) return '';
  return String(row[index]).trim();
}

module.exports = {
  normalizeMatchText,
  normalizeGender,
  normalizeAge,
  normalizeAreaCode,
  levenshteinDistance,
  computeNameSimilarity,
  computeAgeSignal,
  computeLocationSignal,
  askGeminiForMatch,
  findSpreadsheetColumnIndex,
  getSpreadsheetValue,
  getRawVal
};

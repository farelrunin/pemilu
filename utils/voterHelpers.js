const XLSX = require('xlsx');
const { query } = require('../db');

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function hitungUmur(tanggalLahir) {
  if (!tanggalLahir) return null;
  const lahir = new Date(tanggalLahir);
  const now   = new Date();
  let umur    = now.getFullYear() - lahir.getFullYear();
  const m     = now.getMonth() - lahir.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < lahir.getDate())) umur--;
  return umur;
}

function normalizeNIK(value) {
  const digits = String(value ?? '').trim().replace(/\D/g, '');
  return digits || null;
}

function parseNIK(nik) {
  if (!nik || nik.length !== 16) return null;
  let tanggal = parseInt(nik.substring(6, 8));
  const bulan = parseInt(nik.substring(8, 10));
  let tahun   = parseInt(nik.substring(10, 12));

  let jenisKelamin = 'L';
  if (tanggal > 40) {
    jenisKelamin = 'P';
    tanggal -= 40;
  }

  // Tentukan abad: jika tahun >= 0 dan <= 26 (tahun kecil, disesuaikan dengan tahun 2026 saat ini) → 2000-an, sisanya 1900-an
  const currentYear2Digit = new Date().getFullYear() % 100;
  tahun = tahun <= currentYear2Digit ? 2000 + tahun : 1900 + tahun;

  // Validasi bulan & hari basic
  if (bulan < 1 || bulan > 12 || tanggal < 1 || tanggal > 31) return null;

  const tgl = `${tahun}-${String(bulan).padStart(2, '0')}-${String(tanggal).padStart(2, '0')}`;
  
  // Validasi tanggal lebih ketat: pastikan hari valid untuk bulan tertentu
  const dateObj = new Date(tgl);
  if (dateObj.getFullYear() !== tahun || 
      dateObj.getMonth() !== (bulan - 1) || 
      dateObj.getDate() !== tanggal) {
    // Tanggal invalid
    return null;
  }
  
  return { tanggalLahir: tgl, jenisKelamin };
}

function getNIKStatus(nik) {
  if (!/^\d{16}$/.test(nik || '')) return 'NIK_INVALID';
  
  const parsed = parseNIK(nik);
  if (parsed) {
    const age = hitungUmur(parsed.tanggalLahir);
    if (age !== null && age < 17) return 'BELUM_CUKUP_UMUR';
  }
  
  return null;
}

async function cleanupDuplicateLogs(nikList = []) {
  const uniqueNIKs = [...new Set(
    (Array.isArray(nikList) ? nikList : [nikList])
      .map(nik => String(nik || '').trim())
      .filter(Boolean)
  )];

  let sql = `
    DELETE l
    FROM log_duplikat l
    LEFT JOIN pemilih p ON p.nik = l.nik_target
  `;
  const params = [];

  if (uniqueNIKs.length) {
    sql += ` WHERE l.nik_target IN (${uniqueNIKs.map(() => '?').join(', ')}) AND p.id IS NULL`;
    params.push(...uniqueNIKs);
  } else {
    sql += ' WHERE p.id IS NULL';
  }

  return query(sql, params);
}

function normalizeSpreadsheetKey(key) {
  return String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getSpreadsheetValue(row, aliases = []) {
  if (!row || typeof row !== 'object') return '';

  const normalizedEntries = Object.entries(row).map(([key, value]) => [
    normalizeSpreadsheetKey(key),
    value
  ]);

  for (const alias of aliases) {
    const normalizedAlias = normalizeSpreadsheetKey(alias);
    const match = normalizedEntries.find(([key]) => key === normalizedAlias);
    if (match) return match[1];
  }

  return '';
}

function findSpreadsheetColumnIndex(headers = [], aliases = []) {
  const normalizedHeaders = headers.map(normalizeSpreadsheetKey);
  for (const alias of aliases) {
    const normalizedAlias = normalizeSpreadsheetKey(alias);
    const index = normalizedHeaders.findIndex((key) => key === normalizedAlias);
    if (index !== -1) return index;
  }
  return -1;
}

function isDecorativeSpreadsheetRow(row = []) {
  const nonEmpty = row.filter((value) => String(value ?? '').trim() !== '');
  if (!nonEmpty.length) return true;
  return nonEmpty.every((value) => /^\d+$/.test(String(value).trim()));
}

function extractTPSRows(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerRowIndex = matrix.findIndex((row) => {
    const headers = Array.isArray(row) ? row : [];
    const namaIndex = findSpreadsheetColumnIndex(headers, ['nama', 'name']);
    const usiaIndex = findSpreadsheetColumnIndex(headers, ['usia', 'age']);
    return namaIndex !== -1 && usiaIndex !== -1;
  });

  if (headerRowIndex === -1) {
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }

  const headers = matrix[headerRowIndex];
  const columnMap = {
    nama: findSpreadsheetColumnIndex(headers, ['nama', 'name']),
    jenis_kelamin: findSpreadsheetColumnIndex(headers, ['jenis_kelamin', 'jk', 'gender', 'jenis kelamin']),
    usia: findSpreadsheetColumnIndex(headers, ['usia', 'age']),
    dusun: findSpreadsheetColumnIndex(headers, ['dusun', 'hamlet']),
    alamatGabungan: findSpreadsheetColumnIndex(headers, ['dusunalamat', 'dusun alamat']),
    alamat: findSpreadsheetColumnIndex(headers, ['alamat', 'address']),
    rt: findSpreadsheetColumnIndex(headers, ['rt']),
    rw: findSpreadsheetColumnIndex(headers, ['rw'])
  };

  let dataStartIndex = headerRowIndex + 1;
  while (dataStartIndex < matrix.length && isDecorativeSpreadsheetRow(matrix[dataStartIndex])) {
    dataStartIndex++;
  }

  const rows = [];
  for (let i = dataStartIndex; i < matrix.length; i++) {
    const rawRow = Array.isArray(matrix[i]) ? matrix[i] : [];
    const alamatGabungan = columnMap.alamatGabungan !== -1 ? rawRow[columnMap.alamatGabungan] : '';
    const alamat = columnMap.alamat !== -1 ? rawRow[columnMap.alamat] : '';
    const mappedRow = {
      nama: columnMap.nama !== -1 ? rawRow[columnMap.nama] : '',
      jenis_kelamin: columnMap.jenis_kelamin !== -1 ? rawRow[columnMap.jenis_kelamin] : '',
      usia: columnMap.usia !== -1 ? rawRow[columnMap.usia] : '',
      dusun: columnMap.dusun !== -1 ? rawRow[columnMap.dusun] : '',
      alamat: alamat || alamatGabungan || '',
      rt: columnMap.rt !== -1 ? rawRow[columnMap.rt] : '',
      rw: columnMap.rw !== -1 ? rawRow[columnMap.rw] : ''
    };

    const hasAnyValue = Object.values(mappedRow).some((value) => String(value ?? '').trim() !== '');
    if (!hasAnyValue) continue;
    rows.push(mappedRow);
  }

  return rows;
}

module.exports = {
  genId,
  hitungUmur,
  normalizeNIK,
  parseNIK,
  getNIKStatus,
  cleanupDuplicateLogs,
  normalizeSpreadsheetKey,
  getSpreadsheetValue,
  findSpreadsheetColumnIndex,
  isDecorativeSpreadsheetRow,
  extractTPSRows
};

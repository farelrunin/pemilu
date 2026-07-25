// ════════════════════════════════════════
//  routes/pages.js
//  Semua route HTML halaman frontend
// ════════════════════════════════════════
'use strict';

const express = require('express');
const path    = require('path');
const router  = express.Router();

const pub = (file) => (req, res) =>
  res.sendFile(path.join(__dirname, '../public', file));

router.get('/',                pub('index.html'));
router.get('/tambah-pemilih',  pub('tambah-pemilih.html'));
router.get('/tambah-kader',    pub('tambah-kader.html'));
router.get('/kader',           pub('kader.html'));
router.get('/koordinator',     pub('koordinator.html'));
router.get('/edit-pemilih',    pub('edit-pemilih.html'));
router.get('/edit-kader',      pub('edit-kader.html'));
router.get('/view-kader',      pub('view-kader.html'));
router.get('/import',          pub('import.html'));
router.get('/log-duplikat',    pub('log-duplikat.html'));
router.get('/kelola-tps',      pub('kelola-tps.html'));
router.get('/perbandingan-tps',pub('perbandingan-tps.html'));
router.get('/statistik-tps',   pub('statistik-tps.html'));
router.get('/peta-sitimulyo',  pub('peta-sitimulyo.html'));
router.get('/peta-kader',      pub('peta-kader.html'));
router.get('/non-dpt',         pub('non-dpt.html'));
router.get('/laporan-dusun',   pub('laporan-dusun.html'));

module.exports = router;
const express = require('express');
const router = express.Router();
const multer = require('multer');
const pemilihController = require('../controllers/pemilihController');
const { verifyToken, isAdmin } = require('../middleware/auth');

const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/pemilih', verifyToken, pemilihController.getPemilih);
router.get('/pemilih/statistik', verifyToken, pemilihController.getPemilihStats);
router.get('/pemilih/cek-nik/:nik', verifyToken, pemilihController.checkNIK);
router.get('/pemilih/:id', verifyToken, pemilihController.getPemilihById);
router.post('/pemilih', verifyToken, isAdmin, pemilihController.addPemilih);
router.put('/pemilih/:id', verifyToken, isAdmin, pemilihController.updatePemilih);
router.delete('/pemilih/:id', verifyToken, isAdmin, pemilihController.deletePemilih);

// Import Excel Routes
router.post('/pemilih/import/preview', verifyToken, isAdmin, upload.single('file'), pemilihController.importPreview);
router.post('/pemilih/import', verifyToken, isAdmin, upload.single('file'), pemilihController.importSubmit);

// Log Duplikat Routes
router.get('/log-duplikat', verifyToken, isAdmin, pemilihController.getLogDuplikat);
router.get('/log-duplikat/statistik', verifyToken, isAdmin, pemilihController.getLogDuplikatStats);

module.exports = router;

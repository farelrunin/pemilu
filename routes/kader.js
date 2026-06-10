const express = require('express');
const router = express.Router();
const kaderController = require('../controllers/kaderController');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Koordinator Routes
router.get('/koordinator', verifyToken, kaderController.getKoordinator);
router.post('/koordinator', verifyToken, isAdmin, kaderController.addKoordinator);
router.put('/koordinator/:id', verifyToken, isAdmin, kaderController.updateKoordinator);
router.delete('/koordinator/:id', verifyToken, isAdmin, kaderController.deleteKoordinator);

// Kader Routes
router.get('/kader/statistik-dusun', verifyToken, kaderController.getKaderDusunStats);
router.get('/kader', verifyToken, kaderController.getKaders);
router.get('/kader/:id', verifyToken, kaderController.getKaderById);
router.post('/kader', verifyToken, isAdmin, kaderController.addKader);
router.put('/kader/:id', verifyToken, isAdmin, kaderController.updateKader);
router.delete('/kader/:id', verifyToken, isAdmin, kaderController.deleteKader);
router.get('/kader/:id/pemilih', verifyToken, kaderController.getKaderPemilih);
router.get('/kader/:id/aktivitas', verifyToken, kaderController.getKaderActivity);
router.delete('/kader/:id/pemilih/clear', verifyToken, isAdmin, kaderController.clearKaderPemilih);

module.exports = router;

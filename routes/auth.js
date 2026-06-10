const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken, isSuperadmin, isAdmin } = require('../middleware/auth');

router.post('/auth/login', authController.login);
router.get('/auth/me', verifyToken, authController.me);
router.post('/auth/register', verifyToken, isSuperadmin, authController.register);
router.get('/auth/users', verifyToken, isSuperadmin, authController.getUsers);
router.delete('/auth/users/:id', verifyToken, isSuperadmin, authController.deleteUser);

// Admin User Control
router.get('/admin/check', verifyToken, isAdmin, authController.checkAdminStatus);
router.get('/admin/users', verifyToken, isAdmin, authController.getAdminUsers);
router.post('/admin/users', verifyToken, isAdmin, authController.createAdminUser);
router.put('/admin/users/:id', verifyToken, isAdmin, authController.updateAdminUser);
router.delete('/admin/users/:id', verifyToken, isAdmin, authController.deleteAdminUser);
router.get('/admin/login-history', verifyToken, isAdmin, authController.getLoginHistory);
router.get('/admin/import-history', verifyToken, isAdmin, authController.getImportHistory);

module.exports = router;


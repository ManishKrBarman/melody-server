const express = require('express');
const multer = require('multer');
const router = express.Router();
const { register, login, getMe, updateProfile, getUserStats, uploadAvatar, getAvatarUrl } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Multer for avatar uploads
const upload = multer({ dest: 'uploads/' });

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.patch('/profile', protect, updateProfile);
router.get('/stats', protect, getUserStats);
router.post('/avatar', protect, upload.single('avatar'), uploadAvatar);
router.get('/avatar', protect, getAvatarUrl);

module.exports = router;
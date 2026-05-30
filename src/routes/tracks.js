const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { protect } = require('../middleware/auth');
const {
    uploadTrack, getAllTracks, getTrack,
    streamTrack, deleteTrack, searchTracks
} = require('../controllers/tracksController');

// Multer config — save to uploads/ folder temporarily
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, unique + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = ['.mp3', '.flac', '.wav', '.m4a', '.ogg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Only audio files are allowed'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 100 * 1024 * 1024 } // 100 MB max
});

// Routes
router.get('/search', protect, searchTracks);
router.get('/', protect, getAllTracks);
router.get('/:id', protect, getTrack);
router.get('/:id/stream', protect, streamTrack);

router.post('/upload', protect, (req, res, next) => {
    upload.single('audio')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}, uploadTrack);

router.delete('/:id', protect, deleteTrack);

module.exports = router;
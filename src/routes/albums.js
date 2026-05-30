const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getAllAlbums, getAlbum, updateAlbum } = require('../controllers/albumsController');

router.get('/', protect, getAllAlbums);
router.get('/:id', protect, getAlbum);
router.patch('/:id', protect, updateAlbum);

module.exports = router;
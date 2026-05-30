const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getAllArtists, getArtist, updateArtist } = require('../controllers/artistsController');

router.get('/', protect, getAllArtists);
router.get('/:id', protect, getArtist);
router.patch('/:id', protect, updateArtist);

module.exports = router;
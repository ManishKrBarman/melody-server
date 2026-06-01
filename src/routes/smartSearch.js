const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { smartSearch, downloadAndPlay } = require('../controllers/smartSearchController');

router.get('/', protect, smartSearch);
router.post('/download', protect, downloadAndPlay);

module.exports = router;
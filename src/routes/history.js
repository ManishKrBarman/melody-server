const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getHistory, getRecentlyPlayed,
  getMostPlayed, clearHistory
} = require('../controllers/historyController');

router.get('/', protect, getHistory);
router.get('/recent', protect, getRecentlyPlayed);
router.get('/most-played', protect, getMostPlayed);
router.delete('/', protect, clearHistory);

module.exports = router;
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  likeTrack, unlikeTrack,
  getLikedTracks, isTrackLiked
} = require('../controllers/likesController');

router.get('/', protect, getLikedTracks);
router.post('/', protect, likeTrack);
router.get('/:track_id', protect, isTrackLiked);
router.delete('/:track_id', protect, unlikeTrack);

module.exports = router;
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  createPlaylist, getMyPlaylists, getPlaylist,
  addTrackToPlaylist, removeTrackFromPlaylist,
  updatePlaylist, deletePlaylist
} = require('../controllers/playlistsController');

router.get('/', protect, getMyPlaylists);
router.post('/', protect, createPlaylist);
router.get('/:id', protect, getPlaylist);
router.patch('/:id', protect, updatePlaylist);
router.delete('/:id', protect, deletePlaylist);
router.post('/:id/tracks', protect, addTrackToPlaylist);
router.delete('/:id/tracks/:track_id', protect, removeTrackFromPlaylist);

module.exports = router;
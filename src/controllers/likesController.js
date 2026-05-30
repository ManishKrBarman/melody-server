const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');

// LIKE a track
const likeTrack = async (req, res) => {
    try {
        const { track_id } = req.body;
        if (!track_id) return res.status(400).json({ error: 'track_id is required' });

        // Check track exists
        const track = await db.query(
            'SELECT id FROM tracks WHERE id = $1', [track_id]
        );
        if (track.rows.length === 0) {
            return res.status(404).json({ error: 'Track not found' });
        }

        // Check if already liked
        const existing = await db.query(
            'SELECT id FROM liked_tracks WHERE user_id = $1 AND track_id = $2',
            [req.user.id, track_id]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Track already liked' });
        }

        await db.query(
            'INSERT INTO liked_tracks (id, user_id, track_id) VALUES ($1, $2, $3)',
            [uuidv4(), req.user.id, track_id]
        );

        res.status(201).json({ message: 'Track liked' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// UNLIKE a track
const unlikeTrack = async (req, res) => {
    try {
        const { track_id } = req.params;

        await db.query(
            'DELETE FROM liked_tracks WHERE user_id = $1 AND track_id = $2',
            [req.user.id, track_id]
        );

        res.json({ message: 'Track unliked' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// GET all liked tracks
const getLikedTracks = async (req, res) => {
    try {
        const result = await db.query(`
      SELECT 
        t.id, t.title, t.duration, t.cover_url, t.genre,
        a.name AS artist_name, a.id AS artist_id,
        al.title AS album_title, al.id AS album_id,
        lt.liked_at
      FROM liked_tracks lt
      JOIN tracks t ON lt.track_id = t.id
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      WHERE lt.user_id = $1
      ORDER BY lt.liked_at DESC
    `, [req.user.id]);

        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// CHECK if a track is liked
const isTrackLiked = async (req, res) => {
    try {
        const { track_id } = req.params;

        const result = await db.query(
            'SELECT id FROM liked_tracks WHERE user_id = $1 AND track_id = $2',
            [req.user.id, track_id]
        );

        res.json({ liked: result.rows.length > 0 });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { likeTrack, unlikeTrack, getLikedTracks, isTrackLiked };
const db = require('../config/db');
const { getSignedUrl } = require('../utils/storage');

// Helper: convert relative cover_url paths to signed URLs
const signCoverUrls = (rows) => {
    return rows.map(row => {
        if (row.cover_url) {
            row.cover_url = getSignedUrl(row.cover_url);
        }
        return row;
    });
};

// GET play history
const getHistory = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const userId = req.user.id;

    const result = await db.query(`
      SELECT 
        t.id, t.title, t.duration, t.cover_url,
        a.name AS artist_name,
        al.title AS album_title,
        ph.played_at,
        CASE WHEN lt.id IS NOT NULL THEN true ELSE false END AS is_liked
      FROM play_history ph
      JOIN tracks t ON ph.track_id = t.id
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      LEFT JOIN liked_tracks lt ON lt.track_id = t.id AND lt.user_id = $1
      WHERE ph.user_id = $1
      ORDER BY ph.played_at DESC
      LIMIT $2
    `, [userId, limit]);

    res.json(signCoverUrls(result.rows));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET recently played (unique tracks only)
const getRecentlyPlayed = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(`
      SELECT DISTINCT ON (t.id)
        t.id, t.title, t.duration, t.cover_url,
        a.name AS artist_name,
        al.title AS album_title,
        ph.played_at,
        CASE WHEN lt.id IS NOT NULL THEN true ELSE false END AS is_liked
      FROM play_history ph
      JOIN tracks t ON ph.track_id = t.id
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      LEFT JOIN liked_tracks lt ON lt.track_id = t.id AND lt.user_id = $1
      WHERE ph.user_id = $1
      ORDER BY t.id, ph.played_at DESC
      LIMIT 20
    `, [userId]);

    // Sort by most recently played
    const sorted = result.rows.sort(
      (a, b) => new Date(b.played_at) - new Date(a.played_at)
    );

    res.json(signCoverUrls(sorted));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET most played tracks
const getMostPlayed = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(`
      SELECT 
        t.id, t.title, t.duration, t.cover_url,
        a.name AS artist_name,
        al.title AS album_title,
        t.play_count,
        CASE WHEN lt.id IS NOT NULL THEN true ELSE false END AS is_liked
      FROM tracks t
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      LEFT JOIN liked_tracks lt ON lt.track_id = t.id AND lt.user_id = $1
      ORDER BY t.play_count DESC
      LIMIT 20
    `, [userId]);

    res.json(signCoverUrls(result.rows));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// CLEAR history
const clearHistory = async (req, res) => {
  try {
    await db.query(
      'DELETE FROM play_history WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ message: 'History cleared' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getHistory, getRecentlyPlayed, getMostPlayed, clearHistory };
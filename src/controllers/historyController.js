const db = require('../config/db');

// GET play history
const getHistory = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;

    const result = await db.query(`
      SELECT 
        t.id, t.title, t.duration, t.cover_url,
        a.name AS artist_name,
        al.title AS album_title,
        ph.played_at
      FROM play_history ph
      JOIN tracks t ON ph.track_id = t.id
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      WHERE ph.user_id = $1
      ORDER BY ph.played_at DESC
      LIMIT $2
    `, [req.user.id, limit]);

    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET recently played (unique tracks only)
const getRecentlyPlayed = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT DISTINCT ON (t.id)
        t.id, t.title, t.duration, t.cover_url,
        a.name AS artist_name,
        al.title AS album_title,
        ph.played_at
      FROM play_history ph
      JOIN tracks t ON ph.track_id = t.id
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      WHERE ph.user_id = $1
      ORDER BY t.id, ph.played_at DESC
      LIMIT 20
    `, [req.user.id]);

    // Sort by most recently played
    const sorted = result.rows.sort(
      (a, b) => new Date(b.played_at) - new Date(a.played_at)
    );

    res.json(sorted);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET most played tracks
const getMostPlayed = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        t.id, t.title, t.duration, t.cover_url,
        a.name AS artist_name,
        al.title AS album_title,
        t.play_count
      FROM tracks t
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      ORDER BY t.play_count DESC
      LIMIT 20
    `);

    res.json(result.rows);
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
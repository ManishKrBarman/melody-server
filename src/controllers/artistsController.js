const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');

// GET all artists
const getAllArtists = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        a.id, a.name, a.bio, a.image_url, a.created_at,
        COUNT(DISTINCT t.id) AS track_count,
        COUNT(DISTINCT al.id) AS album_count
      FROM artists a
      LEFT JOIN tracks t ON t.artist_id = a.id
      LEFT JOIN albums al ON al.artist_id = a.id
      GROUP BY a.id
      ORDER BY a.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET single artist with their tracks & albums
const getArtist = async (req, res) => {
  try {
    const { id } = req.params;

    const artist = await db.query(
      'SELECT * FROM artists WHERE id = $1', [id]
    );
    if (artist.rows.length === 0) {
      return res.status(404).json({ error: 'Artist not found' });
    }

    const tracks = await db.query(`
      SELECT t.id, t.title, t.duration, t.cover_url, 
             t.genre, t.play_count, al.title AS album_title
      FROM tracks t
      LEFT JOIN albums al ON t.album_id = al.id
      WHERE t.artist_id = $1
      ORDER BY t.play_count DESC
    `, [id]);

    const albums = await db.query(`
      SELECT id, title, cover_url, release_year, genre
      FROM albums WHERE artist_id = $1
      ORDER BY release_year DESC
    `, [id]);

    res.json({
      ...artist.rows[0],
      tracks: tracks.rows,
      albums: albums.rows,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// UPDATE artist (bio, image)
const updateArtist = async (req, res) => {
  try {
    const { id } = req.params;
    const { bio, image_url } = req.body;

    const result = await db.query(`
      UPDATE artists SET
        bio = COALESCE($1, bio),
        image_url = COALESCE($2, image_url)
      WHERE id = $3
      RETURNING *
    `, [bio, image_url, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Artist not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getAllArtists, getArtist, updateArtist };
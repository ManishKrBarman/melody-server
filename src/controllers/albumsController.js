const db = require('../config/db');

// GET all albums
const getAllAlbums = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        al.id, al.title, al.cover_url, al.release_year, al.genre,
        a.name AS artist_name, a.id AS artist_id,
        COUNT(t.id) AS track_count
      FROM albums al
      LEFT JOIN artists a ON al.artist_id = a.id
      LEFT JOIN tracks t ON t.album_id = al.id
      GROUP BY al.id, a.id
      ORDER BY al.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET single album with its tracks
const getAlbum = async (req, res) => {
  try {
    const { id } = req.params;

    const album = await db.query(`
      SELECT al.*, a.name AS artist_name, a.id AS artist_id
      FROM albums al
      LEFT JOIN artists a ON al.artist_id = a.id
      WHERE al.id = $1
    `, [id]);

    if (album.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }

    const tracks = await db.query(`
      SELECT id, title, duration, cover_url, track_number, play_count
      FROM tracks
      WHERE album_id = $1
      ORDER BY track_number ASC NULLS LAST, title ASC
    `, [id]);

    res.json({
      ...album.rows[0],
      tracks: tracks.rows,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// UPDATE album (cover, release year etc)
const updateAlbum = async (req, res) => {
  try {
    const { id } = req.params;
    const { cover_url, release_year, genre } = req.body;

    const result = await db.query(`
      UPDATE albums SET
        cover_url = COALESCE($1, cover_url),
        release_year = COALESCE($2, release_year),
        genre = COALESCE($3, genre)
      WHERE id = $4
      RETURNING *
    `, [cover_url, release_year, genre, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getAllAlbums, getAlbum, updateAlbum };
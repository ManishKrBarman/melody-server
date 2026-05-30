const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');

// CREATE playlist
const createPlaylist = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Playlist name is required' });

    const result = await db.query(`
      INSERT INTO playlists (id, user_id, name, description)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [uuidv4(), req.user.id, name, description || null]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET all playlists for current user
const getMyPlaylists = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        p.id, p.name, p.description, p.cover_url, p.created_at,
        COUNT(pt.id) AS track_count
      FROM playlists p
      LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
      WHERE p.user_id = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [req.user.id]);

    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET single playlist with its tracks
const getPlaylist = async (req, res) => {
  try {
    const { id } = req.params;

    const playlist = await db.query(
      'SELECT * FROM playlists WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (playlist.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    const tracks = await db.query(`
      SELECT 
        t.id, t.title, t.duration, t.cover_url, t.genre,
        a.name AS artist_name,
        al.title AS album_title,
        pt.position, pt.added_at
      FROM playlist_tracks pt
      JOIN tracks t ON pt.track_id = t.id
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      WHERE pt.playlist_id = $1
      ORDER BY pt.position ASC
    `, [id]);

    res.json({
      ...playlist.rows[0],
      tracks: tracks.rows,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// ADD track to playlist
const addTrackToPlaylist = async (req, res) => {
  try {
    const { id } = req.params; // playlist id
    const { track_id } = req.body;

    if (!track_id) return res.status(400).json({ error: 'track_id is required' });

    // Check playlist belongs to user
    const playlist = await db.query(
      'SELECT id FROM playlists WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (playlist.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    // Check track exists
    const track = await db.query(
      'SELECT id FROM tracks WHERE id = $1', [track_id]
    );
    if (track.rows.length === 0) {
      return res.status(404).json({ error: 'Track not found' });
    }

    // Get next position
    const posResult = await db.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM playlist_tracks WHERE playlist_id = $1',
      [id]
    );
    const position = posResult.rows[0].next_pos;

    await db.query(`
      INSERT INTO playlist_tracks (id, playlist_id, track_id, position)
      VALUES ($1, $2, $3, $4)
    `, [uuidv4(), id, track_id, position]);

    res.json({ message: 'Track added to playlist ✅' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// REMOVE track from playlist
const removeTrackFromPlaylist = async (req, res) => {
  try {
    const { id, track_id } = req.params;

    await db.query(`
      DELETE FROM playlist_tracks
      WHERE playlist_id = $1 AND track_id = $2
    `, [id, track_id]);

    res.json({ message: 'Track removed from playlist' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// UPDATE playlist (rename, change cover)
const updatePlaylist = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, cover_url } = req.body;

    const result = await db.query(`
      UPDATE playlists SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        cover_url = COALESCE($3, cover_url)
      WHERE id = $4 AND user_id = $5
      RETURNING *
    `, [name, description, cover_url, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE playlist
const deletePlaylist = async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      'DELETE FROM playlists WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    res.json({ message: 'Playlist deleted' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  createPlaylist, getMyPlaylists, getPlaylist,
  addTrackToPlaylist, removeTrackFromPlaylist,
  updatePlaylist, deletePlaylist
};
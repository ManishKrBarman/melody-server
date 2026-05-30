const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { uploadFile, deleteFile, getSignedUrl } = require('../utils/storage');

// UPLOAD a track
const uploadTrack = async (req, res) => {
    try {
        const { title, artist_name, album_name, genre, track_number, release_year } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ error: 'No audio file provided' });
        if (!title) return res.status(400).json({ error: 'Track title is required' });

        // 1. Handle artist
        let artistId = null;
        if (artist_name) {
            const existingArtist = await db.query(
                'SELECT id FROM artists WHERE LOWER(name) = LOWER($1)',
                [artist_name]
            );
            if (existingArtist.rows.length > 0) {
                artistId = existingArtist.rows[0].id;
            } else {
                const newArtist = await db.query(
                    'INSERT INTO artists (id, name) VALUES ($1, $2) RETURNING id',
                    [uuidv4(), artist_name]
                );
                artistId = newArtist.rows[0].id;
            }
        }

        // 2. Handle album
        let albumId = null;
        if (album_name && artistId) {
            const existingAlbum = await db.query(
                'SELECT id FROM albums WHERE LOWER(title) = LOWER($1) AND artist_id = $2',
                [album_name, artistId]
            );
            if (existingAlbum.rows.length > 0) {
                albumId = existingAlbum.rows[0].id;
            } else {
                const newAlbum = await db.query(
                    `INSERT INTO albums (id, title, artist_id, genre, release_year)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                    [uuidv4(), album_name, artistId, genre || null, release_year || null]
                );
                albumId = newAlbum.rows[0].id;
            }
        }

        // 3. Upload file to Backblaze B2
        const ext = path.extname(file.originalname);
        const remoteFileName = `tracks/${uuidv4()}${ext}`;
        const mimeType = file.mimetype;

        const fileUrl = await uploadFile(file.path, remoteFileName, mimeType);

        // 4. Clean up local temp file
        fs.unlinkSync(file.path);

        // 5. Save track to database
        const result = await db.query(
            `INSERT INTO tracks 
        (id, title, artist_id, album_id, file_url, genre, track_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
            [
                uuidv4(), title, artistId, albumId,
                remoteFileName, genre || null, track_number || null
            ]
        );

        res.status(201).json({
            message: 'Track uploaded successfully',
            track: result.rows[0],
        });

    } catch (err) {
        console.error('Upload error:', err.message);
        // Clean up temp file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
};

// GET all tracks
const getAllTracks = async (req, res) => {
    try {
        const result = await db.query(`
      SELECT 
        t.id, t.title, t.genre, t.duration, t.play_count,
        t.track_number, t.cover_url, t.created_at,
        a.name AS artist_name, a.id AS artist_id,
        al.title AS album_title, al.id AS album_id
      FROM tracks t
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      ORDER BY t.created_at DESC
    `);
        res.json(result.rows);
    } catch (err) {
        console.error('Get tracks error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// GET single track
const getTrack = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(`
      SELECT 
        t.*, 
        a.name AS artist_name,
        al.title AS album_title
      FROM tracks t
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      WHERE t.id = $1
    `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Track not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Get track error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// STREAM a track (generate signed URL)
const streamTrack = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            'SELECT file_url, title FROM tracks WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Track not found' });
        }

        const track = result.rows[0];

        // Generate a 1-hour signed streaming URL
        const signedUrl = getSignedUrl(track.file_url);

        // Increment play count
        await db.query(
            'UPDATE tracks SET play_count = play_count + 1 WHERE id = $1',
            [id]
        );

        // Save to play history
        await db.query(
            'INSERT INTO play_history (id, user_id, track_id) VALUES ($1, $2, $3)',
            [uuidv4(), req.user.id, id]
        );

        res.json({ stream_url: signedUrl });

    } catch (err) {
        console.error('Stream error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// DELETE a track
const deleteTrack = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            'SELECT file_url FROM tracks WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Track not found' });
        }

        // Delete from B2
        await deleteFile(result.rows[0].file_url);

        // Delete from database
        await db.query('DELETE FROM tracks WHERE id = $1', [id]);

        res.json({ message: 'Track deleted successfully' });

    } catch (err) {
        console.error('Delete error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// SEARCH tracks
const searchTracks = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);

        const result = await db.query(`
      SELECT 
        t.id, t.title, t.genre, t.duration, t.cover_url,
        a.name AS artist_name,
        al.title AS album_title
      FROM tracks t
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      WHERE 
        LOWER(t.title) LIKE LOWER($1) OR
        LOWER(a.name) LIKE LOWER($1) OR
        LOWER(al.title) LIKE LOWER($1)
      ORDER BY t.play_count DESC
      LIMIT 20
    `, [`%${q}%`]);

        res.json(result.rows);
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { uploadTrack, getAllTracks, getTrack, streamTrack, deleteTrack, searchTracks };
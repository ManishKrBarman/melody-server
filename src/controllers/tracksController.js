const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { uploadFile, deleteFile, getSignedUrl } = require('../utils/storage');

// Helper: convert relative cover_url paths to signed URLs
const signCoverUrls = (rows) => {
    return rows.map(row => {
        if (row.cover_url) {
            row.cover_url = getSignedUrl(row.cover_url);
        }
        return row;
    });
};

// UPLOAD a track (supports audio + optional cover image)
const uploadTrack = async (req, res) => {
    try {
        const { title, artist_name, album_name, genre, track_number, release_year, duration } = req.body;
        const audioFile = req.files?.audio?.[0] || req.file;
        const coverFile = req.files?.cover?.[0] || null;

        if (!audioFile) return res.status(400).json({ error: 'No audio file provided' });
        if (!title) return res.status(400).json({ error: 'Track title is required' });

        // 1. Handle cover art upload (if provided)
        let coverUrl = null;
        if (coverFile) {
            try {
                const coverExt = path.extname(coverFile.originalname) || '.jpg';
                const remoteCoverName = `covers/${uuidv4()}${coverExt}`;
                await uploadFile(coverFile.path, remoteCoverName, coverFile.mimetype || 'image/jpeg');
                coverUrl = remoteCoverName;
                fs.unlinkSync(coverFile.path);
            } catch (coverErr) {
                console.error('Cover upload failed (non-fatal):', coverErr.message);
                // Clean up cover file if it exists
                if (coverFile.path && fs.existsSync(coverFile.path)) {
                    fs.unlinkSync(coverFile.path);
                }
            }
        }

        // 2. Handle artist
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

        // 3. Handle album
        let albumId = null;
        if (album_name && artistId) {
            const existingAlbum = await db.query(
                'SELECT id FROM albums WHERE LOWER(title) = LOWER($1) AND artist_id = $2',
                [album_name, artistId]
            );
            if (existingAlbum.rows.length > 0) {
                albumId = existingAlbum.rows[0].id;
                // Update album cover if we have one and album doesn't
                if (coverUrl) {
                    await db.query(
                        'UPDATE albums SET cover_url = COALESCE(cover_url, $1) WHERE id = $2',
                        [coverUrl, albumId]
                    );
                }
            } else {
                const newAlbum = await db.query(
                    `INSERT INTO albums (id, title, artist_id, cover_url, genre, release_year)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                    [uuidv4(), album_name, artistId, coverUrl, genre || null, release_year || null]
                );
                albumId = newAlbum.rows[0].id;
            }
        }

        // 4. Upload audio file to Backblaze B2
        const ext = path.extname(audioFile.originalname);
        const remoteFileName = `tracks/${uuidv4()}${ext}`;
        const mimeType = audioFile.mimetype;

        await uploadFile(audioFile.path, remoteFileName, mimeType);

        // 5. Clean up local temp file
        fs.unlinkSync(audioFile.path);

        // 6. Parse duration (from uploader metadata)
        const parsedDuration = duration ? parseInt(duration, 10) : null;

        // 7. Save track to database
        const result = await db.query(
            `INSERT INTO tracks 
        (id, title, artist_id, album_id, file_url, cover_url, genre, track_number, duration)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
            [
                uuidv4(), title, artistId, albumId,
                remoteFileName, coverUrl, genre || null,
                track_number || null, parsedDuration
            ]
        );

        res.status(201).json({
            message: 'Track uploaded successfully',
            track: result.rows[0],
        });

    } catch (err) {
        console.error('Upload error:', err.message);
        // Clean up temp files if they exist
        const audioFile = req.files?.audio?.[0] || req.file;
        if (audioFile && fs.existsSync(audioFile.path)) {
            fs.unlinkSync(audioFile.path);
        }
        const coverFile = req.files?.cover?.[0];
        if (coverFile && fs.existsSync(coverFile.path)) {
            fs.unlinkSync(coverFile.path);
        }
        res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
};

// GET all tracks
const getAllTracks = async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await db.query(`
      SELECT 
        t.id, t.title, t.genre, t.duration, t.play_count,
        t.track_number, t.cover_url, t.created_at,
        a.name AS artist_name, a.id AS artist_id,
        al.title AS album_title, al.id AS album_id,
        CASE WHEN lt.id IS NOT NULL THEN true ELSE false END AS is_liked
      FROM tracks t
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      LEFT JOIN liked_tracks lt ON lt.track_id = t.id AND lt.user_id = $1
      ORDER BY t.created_at DESC
    `, [userId]);
        res.json(signCoverUrls(result.rows));
    } catch (err) {
        console.error('Get tracks error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// GET single track
const getTrack = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const result = await db.query(`
      SELECT 
        t.*, 
        a.name AS artist_name,
        al.title AS album_title,
        CASE WHEN lt.id IS NOT NULL THEN true ELSE false END AS is_liked
      FROM tracks t
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      LEFT JOIN liked_tracks lt ON lt.track_id = t.id AND lt.user_id = $2
      WHERE t.id = $1
    `, [id, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Track not found' });
        }

        const track = result.rows[0];
        if (track.cover_url) {
            track.cover_url = getSignedUrl(track.cover_url);
        }
        res.json(track);
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

        const userId = req.user.id;
        const result = await db.query(`
      SELECT 
        t.id, t.title, t.genre, t.duration, t.cover_url,
        a.name AS artist_name,
        al.title AS album_title,
        CASE WHEN lt.id IS NOT NULL THEN true ELSE false END AS is_liked
      FROM tracks t
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      LEFT JOIN liked_tracks lt ON lt.track_id = t.id AND lt.user_id = $2
      WHERE 
        LOWER(t.title) LIKE LOWER($1) OR
        LOWER(a.name) LIKE LOWER($1) OR
        LOWER(al.title) LIKE LOWER($1)
      ORDER BY t.play_count DESC
      LIMIT 20
    `, [`%${q}%`, userId]);

        res.json(signCoverUrls(result.rows));
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { uploadTrack, getAllTracks, getTrack, streamTrack, deleteTrack, searchTracks };
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db = require('../config/db');
const { uploadFile, getSignedUrl } = require('../utils/storage');

// REGISTER
const register = async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // If user already exists
        const existing = await db.query(
            'SELECT id FROM users WHERE email = $1 OR username = $2',
            [email, username]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email or username already taken' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Insert user
        const result = await db.query(
            `INSERT INTO users (id, username, email, password)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, created_at`,
            [uuidv4(), username, email, hashedPassword]
        );

        const user = result.rows[0];

        // Token generate
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({
            message: 'Account created successfully',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
            }
        });

    } catch (err) {
        console.error('Register error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// LOGIN
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user
        const result = await db.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = result.rows[0];

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Token generate
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar_url: user.avatar_url,
            }
        });

    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// GET CURRENT USER (me)
const getMe = async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, username, email, avatar_url, created_at FROM users WHERE id = $1',
            [req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('GetMe error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// UPDATE PROFILE (username, password)
const updateProfile = async (req, res) => {
    try {
        const { username, current_password, new_password } = req.body;

        // Get current user
        const userResult = await db.query(
            'SELECT * FROM users WHERE id = $1',
            [req.user.id]
        );
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = userResult.rows[0];

        // Handle password change
        if (new_password) {
            if (!current_password) {
                return res.status(400).json({ error: 'Current password is required to change password' });
            }

            const isMatch = await bcrypt.compare(current_password, user.password);
            if (!isMatch) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }

            if (new_password.length < 6) {
                return res.status(400).json({ error: 'New password must be at least 6 characters' });
            }

            const hashedPassword = await bcrypt.hash(new_password, 12);
            await db.query(
                'UPDATE users SET password = $1 WHERE id = $2',
                [hashedPassword, req.user.id]
            );
        }

        // Handle username change
        if (username && username !== user.username) {
            // Check if username is taken
            const existing = await db.query(
                'SELECT id FROM users WHERE username = $1 AND id != $2',
                [username, req.user.id]
            );
            if (existing.rows.length > 0) {
                return res.status(400).json({ error: 'Username already taken' });
            }

            await db.query(
                'UPDATE users SET username = $1 WHERE id = $2',
                [username, req.user.id]
            );
        }

        // Return updated user
        const updated = await db.query(
            'SELECT id, username, email, avatar_url, created_at FROM users WHERE id = $1',
            [req.user.id]
        );

        res.json({
            message: 'Profile updated successfully',
            user: updated.rows[0],
        });

    } catch (err) {
        console.error('UpdateProfile error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// GET USER STATS (personal listening stats)
const getUserStats = async (req, res) => {
    try {
        const userId = req.user.id;

        // Songs listened (unique tracks from play_history)
        const songsListened = await db.query(
            'SELECT COUNT(DISTINCT track_id) AS count FROM play_history WHERE user_id = $1',
            [userId]
        );

        // Liked songs count
        const likedSongs = await db.query(
            'SELECT COUNT(*) AS count FROM liked_tracks WHERE user_id = $1',
            [userId]
        );

        // Unique artists listened (through play_history -> tracks -> artists)
        const artistsListened = await db.query(`
            SELECT COUNT(DISTINCT t.artist_id) AS count
            FROM play_history ph
            JOIN tracks t ON ph.track_id = t.id
            WHERE ph.user_id = $1 AND t.artist_id IS NOT NULL
        `, [userId]);

        // Unique albums listened
        const albumsListened = await db.query(`
            SELECT COUNT(DISTINCT t.album_id) AS count
            FROM play_history ph
            JOIN tracks t ON ph.track_id = t.id
            WHERE ph.user_id = $1 AND t.album_id IS NOT NULL
        `, [userId]);

        // Total listening time (sum of durations of played tracks)
        const listeningTime = await db.query(`
            SELECT COALESCE(SUM(t.duration), 0) AS total_seconds
            FROM play_history ph
            JOIN tracks t ON ph.track_id = t.id
            WHERE ph.user_id = $1
        `, [userId]);

        res.json({
            songs_listened: parseInt(songsListened.rows[0].count) || 0,
            liked_songs: parseInt(likedSongs.rows[0].count) || 0,
            artists_listened: parseInt(artistsListened.rows[0].count) || 0,
            albums_listened: parseInt(albumsListened.rows[0].count) || 0,
            total_listening_seconds: parseInt(listeningTime.rows[0].total_seconds) || 0,
        });

    } catch (err) {
        console.error('GetUserStats error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// UPLOAD AVATAR
const uploadAvatar = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const ext = path.extname(req.file.originalname) || '.jpg';
        const remoteKey = `avatars/${uuidv4()}${ext}`;
        const mimeType = req.file.mimetype || 'image/jpeg';

        // Upload to B2
        await uploadFile(req.file.path, remoteKey, mimeType);

        // Save the key to the database
        await db.query(
            'UPDATE users SET avatar_url = $1 WHERE id = $2',
            [remoteKey, req.user.id]
        );

        // Clean up local temp file
        const fs = require('fs');
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        // Return signed URL
        const signedUrl = getSignedUrl(remoteKey);
        res.json({
            message: 'Avatar uploaded successfully',
            avatar_url: signedUrl,
        });

    } catch (err) {
        console.error('UploadAvatar error:', err.message);
        res.status(500).json({ error: 'Failed to upload avatar' });
    }
};

// GET AVATAR URL (signed)
const getAvatarUrl = async (req, res) => {
    try {
        const result = await db.query(
            'SELECT avatar_url FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0 || !result.rows[0].avatar_url) {
            return res.status(404).json({ error: 'No avatar found' });
        }

        const avatarKey = result.rows[0].avatar_url;
        const signedUrl = avatarKey.startsWith('http')
            ? avatarKey
            : getSignedUrl(avatarKey);

        res.json({ avatar_url: signedUrl });
    } catch (err) {
        console.error('GetAvatarUrl error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { register, login, getMe, updateProfile, getUserStats, uploadAvatar, getAvatarUrl };
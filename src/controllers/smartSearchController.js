const db = require('../config/db');
const { autoDownloadTrack, searchYouTube } = require('../utils/autoDownload');
const { getSignedUrl } = require('../utils/storage');
const { v4: uuidv4 } = require('uuid');

// Smart search — checks DB first, then YouTube
const smartSearch = async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ local: [], youtube: [] });
  }

  try {
    // 1. Search local database first
    const localResult = await db.query(`
      SELECT
        t.id, t.title, t.genre, t.duration, t.cover_url, t.play_count,
        a.name AS artist_name, a.id AS artist_id,
        al.title AS album_title, al.id AS album_id,
        true AS is_local
      FROM tracks t
      LEFT JOIN artists a ON t.artist_id = a.id
      LEFT JOIN albums al ON t.album_id = al.id
      WHERE
        LOWER(t.title) LIKE LOWER($1) OR
        LOWER(a.name) LIKE LOWER($1) OR
        LOWER(al.title) LIKE LOWER($1)
      ORDER BY t.play_count DESC
      LIMIT 10
    `, [`%${q}%`]);

    const localTracks = localResult.rows;

    // 2. Search YouTube for suggestions
    const youtubeSuggestions = await searchYouTube(q);

    res.json({
      local: localTracks,
      youtube: youtubeSuggestions.map(r => ({
        youtube_id: r.id,
        title: r.title,
        artist: r.uploader,
        duration: r.duration,
        thumbnail: `https://img.youtube.com/vi/${r.id}/mqdefault.jpg`,
        is_local: false,
      })),
    });

  } catch (err) {
    console.error('Smart search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
};

// Auto-download a YouTube track and play it
const downloadAndPlay = async (req, res) => {
  const { youtube_id, title, artist } = req.body;

  if (!youtube_id) {
    return res.status(400).json({ error: 'youtube_id is required' });
  }

  try {
    // Check if already downloaded
    const existing = await db.query(
      `SELECT t.*, a.name AS artist_name
       FROM tracks t
       LEFT JOIN artists a ON t.artist_id = a.id
       WHERE t.title ILIKE $1`,
      [title || '']
    );

    if (existing.rows.length > 0) {
      const track = existing.rows[0];
      const streamUrl = getSignedUrl(track.file_url);

      await db.query(
        'UPDATE tracks SET play_count = play_count + 1 WHERE id = $1',
        [track.id]
      );
      await db.query(
        'INSERT INTO play_history (id, user_id, track_id) VALUES ($1, $2, $3)',
        [uuidv4(), req.user.id, track.id]
      );

      return res.json({
        track,
        stream_url: streamUrl,
        from_cache: true,
      });
    }

    // Download from YouTube
    const query = title && artist
        ? `${artist} - ${title}`
        : title || youtube_id;

    const track = await autoDownloadTrack(query);
    const streamUrl = getSignedUrl(track.file_url);

    await db.query(
      'INSERT INTO play_history (id, user_id, track_id) VALUES ($1, $2, $3)',
      [uuidv4(), req.user.id, track.id]
    );

    res.json({
      track,
      stream_url: streamUrl,
      from_cache: false,
    });

  } catch (err) {
    console.error('Download and play error:', err.message);
    res.status(500).json({ error: err.message || 'Download failed' });
  }
};

module.exports = { smartSearch, downloadAndPlay };
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const mm = require('music-metadata');
const { uploadFile } = require('./storage');
const db = require('../config/db');

// Cookies file path — optional but helps bypass bot detection
const COOKIES_PATH = path.join(__dirname, '../../youtube-cookies.txt');
const cookiesFlag = fs.existsSync(COOKIES_PATH)
  ? `--cookies "${COOKIES_PATH}"`
  : '';

// Common yt-dlp flags that bypass bot detection
const BYPASS_FLAGS = [
  '--extractor-args "youtube:player_client=android,web"',
  '--no-check-certificates',
  '--extractor-retries 5',
  '--socket-timeout 30',
  '--user-agent "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36"',
  cookiesFlag,
].filter(Boolean).join(' ');

// Search YouTube for a song
async function searchYouTube(query) {
  try {
    const safeQuery = query.replace(/'/g, '').replace(/"/g, '');
    const cmd = [
      'yt-dlp',
      BYPASS_FLAGS,
      `"ytsearch5:${safeQuery}"`,
      '--print "%(id)s|||%(title)s|||%(duration)s|||%(uploader)s"',
      '--no-playlist',
      '--quiet',
    ].join(' ');

    const { stdout } = await execAsync(cmd, { timeout: 40000 });

    const results = stdout.trim().split('\n')
      .filter(Boolean)
      .map(line => {
        const parts = line.split('|||');
        if (parts.length < 4) return null;
        const [id, title, duration, uploader] = parts;
        return {
          id: id?.trim(),
          title: title?.trim(),
          duration: parseInt(duration) || 0,
          uploader: uploader?.trim(),
        };
      })
      .filter(r => r && r.id && r.duration > 0 && r.duration < 600);

    return results;
  } catch (err) {
    console.error('YouTube search error:', err.message?.split('\n')[0]);
    return [];
  }
}

// Download best match from YouTube
async function downloadFromYouTube(videoId) {
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `melody_${uuidv4()}`);

  try {
    console.log(`  Downloading: https://youtube.com/watch?v=${videoId}`);

    const cmd = [
      'yt-dlp',
      BYPASS_FLAGS,
      `"https://www.youtube.com/watch?v=${videoId}"`,
      '--extract-audio',
      '--audio-format mp3',
      '--audio-quality 0',
      '--embed-thumbnail',
      '--add-metadata',
      `--output "${tempFile}.%(ext)s"`,
      '--no-playlist',
      '--quiet',
    ].join(' ');

    await execAsync(cmd, { timeout: 180000 });

    // Check for mp3 file
    const mp3Path = `${tempFile}.mp3`;
    if (fs.existsSync(mp3Path)) {
      console.log(`  Downloaded successfully`);
      return mp3Path;
    }

    // Sometimes yt-dlp saves with different extension
    const files = fs.readdirSync(tempDir)
      .filter(f => f.startsWith(path.basename(tempFile)))
      .map(f => path.join(tempDir, f));

    if (files.length > 0) {
      console.log(`  Downloaded successfully`);
      return files[0];
    }

    throw new Error('Download failed — file not found after download');

  } catch (err) {
    try { fs.unlinkSync(`${tempFile}.mp3`); } catch { }
    throw err;
  }
}

// Extract metadata from downloaded file
async function extractMetadata(filePath, fallbackTitle, fallbackArtist) {
  try {
    const meta = await mm.parseFile(filePath, { skipCovers: false });
    const tags = meta.common;

    let coverBuffer = null;
    let coverMime = 'image/jpeg';
    if (tags.picture && tags.picture.length > 0) {
      coverBuffer = tags.picture[0].data;
      coverMime = tags.picture[0].format || 'image/jpeg';
    }

    return {
      title: tags.title || fallbackTitle,
      artist: tags.artist || tags.albumartist || fallbackArtist,
      album: tags.album || 'Single',
      genre: tags.genre?.[0] || '',
      duration: Math.floor(meta.format.duration || 0),
      coverBuffer,
      coverMime,
    };
  } catch {
    return {
      title: fallbackTitle,
      artist: fallbackArtist,
      album: 'Single',
      genre: '',
      duration: 0,
      coverBuffer: null,
      coverMime: 'image/jpeg',
    };
  }
}

// Full auto-download pipeline
async function autoDownloadTrack(searchQuery) {
  console.log(`\n Auto-downloading: "${searchQuery}"`);

  // 1. Search YouTube
  const results = await searchYouTube(searchQuery);
  if (results.length === 0) {
    throw new Error('No results found on YouTube — YouTube may be blocking requests. Try again later.');
  }

  const best = results[0];
  console.log(` Best match: ${best.title} (${best.duration}s)`);

  // 2. Download
  const mp3Path = await downloadFromYouTube(best.id);

  try {
    // 3. Extract metadata
    const meta = await extractMetadata(mp3Path, best.title, best.uploader);
    console.log(` Metadata: ${meta.title} — ${meta.artist}`);

    // 4. Handle artist
    let artistId = null;
    const existingArtist = await db.query(
      'SELECT id FROM artists WHERE LOWER(name) = LOWER($1)',
      [meta.artist]
    );
    if (existingArtist.rows.length > 0) {
      artistId = existingArtist.rows[0].id;
    } else {
      const newArtist = await db.query(
        'INSERT INTO artists (id, name) VALUES ($1, $2) RETURNING id',
        [uuidv4(), meta.artist]
      );
      artistId = newArtist.rows[0].id;
    }

    // 5. Handle album
    let albumId = null;
    if (meta.album && artistId) {
      const existingAlbum = await db.query(
        'SELECT id FROM albums WHERE LOWER(title) = LOWER($1) AND artist_id = $2',
        [meta.album, artistId]
      );
      if (existingAlbum.rows.length > 0) {
        albumId = existingAlbum.rows[0].id;
      } else {
        const newAlbum = await db.query(
          'INSERT INTO albums (id, title, artist_id, genre) VALUES ($1, $2, $3, $4) RETURNING id',
          [uuidv4(), meta.album, artistId, meta.genre || null]
        );
        albumId = newAlbum.rows[0].id;
      }
    }

    // 6. Upload audio to B2
    const remoteAudioName = `tracks/${uuidv4()}.mp3`;
    console.log(`  Uploading to storage...`);
    await uploadFile(mp3Path, remoteAudioName, 'audio/mpeg');

    // 7. Upload cover to B2
    let coverUrl = null;
    if (meta.coverBuffer) {
      const remoteCoverName = `covers/${uuidv4()}.jpg`;
      const tempCoverPath = path.join(os.tmpdir(), `cover_${uuidv4()}.jpg`);
      fs.writeFileSync(tempCoverPath, meta.coverBuffer);
      await uploadFile(tempCoverPath, remoteCoverName, meta.coverMime);
      coverUrl = remoteCoverName;
      try { fs.unlinkSync(tempCoverPath); } catch { }
    }

    // 8. Save to database
    const result = await db.query(
      `INSERT INTO tracks
        (id, title, artist_id, album_id, file_url, cover_url, genre, duration)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        uuidv4(), meta.title, artistId, albumId,
        remoteAudioName, coverUrl, meta.genre || null, meta.duration
      ]
    );

    const track = result.rows[0];
    track.artist_name = meta.artist;
    track.album_title = meta.album;

    console.log(` Auto-downloaded and saved: ${meta.title}`);
    return track;

  } finally {
    try { fs.unlinkSync(mp3Path); } catch { }
  }
}

module.exports = { autoDownloadTrack, searchYouTube };
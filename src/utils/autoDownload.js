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

// ─── Cookie Management ───────────────────────────────────────────────
// FIX: was 'youtube-cookies.txt' (hyphen) — actual file is 'youtube_cookies.txt' (underscore)
const COOKIES_PATH = path.join(__dirname, '../../youtube_cookies.txt');

function getCookiesFlag() {
  if (fs.existsSync(COOKIES_PATH)) {
    console.log('  ✓ Cookies file found:', COOKIES_PATH);
    return `--cookies "${COOKIES_PATH}"`;
  }
  console.warn('  ✗ No cookies file at:', COOKIES_PATH);
  return '';
}

function checkCookieFreshness() {
  if (!fs.existsSync(COOKIES_PATH)) return { valid: false, reason: 'File not found' };

  try {
    const stats = fs.statSync(COOKIES_PATH);
    const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
    const content = fs.readFileSync(COOKIES_PATH, 'utf-8');
    const lineCount = content.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;

    if (lineCount < 5) return { valid: false, reason: `Only ${lineCount} cookie lines — file may be incomplete` };
    if (ageHours > 24) return { valid: true, stale: true, reason: `Cookies are ${Math.floor(ageHours)}h old — some may have expired. Re-export recommended.` };
    return { valid: true, stale: false, ageHours: Math.floor(ageHours) };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

// ─── Download Strategies ─────────────────────────────────────────────
// Each strategy uses different player clients and flags to evade detection.
// On failure, the system rotates to the next strategy automatically.
const STRATEGIES = [
  {
    name: 'ios-skip-webpage',
    description: 'iOS client, skip webpage (avoids bot check page entirely)',
    flags: [
      '--extractor-args "youtube:player_client=ios,web;player_skip=webpage"',
      '--no-check-certificates',
      '--user-agent "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)"',
    ],
  },
  {
    name: 'android-mweb',
    description: 'Android + mobile web clients',
    flags: [
      '--extractor-args "youtube:player_client=android,mweb"',
      '--no-check-certificates',
      '--user-agent "com.google.android.youtube/19.29.37 (Linux; U; Android 14; en_US; Pixel 8 Pro Build/UQ1A.240205.002)"',
    ],
  },
  {
    name: 'web-with-po-token',
    description: 'Web client with full JS execution for PO token',
    flags: [
      '--extractor-args "youtube:player_client=web"',
      '--no-check-certificates',
      '--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"',
    ],
  },
];

// Shared flags used by all strategies
const COMMON_FLAGS = [
  '--extractor-retries 3',
  '--socket-timeout 30',
  '--no-warnings',
  '--prefer-insecure',
];

function buildFlags(strategy) {
  const cookiesFlag = getCookiesFlag();
  return [...strategy.flags, ...COMMON_FLAGS, cookiesFlag].filter(Boolean).join(' ');
}

// ─── Retry Helpers ───────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(errorMsg) {
  const retryable = [
    'Sign in to confirm',
    'bot',
    'HTTP Error 403',
    'HTTP Error 429',
    'Video unavailable',
    'nsig',
    'n]',
    'This helps protect our community',
    'confirm you',
  ];
  return retryable.some(pattern => errorMsg.toLowerCase().includes(pattern.toLowerCase()));
}

// ─── Search YouTube ──────────────────────────────────────────────────
async function searchYouTube(query) {
  const safeQuery = query.replace(/'/g, '').replace(/"/g, '');
  let lastError = null;

  for (let i = 0; i < STRATEGIES.length; i++) {
    const strategy = STRATEGIES[i];
    const flags = buildFlags(strategy);

    try {
      console.log(`  Search attempt ${i + 1}/${STRATEGIES.length} [${strategy.name}]`);

      const cmd = [
        'yt-dlp',
        flags,
        `"ytsearch5:${safeQuery}"`,
        '--print "%(id)s|||%(title)s|||%(duration)s|||%(uploader)s"',
        '--no-playlist',
        '--quiet',
      ].join(' ');

      const { stdout } = await execAsync(cmd, { timeout: 45000 });

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

      if (results.length > 0) {
        console.log(`  ✓ Search succeeded with strategy: ${strategy.name} — ${results.length} results`);
        return results;
      }

    } catch (err) {
      lastError = err;
      const errMsg = err.stderr || err.message || '';
      console.error(`  ✗ Strategy [${strategy.name}] failed: ${errMsg.split('\n')[0]}`);

      if (isRetryableError(errMsg) && i < STRATEGIES.length - 1) {
        const delay = (i + 1) * 2000; // 2s, 4s, 6s
        console.log(`  Waiting ${delay / 1000}s before next strategy...`);
        await sleep(delay);
        continue;
      }
    }
  }

  console.error('  ✗ All search strategies exhausted');
  const cookieStatus = checkCookieFreshness();
  if (!cookieStatus.valid || cookieStatus.stale) {
    console.error(`  ⚠ Cookie issue: ${cookieStatus.reason}`);
  }
  return [];
}

// ─── Download from YouTube ───────────────────────────────────────────
async function downloadFromYouTube(videoId) {
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `melody_${uuidv4()}`);
  let lastError = null;

  for (let i = 0; i < STRATEGIES.length; i++) {
    const strategy = STRATEGIES[i];
    const flags = buildFlags(strategy);

    try {
      console.log(`  Download attempt ${i + 1}/${STRATEGIES.length} [${strategy.name}]`);
      console.log(`  URL: https://youtube.com/watch?v=${videoId}`);

      const cmd = [
        'yt-dlp',
        flags,
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
        console.log(`  ✓ Downloaded successfully with strategy: ${strategy.name}`);
        return mp3Path;
      }

      // Sometimes yt-dlp saves with different extension
      const files = fs.readdirSync(tempDir)
        .filter(f => f.startsWith(path.basename(tempFile)))
        .map(f => path.join(tempDir, f));

      if (files.length > 0) {
        console.log(`  ✓ Downloaded successfully with strategy: ${strategy.name}`);
        return files[0];
      }

      throw new Error('Download completed but file not found');

    } catch (err) {
      lastError = err;
      const errMsg = err.stderr || err.message || '';
      console.error(`  ✗ Strategy [${strategy.name}] failed: ${errMsg.split('\n')[0]}`);

      // Clean up partial files from failed attempt
      try { fs.unlinkSync(`${tempFile}.mp3`); } catch { }
      try { fs.unlinkSync(`${tempFile}.webm`); } catch { }
      try { fs.unlinkSync(`${tempFile}.m4a`); } catch { }

      if (isRetryableError(errMsg) && i < STRATEGIES.length - 1) {
        const delay = (i + 1) * 3000; // 3s, 6s, 9s
        console.log(`  Waiting ${delay / 1000}s before next strategy...`);
        await sleep(delay);
        continue;
      }
    }
  }

  // All strategies failed — provide diagnostic info
  const cookieStatus = checkCookieFreshness();
  let diagnosticMsg = 'All download strategies failed.';
  if (!cookieStatus.valid) diagnosticMsg += ` Cookie issue: ${cookieStatus.reason}.`;
  if (cookieStatus.stale) diagnosticMsg += ` ${cookieStatus.reason}.`;
  diagnosticMsg += ' YouTube may be blocking this server IP. Try re-exporting cookies from your browser.';

  throw new Error(diagnosticMsg);
}

// ─── Extract Metadata ────────────────────────────────────────────────
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

// ─── Full Auto-Download Pipeline ─────────────────────────────────────
async function autoDownloadTrack(searchQuery) {
  console.log(`\n🎵 Auto-downloading: "${searchQuery}"`);

  // Log cookie status at start
  const cookieStatus = checkCookieFreshness();
  if (!cookieStatus.valid) {
    console.warn(`  ⚠ Cookie warning: ${cookieStatus.reason}`);
  } else if (cookieStatus.stale) {
    console.warn(`  ⚠ ${cookieStatus.reason}`);
  } else {
    console.log(`  ✓ Cookies OK (${cookieStatus.ageHours}h old)`);
  }

  // 1. Search YouTube
  const results = await searchYouTube(searchQuery);
  if (results.length === 0) {
    throw new Error('No results found on YouTube — YouTube may be blocking requests. Check /api/yt-health for diagnostics.');
  }

  const best = results[0];
  console.log(`  Best match: ${best.title} (${best.duration}s)`);

  // 2. Download
  const mp3Path = await downloadFromYouTube(best.id);

  try {
    // 3. Extract metadata
    const meta = await extractMetadata(mp3Path, best.title, best.uploader);
    console.log(`  Metadata: ${meta.title} — ${meta.artist}`);

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

    console.log(`  ✓ Auto-downloaded and saved: ${meta.title}`);
    return track;

  } finally {
    try { fs.unlinkSync(mp3Path); } catch { }
  }
}

module.exports = { autoDownloadTrack, searchYouTube, checkCookieFreshness };
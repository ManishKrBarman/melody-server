const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');
const { checkCookieFreshness } = require('../utils/autoDownload');

const COOKIES_PATH = path.join(__dirname, '../../youtube_cookies.txt');

/**
 * GET /api/yt-health
 * Diagnostic endpoint — checks all the things that can break YouTube downloads.
 */
const getYtHealth = async (req, res) => {
  const checks = {
    timestamp: new Date().toISOString(),
    overall: 'unknown',
    checks: {},
  };

  // 1. yt-dlp version
  try {
    const { stdout } = await execAsync('yt-dlp --version', { timeout: 10000 });
    checks.checks.ytdlp_version = {
      status: 'ok',
      version: stdout.trim(),
    };
  } catch (err) {
    checks.checks.ytdlp_version = {
      status: 'error',
      error: 'yt-dlp not found or not executable',
      detail: err.message?.split('\n')[0],
      fix: 'Install yt-dlp: pip install -U yt-dlp',
    };
  }

  // 2. Node.js runtime (yt-dlp needs this for PO token generation)
  try {
    const { stdout } = await execAsync('node --version', { timeout: 5000 });
    checks.checks.nodejs_runtime = {
      status: 'ok',
      version: stdout.trim(),
      note: 'yt-dlp can use Node.js for YouTube JS execution',
    };
  } catch {
    checks.checks.nodejs_runtime = {
      status: 'warning',
      error: 'node not found in PATH for yt-dlp subprocess',
      fix: 'Ensure Node.js is in the system PATH (not just nvm). Run: sudo ln -sf $(which node) /usr/local/bin/node',
    };
  }

  // 3. Cookie file
  const cookieExists = fs.existsSync(COOKIES_PATH);
  const cookieStatus = checkCookieFreshness();

  if (!cookieExists) {
    checks.checks.cookies = {
      status: 'error',
      error: 'Cookie file not found',
      path: COOKIES_PATH,
      fix: 'Export cookies from your browser using "Get cookies.txt LOCALLY" extension and place at: ' + COOKIES_PATH,
    };
  } else if (!cookieStatus.valid) {
    checks.checks.cookies = {
      status: 'error',
      error: cookieStatus.reason,
      path: COOKIES_PATH,
      fix: 'Re-export cookies from your browser',
    };
  } else if (cookieStatus.stale) {
    checks.checks.cookies = {
      status: 'warning',
      message: cookieStatus.reason,
      path: COOKIES_PATH,
      fix: 'Re-export fresh cookies from your browser',
    };
  } else {
    checks.checks.cookies = {
      status: 'ok',
      age_hours: cookieStatus.ageHours,
      path: COOKIES_PATH,
    };
  }

  // 4. Check for conflicting nodejs binary (yt-dlp only recognizes 'node', not 'nodejs')
  try {
    const { stdout } = await execAsync('which nodejs 2>/dev/null || where nodejs 2>nul', { timeout: 5000 });
    if (stdout.trim()) {
      checks.checks.nodejs_conflict = {
        status: 'warning',
        message: 'Found "nodejs" binary which yt-dlp ignores. yt-dlp only recognizes "node".',
        path: stdout.trim(),
        fix: 'This is harmless if "node" is also available (checked above). yt-dlp will use "node".',
      };
    }
  } catch {
    // No nodejs binary found — that's fine
  }

  // 5. Quick YouTube connectivity test (just metadata, no download)
  // Use 'web' client — iOS does NOT work when cookies are present
  // Use --flat-playlist to only extract search metadata (no format resolution)
  try {
    const cmd = [
      'yt-dlp',
      '--extractor-args "youtube:player_client=web"',
      '--no-check-certificates',
      '--socket-timeout 15',
      '--no-warnings',
      cookieExists ? `--cookies "${COOKIES_PATH}"` : '',
      '"ytsearch1:test audio"',
      '--flat-playlist',
      '--print "%(id)s"',
      '--no-playlist',
      '--quiet',
    ].filter(Boolean).join(' ');

    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    const videoId = stdout.trim().split('\n')[0];

    if (videoId && videoId.length >= 5) {
      checks.checks.youtube_access = {
        status: 'ok',
        message: 'YouTube search works',
        test_video_id: videoId,
      };
    } else {
      checks.checks.youtube_access = {
        status: 'warning',
        message: 'YouTube returned empty results',
      };
    }
  } catch (err) {
    const errMsg = err.stderr || err.message || '';
    const isBotBlock = errMsg.toLowerCase().includes('sign in') || errMsg.toLowerCase().includes('bot');
    const isPlayerResponse = errMsg.toLowerCase().includes('failed to extract any player response');

    checks.checks.youtube_access = {
      status: 'error',
      error: isBotBlock
        ? 'YouTube is blocking this server (bot detection)'
        : isPlayerResponse
          ? 'yt-dlp cannot extract player response — likely outdated version'
          : 'YouTube search failed',
      detail: errMsg.split('\n').filter(l => l.trim()).slice(0, 3).join(' | '),
      fix: isBotBlock
        ? 'Upload fresh cookies from your browser. If still failing, the server IP may be permanently flagged.'
        : isPlayerResponse
          ? 'Update yt-dlp: sudo pip install -U yt-dlp (or: yt-dlp -U)'
          : 'Check yt-dlp version and network connectivity',
    };
  }

  // 5. Determine overall status
  const statuses = Object.values(checks.checks).map(c => c.status);
  if (statuses.includes('error')) {
    checks.overall = 'unhealthy';
  } else if (statuses.includes('warning')) {
    checks.overall = 'degraded';
  } else {
    checks.overall = 'healthy';
  }

  const httpStatus = checks.overall === 'healthy' ? 200 : checks.overall === 'degraded' ? 200 : 503;
  res.status(httpStatus).json(checks);
};

module.exports = { getYtHealth };

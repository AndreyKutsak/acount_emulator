const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Where "what did the platform actually show us" evidence is kept for failed/blocked
// login attempts, so a human can look at the real page instead of guessing from a
// generic error message. Served statically at /uploads (see app.js).
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'auth-debug');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Called right after a login attempt fails, while the page is still open (before the
// session/browser is closed) — captures a screenshot plus the URL/title the platform
// actually left us on, e.g. a checkpoint or "suspicious activity" interstitial rather
// than a plain wrong-password page.
async function captureAuthDebug(page) {
  if (!page || page.isClosed()) return null;

  const fileName = `${crypto.randomUUID()}.png`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  try {
    await page.screenshot({ path: filePath, fullPage: true, timeout: 5000 });
  } catch {
    return null;
  }

  return {
    screenshotUrl: `/uploads/auth-debug/${fileName}`,
    pageUrl: page.url(),
    pageTitle: await page.title().catch(() => ''),
    capturedAt: new Date(),
  };
}

module.exports = { captureAuthDebug };

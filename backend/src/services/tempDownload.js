const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function extensionFromContentType(contentType) {
  if (!contentType) return '.jpg';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  return '.jpg';
}

async function downloadToTempFile(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status}): ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = extensionFromContentType(response.headers.get('content-type'));
  const filePath = path.join(os.tmpdir(), `treds-${crypto.randomUUID()}${ext}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function downloadAllToTempFiles(urls) {
  const paths = await Promise.all(urls.map(downloadToTempFile));
  return paths;
}

function cleanupTempFiles(paths) {
  for (const p of paths) {
    fs.unlink(p, () => {});
  }
}

module.exports = { downloadAllToTempFiles, cleanupTempFiles };

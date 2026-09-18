const PLATFORM_SELECTORS = {
  instagram: {
    likes: 'section span[class*="html-span"]',
    comments: 'ul li span[class*="html-span"]',
  },
  youtube: {
    views: 'span.view-count, #info-strings yt-formatted-string',
    likes: 'button[aria-label*="like this video"] #text',
    comments: '#count .count-text',
  },
};

function parseCount(rawText) {
  if (!rawText) return null;
  const text = rawText.replace(/,/g, '').trim().toLowerCase();
  const match = text.match(/^([\d.]+)\s*(k|m|b)?/i);
  if (!match) return null;
  let value = parseFloat(match[1]);
  const suffix = match[2];
  if (suffix === 'k') value *= 1_000;
  else if (suffix === 'm') value *= 1_000_000;
  else if (suffix === 'b') value *= 1_000_000_000;
  return Math.round(value);
}

async function readFirstMatch(page, selector) {
  if (!selector) return null;
  const text = await page
    .locator(selector)
    .first()
    .innerText({ timeout: 5000 })
    .catch(() => null);
  return parseCount(text);
}

// Threads has no CSS class names worth relying on, but every reaction icon is an
// <svg aria-label="Like"|"Comment"|"Repost">, and the count sits as text inside the
// closest [role="button"] ancestor (confirmed live against a public post, 2026-09-12).
// Threads does not expose a public view count on a post (only the author sees that,
// via Insights), so "views" is intentionally left unset for this platform.
async function extractThreadsMetrics(page) {
  const raw = await page
    .evaluate(() => {
      function countNear(label) {
        const svg = document.querySelector(`svg[aria-label="${label}"]`);
        if (!svg) return null;
        const el = svg.closest('[role="button"]') || svg.parentElement;
        return el ? el.innerText : null;
      }
      return {
        likes: countNear('Like'),
        comments: countNear('Comment'),
      };
    })
    .catch(() => ({ likes: null, comments: null }));

  return {
    likes: parseCount(raw.likes) ?? undefined,
    comments: parseCount(raw.comments) ?? undefined,
    views: undefined,
  };
}

const CUSTOM_EXTRACTORS = {
  threads: extractThreadsMetrics,
};

async function extractMetrics(page, platform, customSelectors = {}) {
  if (CUSTOM_EXTRACTORS[platform] && Object.keys(customSelectors).length === 0) {
    return CUSTOM_EXTRACTORS[platform](page);
  }

  const selectors = { ...(PLATFORM_SELECTORS[platform] || {}), ...customSelectors };

  const [views, likes, comments] = await Promise.all([
    readFirstMatch(page, selectors.views),
    readFirstMatch(page, selectors.likes),
    readFirstMatch(page, selectors.comments),
  ]);

  return {
    views: views ?? undefined,
    likes: likes ?? undefined,
    comments: comments ?? undefined,
  };
}

module.exports = { extractMetrics, parseCount };

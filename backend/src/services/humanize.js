// Shared "act like a person, not a script" helpers. Algorithms flag automation by
// rhythm as much as by action: dead-even intervals between requests, and instant
// likes/comments/replies, are red flags independent of what was clicked. These
// helpers add randomized pacing and let an account "rest" for a randomized
// stretch after it's used, so activity doesn't line up into a clean pattern.

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_COOLDOWN_MIN_MINUTES =
  Number(process.env.ACCOUNT_COOLDOWN_MIN_MINUTES) || 25;
const DEFAULT_COOLDOWN_MAX_MINUTES =
  Number(process.env.ACCOUNT_COOLDOWN_MAX_MINUTES) || 70;

// Picks a random point in the future rather than "now + fixed interval" — identical gaps
// between an account's automated actions are as much a tell as no gap at all.
function scheduleRest(
  minMinutes = DEFAULT_COOLDOWN_MIN_MINUTES,
  maxMinutes = DEFAULT_COOLDOWN_MAX_MINUTES,
) {
  const minutes = randomInt(minMinutes, maxMinutes);
  return new Date(Date.now() + minutes * 60_000);
}

function isResting(account) {
  return Boolean(
    account?.restUntil && new Date(account.restUntil).getTime() > Date.now(),
  );
}

// --- Mouse / typing / scrolling (human-like micro-behavior) ---
// Uses ghost-cursor (if installed) for curved mouse movement, with a safe fallback
// to Playwright's own click when the library is missing or fails — so login flows
// never break just because the optional dependency changed.

function humanCursor(page) {
  try {
    // eslint-disable-next-line global-require
    const { createCursor } = require("ghost-cursor");
    return createCursor(page);
  } catch {
    return null;
  }
}

async function humanMoveTo(page, selector) {
  const cursor = humanCursor(page);
  if (cursor) {
    try {
      await cursor.move(selector, { paddingPercentage: 15 });
      return;
    } catch {
      // fall through to a plain click
    }
  }
}

// Move the mouse to the element with a human path, then click via Playwright
// (reliable actionability wait) — the movement is the human part, the click stays safe.
async function humanClick(page, selector) {
  await humanMoveTo(page, selector);
  await page.locator(selector).first().click();
}

// Click into the field, then type character-by-character with varied delays.
async function humanType(page, selector, text) {
  await humanMoveTo(page, selector);
  await page.locator(selector).first().click();
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(randomInt(30, 120));
  }
}

// A few organic scrolls before/after an action — instant, zero-movement pages are
// a classic automation tell, so this adds the small "browsing" motions a person makes.
async function randomScroll(
  page,
  { minScrolls = 2, maxScrolls = 5, maxDelta = 600 } = {},
) {
  const scrolls = randomInt(minScrolls, maxScrolls);
  for (let i = 0; i < scrolls; i++) {
    await page.mouse.wheel(0, randomInt(200, maxDelta));
    await sleep(randomInt(400, 1600));
  }
  if (Math.random() < 0.4) {
    await page.mouse.wheel(0, -randomInt(100, 300));
    await sleep(randomInt(300, 900));
  }
}

module.exports = {
  randomInt,
  sleep,
  scheduleRest,
  isResting,
  humanClick,
  humanType,
  randomScroll,
};

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

const DEFAULT_COOLDOWN_MIN_MINUTES = Number(process.env.ACCOUNT_COOLDOWN_MIN_MINUTES) || 25;
const DEFAULT_COOLDOWN_MAX_MINUTES = Number(process.env.ACCOUNT_COOLDOWN_MAX_MINUTES) || 70;

// Picks a random point in the future rather than "now + fixed interval" — identical gaps
// between an account's automated actions are as much a tell as no gap at all.
function scheduleRest(minMinutes = DEFAULT_COOLDOWN_MIN_MINUTES, maxMinutes = DEFAULT_COOLDOWN_MAX_MINUTES) {
  const minutes = randomInt(minMinutes, maxMinutes);
  return new Date(Date.now() + minutes * 60_000);
}

function isResting(account) {
  return Boolean(account?.restUntil && new Date(account.restUntil).getTime() > Date.now());
}

module.exports = {
  randomInt,
  sleep,
  scheduleRest,
  isResting,
};

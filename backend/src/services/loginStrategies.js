const { humanType, humanClick, randomScroll } = require("./humanize");

const DEFAULT_STRATEGY = {
  loginUrl: null,
  usernameSelector:
    'input[name="username"], input[name="email"], input[type="email"]',
  passwordSelector: 'input[name="password"], input[type="password"]',
  submitSelector: 'button[type="submit"]',
};

const PLATFORM_STRATEGIES = {
  instagram: {
    loginUrl: "https://www.instagram.com/accounts/login/",
    usernameSelector: 'input[name="username"]',
    passwordSelector: 'input[name="password"]',
    submitSelector: 'button[type="submit"]',
  },
  threads: {
    // Threads shares Meta's login stack with Instagram; confirmed live against
    // threads.com/login (no real credentials used) on 2026-09-12.
    loginUrl: "https://www.threads.com/login",
    usernameSelector:
      'input[autocomplete="username"], input[name="username"], input[placeholder*="Username"], input[placeholder*="username"], input[aria-label*="Username"], input[type="text"]',
    passwordSelector: 'input[type="password"]',
    submitSelector: 'input[type="submit"], button:has-text("Log in")',
  },
  facebook: {
    loginUrl: "https://www.facebook.com/login",
    usernameSelector: 'input[name="email"]',
    passwordSelector: 'input[name="pass"]',
    submitSelector: 'button[name="login"]',
  },
  twitter: {
    loginUrl: "https://twitter.com/i/flow/login",
    usernameSelector: 'input[autocomplete="username"]',
    passwordSelector: 'input[name="password"]',
    submitSelector: 'button[data-testid="LoginForm_Login_Button"]',
  },
  tiktok: {
    loginUrl: "https://www.tiktok.com/login/phone-or-email/email",
    usernameSelector: 'input[name="username"]',
    passwordSelector: 'input[type="password"]',
    submitSelector: 'button[type="submit"]',
  },
  youtube: {
    loginUrl: "https://accounts.google.com/ServiceLogin?service=youtube",
    usernameSelector: 'input[type="email"]',
    passwordSelector: 'input[type="password"]',
    submitSelector: "#passwordNext button, #identifierNext button",
  },
};

function getStrategy(platform) {
  return PLATFORM_STRATEGIES[platform] || DEFAULT_STRATEGY;
}

async function login(
  page,
  { platform, username, password, loginUrl, timeoutMs = 30000 },
) {
  const strategy = getStrategy(platform);
  const targetUrl = loginUrl || strategy.loginUrl;
  if (!targetUrl) {
    throw new Error(
      `No login URL known for platform "${platform}" — pass loginUrl explicitly`,
    );
  }

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });
  await page
    .waitForSelector(strategy.usernameSelector, { timeout: timeoutMs })
    .catch(() => {});
  await humanType(page, strategy.usernameSelector, username);
  await randomScroll(page, { minScrolls: 1, maxScrolls: 2, maxDelta: 300 });

  // Some flows (Google, Twitter) require pressing "Next" before the password field appears.
  const passwordVisible = await page
    .locator(strategy.passwordSelector)
    .first()
    .isVisible()
    .catch(() => false);
  if (!passwordVisible) {
    await page.keyboard.press("Enter").catch(() => {});
    await page
      .waitForSelector(strategy.passwordSelector, { timeout: timeoutMs })
      .catch(() => {});
  }

  await humanType(page, strategy.passwordSelector, password);
  await humanClick(page, strategy.submitSelector).catch(async () => {
    await page.keyboard.press("Enter");
  });

  await page
    .waitForLoadState("networkidle", { timeout: timeoutMs })
    .catch(() => {});

  // The submit step above only checks that the form was filled and clicked — it does not
  // throw if the platform silently refuses the session (wrong password with no visible error,
  // or an automation-triggered soft rate limit/checkpoint). Both look identical to "nothing
  // threw", so verify we actually left the login page before calling this a success.
  const stillOnLoginPage = page.url().toLowerCase().includes("login");
  if (stillOnLoginPage) {
    const err = new Error(
      "Still on the login page after submitting credentials — this usually means either the " +
        "password is wrong, or (more likely after repeated automated attempts in a short time) " +
        "the platform has quietly soft-blocked automated sessions for this account.",
    );
    err.code = "LOGIN_NOT_CONFIRMED";
    throw err;
  }
}

module.exports = { getStrategy, login };

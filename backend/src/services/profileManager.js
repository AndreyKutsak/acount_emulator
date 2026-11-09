// Consistent, deterministic browser fingerprint profiles.
//
// One account = one profile forever. A stable identity is itself a stealth signal:
// freshly randomized fingerprints on every session look more suspicious than a
// fixed, internally-consistent one. Values are fixed per profile, never randomized.
//
// Note: WebGL renderer and font list come from the real browser/GPU and cannot be
// fully overridden from JavaScript — they are recorded here for documentation and
// future consistency checks, not injected.

const PROFILES = {
  windows_chrome: {
    label: "Windows 10 — Chrome",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    screen: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    locale: "uk-UA",
    timezoneId: "Europe/Kyiv",
    platform: "Win32",
    hardwareConcurrency: 8,
    maxTouchPoints: 0,
    webglRenderer:
      "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  macos_safari: {
    label: "macOS — Safari",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    viewport: { width: 1440, height: 900 },
    screen: { width: 1728, height: 1117 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    locale: "uk-UA",
    timezoneId: "Europe/Kyiv",
    platform: "MacIntel",
    hardwareConcurrency: 10,
    maxTouchPoints: 0,
    webglRenderer: "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)",
  },
  iphone_13: {
    label: "iPhone 13 — Safari",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "uk-UA",
    timezoneId: "Europe/Kyiv",
    platform: "iPhone",
    hardwareConcurrency: 6,
    maxTouchPoints: 5,
    webglRenderer: "Apple GPU",
  },
  android_samsung_s23: {
    label: "Samsung Galaxy S23 — Chrome",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    viewport: { width: 384, height: 832 },
    screen: { width: 384, height: 832 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    locale: "uk-UA",
    timezoneId: "Europe/Kyiv",
    platform: "Linux armv8l",
    hardwareConcurrency: 8,
    maxTouchPoints: 5,
    webglRenderer: "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)",
  },
};

const DEFAULT_PROFILE_ID = "windows_chrome";

function getProfile(profileId) {
  return PROFILES[profileId] || PROFILES[DEFAULT_PROFILE_ID];
}

// Playwright context options derived from a profile.
function contextOptions(profileId) {
  const p = getProfile(profileId);
  return {
    userAgent: p.userAgent,
    viewport: p.viewport,
    screen: p.screen,
    deviceScaleFactor: p.deviceScaleFactor,
    isMobile: p.isMobile,
    hasTouch: p.hasTouch,
    locale: p.locale,
    timezoneId: p.timezoneId,
    colorScheme: "light",
  };
}

// Extra init script: patches the few navigator fields Playwright cannot set through
// context options (platform, hardwareConcurrency, maxTouchPoints).
function profileInitScript(profileId) {
  const p = getProfile(profileId);
  return `(() => {
    try { Object.defineProperty(navigator, 'platform', { get: () => ${JSON.stringify(p.platform)} }); } catch (e) {}
    try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${p.hardwareConcurrency} }); } catch (e) {}
    try { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => ${p.maxTouchPoints} }); } catch (e) {}
  })();`;
}

module.exports = {
  PROFILES,
  DEFAULT_PROFILE_ID,
  getProfile,
  contextOptions,
  profileInitScript,
};

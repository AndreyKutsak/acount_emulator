const mongoose = require('mongoose');

const socialAccountSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ['instagram', 'facebook', 'tiktok', 'twitter', 'youtube', 'threads', 'other'],
      default: 'other',
    },
    displayName: { type: String, default: '' },
    username: { type: String, required: true, trim: true },
    passwordEncrypted: { type: String, required: true },
    vpnServer: { type: mongoose.Schema.Types.ObjectId, ref: 'VpnServer', default: null },
    notes: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    // Stable fingerprint profile id (see services/profileManager.js). One account
    // keeps one profile forever — consistent fingerprint instead of a fresh random
    // one per session.
    profileId: { type: String, default: 'windows_chrome' },
    // Optional per-account proxy override. May contain credentials, so it is
    // stripped from every client-facing response (toSafeAccount).
    proxyConfig: { type: mongoose.Schema.Types.Mixed, default: null },
    authStatus: {
      type: String,
      enum: ['unknown', 'authorized', 'failed', 'blocked'],
      default: 'unknown',
    },
    authCheckedAt: { type: Date, default: null },
    authError: { type: String, default: '' },
    // Screenshot + page state captured at the moment a login attempt failed/was blocked,
    // so the actual response from the platform (checkpoint page, captcha, etc.) can be
    // inspected instead of relying on the generic error message alone.
    authDebug: {
      screenshotUrl: { type: String, default: '' },
      pageUrl: { type: String, default: '' },
      pageTitle: { type: String, default: '' },
      capturedAt: { type: Date, default: null },
    },
    // Anti-detection cooldown: while in the future, automation (comment fetch/reply, and
    // anything else that logs in as this account) refuses to run, so the account gets a
    // real rest between automated actions instead of being hit at machine cadence.
    restUntil: { type: Date, default: null },
    // Encrypted Playwright storage state (cookies/localStorage) for threads accounts,
    // harvested by services/threadsMcpService.js after a login via the MCP browser.
    // Reusing this avoids driving the login form on every automation run. Never sent
    // to the client (stripped by toSafeAccount in socialAccountController.js/automationController.js).
    threadsSessionEncrypted: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SocialAccount', socialAccountSchema);

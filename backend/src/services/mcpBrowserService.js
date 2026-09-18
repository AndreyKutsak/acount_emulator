const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const stealth = require('./stealth');
const profileManager = require('./profileManager');
const proxyManager = require('./proxyManager');

// The Playwright MCP server is spawned as a child process per session and driven
// over stdio JSON-RPC via the MCP SDK client — this is the "MCP" transport that
// replaces threads-bot's direct private-API calls. Every action becomes a tool
// call (browser_navigate, browser_click, browser_type, …) instead of a page.*()
// call, but it's the same official, non-anti-detect Playwright/Chromium underneath.
const CLI_PATH = path.dirname(require.resolve('@playwright/mcp/package.json')) + '/cli.js';

const SESSION_STATE_DIR = path.join(__dirname, '..', '..', 'storage', 'mcp-sessions');
const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'screenshots');
const PROFILES_DIR = path.join(__dirname, '..', '..', process.env.PROFILES_DIR || 'profiles');
fs.mkdirSync(SESSION_STATE_DIR, { recursive: true });

const sessions = new Map();

function resolveChromePath() {
  // Reuse the Chromium binary Playwright already downloaded for the rest of this
  // app's automation instead of letting the MCP server fetch its own.
  try {
    return chromium.executablePath();
  } catch {
    return null;
  }
}

// storageState: an optional Playwright storage-state object ({cookies, origins})
// to restore into the new browser context — this is how a saved login session is
// carried into a fresh MCP-spawned browser instead of logging in from scratch.
async function startSession({ accountId = 'unknown', headless = true, storageState = null, userAgent = null, profileId = null } = {}) {
  const id = crypto.randomUUID();
  const outputDir = path.join(SCREENSHOT_DIR, String(accountId));
  fs.mkdirSync(outputDir, { recursive: true });

  const profile = profileManager.getProfile(profileId);
  const ua = userAgent || profile.userAgent;
  const { width, height } = profile.viewport;
  const proxy = proxyManager.buildProxy(accountId);
  const profileDir = path.join(PROFILES_DIR, String(accountId));
  fs.mkdirSync(profileDir, { recursive: true });

  // Persistent profile (cookies/localStorage/history) + real Chrome channel.
  const args = ['--no-sandbox', '--caps=storage', '--output-dir', outputDir];
  args.push('--user-data-dir', profileDir);

  const channel = stealth.detectChromeChannel();
  if (channel) {
    args.push('--browser', channel);
  } else {
    const chromePath = resolveChromePath();
    if (chromePath) args.push('--executable-path', chromePath);
  }

  if (proxy) {
    const creds = `${proxy.username}:${proxy.password}`;
    args.push('--proxy-server', `http://${creds}@${proxy.endpoint}`);
  }

  args.push('--init-script', stealth.initScriptPath);
  args.push('--viewport-size', `${width},${height}`);
  if (headless) args.push('--headless');
  args.push('--user-agent', ua);

  let storageStatePath = null;
  if (storageState) {
    storageStatePath = path.join(SESSION_STATE_DIR, `${id}-in.json`);
    fs.writeFileSync(storageStatePath, JSON.stringify(storageState));
    args.push('--storage-state', storageStatePath);
  }

  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_PATH, ...args] });
  const client = new Client({ name: 'treds-automation', version: '1.0.0' });
  await client.connect(transport);

  const session = { id, accountId: String(accountId), client, outputDir, storageStatePath, createdAt: new Date() };
  sessions.set(id, session);
  return session;
}

function toolText(result) {
  return (result.content || []).map((c) => c.text || '').join('\n');
}

async function callTool(session, name, args = {}) {
  const result = await session.client.callTool({ name, arguments: args });
  const text = toolText(result);
  if (result.isError) {
    throw new Error(`MCP tool "${name}" failed: ${text || 'unknown error'}`);
  }
  return text;
}

// Every navigation/click/type response includes a "### Page\n- Page URL: …" block —
// this pulls the current URL out of it (mirrors checking page.url() directly).
function extractPageUrl(resultText) {
  const match = resultText.match(/Page URL:\s*(\S+)/);
  return match ? match[1] : null;
}

// browser_evaluate wraps its return value as "### Result\n<pretty JSON>\n### …".
function extractEvalResult(resultText) {
  const match = resultText.match(/### Result\n([\s\S]*?)\n### /);
  const jsonText = match ? match[1] : resultText;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

// Exports the session's current cookies/localStorage so it can be restored later
// (a fresh login doesn't need to happen on every automation run).
async function saveStorageState(session) {
  const exportPath = path.join(SESSION_STATE_DIR, `${session.id}-out.json`);
  await callTool(session, 'browser_storage_state', { filename: exportPath });
  const raw = fs.readFileSync(exportPath, 'utf8');
  fs.unlink(exportPath, () => {});
  return JSON.parse(raw);
}

async function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  await session.client.close().catch(() => {});
  if (session.storageStatePath) fs.unlink(session.storageStatePath, () => {});
  sessions.delete(id);
  return true;
}

function getSession(id) {
  return sessions.get(id) || null;
}

function listSessions() {
  return Array.from(sessions.values()).map((s) => ({
    id: s.id,
    accountId: s.accountId,
    createdAt: s.createdAt,
  }));
}

module.exports = {
  startSession,
  callTool,
  toolText,
  extractPageUrl,
  extractEvalResult,
  saveStorageState,
  closeSession,
  getSession,
  listSessions,
};

const { chromium } = require("playwright");

const MAX_ACTIVE_PROFILES = 3;

function normalizeProfileId(profileId) {
  if (typeof profileId !== "string" || !profileId.trim()) {
    throw new TypeError("profileId must be a non-empty string");
  }

  return profileId.trim();
}

class IsolatedBrowserQaManager {
  constructor({ launchBrowser = () => chromium.launch({ headless: true }) } = {}) {
    if (typeof launchBrowser !== "function") {
      throw new TypeError("launchBrowser must be a function");
    }

    this.launchBrowser = launchBrowser;
    this.browser = null;
    this.browserPromise = null;
    this.sessions = new Map();
    this.launches = new Map();
    this.closing = false;
  }

  async launchAccount(profileId) {
    const id = normalizeProfileId(profileId);
    if (this.closing) {
      throw new Error("The browser QA manager is closing");
    }

    const existing = this.sessions.get(id);
    if (existing) return existing;

    const pending = this.launches.get(id);
    if (pending) return pending;

    if (this.sessions.size + this.launches.size >= MAX_ACTIVE_PROFILES) {
      throw new Error(`At most ${MAX_ACTIVE_PROFILES} QA profiles may run at once`);
    }

    const launchPromise = this.createSession(id);
    this.launches.set(id, launchPromise);

    try {
      return await launchPromise;
    } finally {
      if (this.launches.get(id) === launchPromise) {
        this.launches.delete(id);
      }
      await this.closeBrowserIfIdle();
    }
  }

  async createSession(profileId) {
    const browser = await this.getBrowser();
    const context = await browser.newContext();

    try {
      const page = await context.newPage();
      const session = { profileId, browser, context, page };
      this.sessions.set(profileId, session);
      return session;
    } catch (error) {
      try {
        await context.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          `Could not create or clean up QA profile "${profileId}"`,
        );
      }
      throw error;
    }
  }

  async getBrowser() {
    if (this.browser) {
      if (!this.browser.isConnected()) {
        throw new Error("The QA browser disconnected unexpectedly; close the manager before retrying");
      }
      return this.browser;
    }

    if (!this.browserPromise) {
      this.browserPromise = Promise.resolve()
        .then(() => this.launchBrowser())
        .then((browser) => {
          this.browser = browser;
          return browser;
        })
        .finally(() => {
          this.browserPromise = null;
        });
    }

    return this.browserPromise;
  }

  async stopAccount(profileId) {
    const id = normalizeProfileId(profileId);
    const pending = this.launches.get(id);
    if (pending) await pending;

    const session = this.sessions.get(id);
    if (!session) return false;

    this.sessions.delete(id);
    let cleanupError;

    try {
      await session.context.close();
    } catch (error) {
      cleanupError = error;
    }

    try {
      await this.closeBrowserIfIdle();
    } catch (error) {
      if (cleanupError) {
        throw new AggregateError(
          [cleanupError, error],
          `Could not fully stop QA profile "${id}"`,
        );
      }
      throw error;
    }

    if (cleanupError) throw cleanupError;
    return true;
  }

  async runTestScenario(profileId, scenarioFn) {
    if (typeof scenarioFn !== "function") {
      throw new TypeError("scenarioFn must be a function");
    }

    const session = await this.launchAccount(profileId);
    let result;
    let scenarioError;

    try {
      result = await scenarioFn(session);
    } catch (error) {
      scenarioError = error;
    }

    try {
      await this.stopAccount(profileId);
    } catch (cleanupError) {
      if (scenarioError) {
        throw new AggregateError(
          [scenarioError, cleanupError],
          `QA scenario and cleanup both failed for profile "${profileId}"`,
        );
      }
      throw cleanupError;
    }

    if (scenarioError) throw scenarioError;
    return result;
  }

  listAccounts() {
    return Array.from(this.sessions.keys());
  }

  async closeBrowserIfIdle() {
    if (
      this.closing ||
      this.sessions.size > 0 ||
      this.launches.size > 0 ||
      !this.browser
    ) {
      return;
    }

    const browser = this.browser;
    this.browser = null;
    await browser.close();
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    const errors = [];

    try {
      const pendingLaunches = await Promise.allSettled(this.launches.values());
      for (const result of pendingLaunches) {
        if (result.status === "rejected") errors.push(result.reason);
      }
      this.launches.clear();

      const sessions = Array.from(this.sessions.values());
      this.sessions.clear();
      const contextResults = await Promise.allSettled(
        sessions.map((session) => session.context.close()),
      );
      for (const result of contextResults) {
        if (result.status === "rejected") errors.push(result.reason);
      }

      const browser = this.browser;
      this.browser = null;
      if (browser) {
        try {
          await browser.close();
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      this.closing = false;
    }

    if (errors.length) {
      throw new AggregateError(errors, "Could not fully close the browser QA manager");
    }
  }
}

module.exports = { IsolatedBrowserQaManager, MAX_ACTIVE_PROFILES };

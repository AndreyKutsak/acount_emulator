const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  IsolatedBrowserQaManager,
  MAX_ACTIVE_PROFILES,
} = require("../src/services/isolatedBrowserQa");

function createFakeBrowser() {
  const contexts = [];
  let closed = false;

  return {
    contexts,
    isConnected: () => !closed,
    newContext: async () => {
      const context = {
        closed: false,
        newPage: async () => ({ context }),
        close: async () => {
          context.closed = true;
        },
      };
      contexts.push(context);
      return context;
    },
    close: async () => {
      closed = true;
    },
    isClosed: () => closed,
  };
}

test("keeps profiles isolated and reuses their active session", async () => {
  const browser = createFakeBrowser();
  let browserLaunches = 0;
  const manager = new IsolatedBrowserQaManager({
    launchBrowser: async () => {
      browserLaunches += 1;
      return browser;
    },
  });

  const first = await manager.launchAccount("qa-one");
  const same = await manager.launchAccount("qa-one");
  const second = await manager.launchAccount("qa-two");

  assert.equal(first, same);
  assert.notEqual(first.context, second.context);
  assert.notEqual(first.page, second.page);
  assert.deepEqual(manager.listAccounts(), ["qa-one", "qa-two"]);
  assert.equal(browserLaunches, 1);

  await manager.stopAccount("qa-one");
  assert.equal(first.context.closed, true);
  assert.equal(browser.isClosed(), false);
  await manager.stopAccount("qa-two");
  assert.equal(browser.isClosed(), true);
});

test("limits the number of active QA profiles", async () => {
  const browser = createFakeBrowser();
  const manager = new IsolatedBrowserQaManager({
    launchBrowser: async () => browser,
  });

  for (let index = 0; index < MAX_ACTIVE_PROFILES; index += 1) {
    await manager.launchAccount(`qa-${index}`);
  }

  await assert.rejects(
    manager.launchAccount("qa-over-limit"),
    new RegExp(`At most ${MAX_ACTIVE_PROFILES} QA profiles`),
  );
  await manager.close();
});

test("always stops the scenario context and preserves scenario failures", async () => {
  const browser = createFakeBrowser();
  const manager = new IsolatedBrowserQaManager({
    launchBrowser: async () => browser,
  });

  await assert.rejects(
    manager.runTestScenario("qa-failure", async ({ page }) => {
      assert.ok(page);
      throw new Error("scenario failed");
    }),
    /scenario failed/,
  );

  assert.deepEqual(manager.listAccounts(), []);
  assert.equal(browser.isClosed(), true);
});

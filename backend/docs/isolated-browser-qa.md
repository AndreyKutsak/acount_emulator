# Isolated browser QA

`IsolatedBrowserQaManager` provides isolated, in-memory Playwright contexts for
authorized QA on test or local pages. Each profile gets a separate context,
cookie jar, and local storage. Contexts are not persisted between runs.

The manager starts a standard headless Playwright Chromium browser, allows at
most three active profiles, and does not configure proxies, fingerprint
overrides, anti-detection tooling, or Threads-specific actions.

```js
const { IsolatedBrowserQaManager } = require("./src/services/isolatedBrowserQa");

const qa = new IsolatedBrowserQaManager();

try {
  const result = await qa.runTestScenario("local-case-a", async ({ page }) => {
    await page.goto("http://localhost:5173");
    return page.title();
  });
  console.log(result);
} finally {
  await qa.close();
}
```

For manual session control, use `launchAccount(profileId)` and
`stopAccount(profileId)`. Repeated launches for the same active profile reuse
the same context. `close()` shuts down every context and the browser; cleanup
errors are surfaced to the caller.

Run the unit tests from `backend/` with:

```sh
node --test test/isolatedBrowserQa.test.js
```

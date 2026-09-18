// Per-platform "create a post" automation. Unlike loginStrategies/scrapeStrategies,
// these flows click through a live compose UI, so they are the most likely to break
// when a platform changes its markup. Every step is wrapped so a failure names the
// exact step that failed instead of a generic timeout.

// Threads/Meta nav markup often has a visually-hidden duplicate of the same
// text/role (compact vs. expanded layout, accessibility clones), so `.first()`
// in DOM order can permanently point at an invisible element. Poll across ALL
// matches of every candidate locator and click whichever is actually visible.
async function clickFirstMatch(page, locators, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const locator of locators) {
      const handles = await locator.all().catch(() => []);
      for (const handle of handles) {
        const visible = await handle.isVisible().catch(() => false);
        if (visible) {
          await handle.click();
          return true;
        }
      }
    }
    await page.waitForTimeout(400);
  }
  return false;
}

async function firstVisibleHandle(page, locator, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const handles = await locator.all().catch(() => []);
    for (const handle of handles) {
      const visible = await handle.isVisible().catch(() => false);
      if (visible) return handle;
    }
    await page.waitForTimeout(400);
  }
  return null;
}

async function publishThreads(page, { text, imagePaths = [], username }, timeoutMs) {
  await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  // The feed (and the "What's new?" compose row inside it) loads asynchronously after
  // domcontentloaded — on a fresh/automated session this can take well over the default
  // timeout, so give it a dedicated settle window before hunting for the trigger.
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});

  const openedComposer = await clickFirstMatch(
    page,
    [
      // The inline "What's new?" row at the top of the feed expands into the
      // composer in place. The sidebar "New thread" nav link is a fallback —
      // on threads.com it routes to a separate modal rather than expanding inline.
      page.getByText(/what.?s new\??/i),
      page.getByRole('button', { name: /new thread/i }),
      page.getByRole('link', { name: /new thread/i }),
    ],
    timeoutMs
  );
  if (!openedComposer) {
    throw new Error('Could not find a compose trigger ("What\'s new?" row or "New thread") on threads.com — the page layout may have changed, or the session is not logged in.');
  }
  await page.waitForTimeout(500); // composer expand animation

  const editor = await firstVisibleHandle(
    page,
    page.locator('[role="dialog"] [contenteditable="true"], [contenteditable="true"]'),
    timeoutMs
  );
  if (!editor) {
    throw new Error('Compose box opened but no editable text field appeared.');
  }
  await editor.click();
  await page.keyboard.type(text, { delay: 15 });

  if (imagePaths.length > 0) {
    const fileInput = page.locator('input[type="file"]').first();
    const hasFileInput = await fileInput.count().then((c) => c > 0).catch(() => false);
    if (!hasFileInput) {
      throw new Error('Text was entered, but no image upload input was found to attach the provided images.');
    }
    await fileInput.setInputFiles(imagePaths);
    await page.waitForTimeout(1500); // let the image preview render before posting
  }

  const posted = await clickFirstMatch(
    page,
    [page.getByRole('button', { name: /^post$/i })],
    timeoutMs
  );
  if (!posted) {
    throw new Error('Text (and images, if any) were entered, but the "Post" button could not be found or was disabled.');
  }

  await page.waitForTimeout(2000);

  // Threads doesn't redirect to the new post's permalink after posting — it stays on the
  // feed. The most reliable way to recover the URL (needed later to scrape metrics) is to
  // open the author's own profile and take the newest post listed there.
  let postUrl = null;
  if (username) {
    try {
      await page.goto(`https://www.threads.com/@${username}`, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
      const href = await page.locator('a[href*="/post/"]').first().getAttribute('href').catch(() => null);
      if (href) postUrl = `https://www.threads.com${href}`;
    } catch {
      // Non-fatal: the post itself succeeded, we just couldn't resolve its URL for scraping.
    }
  }

  return { postUrl };
}

const PUBLISHERS = {
  threads: publishThreads,
};

async function publishPost(page, { platform, text, imagePaths = [], username }, timeoutMs = 45000) {
  const publisher = PUBLISHERS[platform];
  if (!publisher) {
    throw new Error(`No publish automation implemented yet for platform "${platform}"`);
  }
  if (!text || !text.trim()) {
    throw new Error('Post text is required');
  }
  return publisher(page, { text, imagePaths, username }, timeoutMs);
}

module.exports = { publishPost };

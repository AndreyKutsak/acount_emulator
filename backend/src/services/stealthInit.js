// Browser-side stealth patch. Runs before every page's scripts (injected via
// browserService.addInitScript and passed to the Playwright MCP server through
// --init-script). Patches only the highest-signal automation fingerprints, and is
// deliberately conservative so it does not break pages that rely on real APIs.
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch (e) {}

  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['uk-UA', 'uk', 'en-US', 'en'],
    });
  } catch (e) {}

  try {
    const plugins = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ];
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = plugins.slice();
        arr.item = (i) => arr[i] || null;
        arr.namedItem = (n) => arr.find((p) => p.name === n) || null;
        arr.refresh = () => {};
        return arr;
      },
    });

    const mimeTypes = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ];
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const arr = mimeTypes.slice();
        arr.item = (i) => arr[i] || null;
        arr.namedItem = (n) => arr.find((t) => t.type === n) || null;
        return arr;
      },
    });
  } catch (e) {}

  try {
    if (!window.chrome) {
      window.chrome = {
        app: {},
        csi: () => {},
        loadTimes: () => {},
        runtime: {},
      };
    }
  } catch (e) {}

  try {
    const marks = ['__playwright', '__pw_manual', '__PW_inspect', 'playwright', 'playwrightBinding', '__ariaSnapshot'];
    for (const key of marks) {
      try {
        delete window[key];
      } catch (e) {}
    }
  } catch (e) {}
})();

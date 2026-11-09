// Browser engine selector.
//
// Default is stock Playwright (works out of the box). Set BROWSER_ENGINE=patchright
// to use the Patchright fork — install it first:
//   npm i patchright && npx patchright install chromium
//
// CloakBrowser is NOT bundled: it requires a separate license/native binary, so it is
// intentionally left to the operator to install and is selected the same way
// (BROWSER_ENGINE=cloakbrowser, provided a compatible loader is added).
function loadEngine(engine = process.env.BROWSER_ENGINE) {
  if (engine === "patchright") {
    try {
      // eslint-disable-next-line global-require
      return require("patchright");
    } catch (err) {
      throw new Error(
        'BROWSER_ENGINE=patchright but "patchright" is not installed — run: npm i patchright && npx patchright install chromium',
      );
    }
  }
  // eslint-disable-next-line global-require
  return require("playwright");
}

module.exports = { loadEngine };

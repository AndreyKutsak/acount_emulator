// Spintax: "{Great|Nice|Cool} post{!|!!}" expands to one random variant per use, so
// a handful of templates produce many distinct comments. Groups may be nested
// ("{a|{b|c}}"). Braces without a "|" inside are left untouched.

const GROUP = /\{([^{}]*\|[^{}]*)\}/;
const MAX_STEPS = 1000;

function pick(options) {
  return options[Math.floor(Math.random() * options.length)];
}

function render(text) {
  let out = String(text || "");
  // Innermost groups contain no braces, so resolving them first unwraps nesting.
  for (let step = 0; step < MAX_STEPS && GROUP.test(out); step += 1) {
    out = out.replace(GROUP, (_, body) => pick(body.split("|")));
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

// Distinct sample renders, for previewing a template in the UI.
function samples(text, count = 5) {
  const seen = new Set();
  for (let i = 0; i < count * 10 && seen.size < count; i += 1) {
    seen.add(render(text));
  }
  return [...seen];
}

module.exports = { render, samples };

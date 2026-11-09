// Keyword matching for auto-replies. Pure functions: rules in, decision out.
const spintax = require("./spintax");

const WORD = "[\\p{L}\\p{N}]";
const NAME = "\\{(?:name|ім'я|имя)\\}";

// Latin letters that look like Cyrillic ones. People (and spammers) mix them,
// so "pабота" with a Latin "p" must still match "работа".
const LOOKALIKES = {
  a: "а", b: "в", c: "с", e: "е", h: "н", i: "і", k: "к",
  m: "м", o: "о", p: "р", t: "т", x: "х", y: "у",
};
const CYRILLIC = /\p{Script=Cyrillic}/u;

// Lower case, one kind of apostrophe, single spaces — so "Скільки   КОШТУЄ?" and
// "скільки коштує" compare equal, and "п’ять" matches "п'ять". Also: "ё" is "е",
// stretched letters are squeezed ("приииивіт" -> "привіт"), and Latin look-alikes
// inside Cyrillic words become Cyrillic.
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’ʼ`´‘]/g, "'")
    .replace(/ё/g, "е")
    .replace(/(\p{L})\1{2,}/gu, "$1")
    .replace(/[\p{L}']+/gu, (word) =>
      CYRILLIC.test(word) ? word.replace(/[a-z]/g, (ch) => LOOKALIKES[ch] || ch) : word,
    )
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Returns a predicate (normalizedText) => boolean, or throws for an invalid regex.
function compileKeyword(keyword, matchType) {
  if (matchType === "regex") {
    const re = new RegExp(keyword, "iu");
    return (text) => re.test(text);
  }
  const norm = normalize(keyword);
  if (!norm) return () => false;
  if (matchType === "exact") {
    const target = norm.replace(/[!?.,;:)(]+$/u, "").trim();
    return (text) => text.replace(/[!?.,;:)(]+$/u, "").trim() === target;
  }
  // "contains": whole words only, so "так" does not fire inside "також"; a "*"
  // stands for any word ending.
  const body = norm.split("*").map(escapeRegExp).join(`${WORD}*`);
  const re = new RegExp(`(?<!${WORD})${body}(?!${WORD})`, "u");
  return (text) => re.test(text);
}

// Throws a readable error when a rule cannot be compiled (used on save).
function validateRule(rule) {
  if (rule.matchType !== "regex") return;
  for (const keyword of rule.keywords || []) {
    try {
      new RegExp(keyword, "iu");
    } catch (err) {
      throw new Error(`Invalid regular expression "${keyword}": ${err.message}`);
    }
  }
}

function matchedKeywords(rule, normalizedText) {
  const hits = [];
  for (const keyword of rule.keywords || []) {
    let test;
    try {
      test = compileKeyword(keyword, rule.matchType);
    } catch {
      continue; // a broken regex never matches instead of breaking every reply
    }
    if (test(normalizedText)) hits.push(keyword);
  }
  return hits;
}

// The category a rule assigns; rules without one are their own category.
function categoryOf(rule) {
  return (rule.category || "").trim() || rule.name;
}

// A rule is ruled out when any of its exclusion phrases is present ("не шукаю
// роботу" for a job rule). Exclusions are always whole-word phrases with "*".
function excluded(rule, normalizedText) {
  if (!(rule.excludeKeywords || []).length) return false;
  return matchedKeywords({ keywords: rule.excludeKeywords, matchType: "contains" }, normalizedText).length > 0;
}

function better(a, b) {
  const pa = a.rule.priority || 0;
  const pb = b.rule.priority || 0;
  return pa > pb || (pa === pb && a.matchedKeywords.length > b.matchedKeywords.length);
}

// Classifies `text`: every keyword rule that fits, best first (highest priority,
// then the most keywords hit). `match` is the rule that answers — the best one,
// or, with nothing matching, the highest-priority fallback. `skipRuleIds` are
// rules already used for this person when oncePerUser is set; they still show up
// in `candidates` (the message is of that category) but do not answer again.
function classify(rules, text, { skipRuleIds = new Set() } = {}) {
  const normalized = normalize(text);
  const enabled = rules.filter((rule) => rule.enabled !== false);
  const usable = (rule) => !(rule.oncePerUser && skipRuleIds.has(String(rule._id)));

  const candidates = [];
  if (normalized) {
    for (const rule of enabled) {
      if (rule.isFallback || !(rule.keywords || []).length) continue;
      const hits = matchedKeywords(rule, normalized);
      const ok =
        rule.matchMode === "all"
          ? hits.length === rule.keywords.length
          : hits.length > 0;
      if (!ok || excluded(rule, normalized)) continue;
      candidates.push({ rule, category: categoryOf(rule), matchedKeywords: hits, fallback: false });
    }
  }
  candidates.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));

  let match = candidates.find((c) => usable(c.rule)) || null;
  if (!match) {
    const fallback = enabled
      .filter((rule) => rule.isFallback && usable(rule))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
    if (fallback) {
      match = { rule: fallback, category: categoryOf(fallback), matchedKeywords: [], fallback: true };
    }
  }
  // The message's category: what it is about, even when the answering rule had
  // to be a different one (a oncePerUser rule already used).
  const category = candidates[0]?.category || match?.category || "";
  return { category, candidates, match };
}

// The rule that answers `text`, or null. See classify.
function findMatch(rules, text, options) {
  return classify(rules, text, options).match;
}

// One random reply of the rule, spintax expanded, {name} filled in, split into
// separate messages on "---" lines.
function renderReply(rule, { firstName = "" } = {}) {
  const replies = (rule.replies || []).filter((r) => String(r).trim());
  if (replies.length === 0) return [];
  const raw = replies[Math.floor(Math.random() * replies.length)];
  return raw
    .split(/^\s*---\s*$/m)
    .map((part) =>
      spintax
        .render(
          firstName
            ? part.replace(new RegExp(NAME, "giu"), firstName)
            : // No name known: drop the placeholder with the comma before it, so
              // "Привіт, {name}!" becomes "Привіт!" rather than "Привіт, !".
              part.replace(new RegExp(`,?[ \\t]*${NAME}`, "giu"), ""),
        )
        .trim(),
    )
    .filter(Boolean);
}

module.exports = {
  normalize,
  classify,
  findMatch,
  categoryOf,
  renderReply,
  validateRule,
  matchedKeywords,
};

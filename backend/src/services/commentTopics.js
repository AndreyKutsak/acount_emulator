// Matching posts to comment topics by keywords. Pure functions.
const matcher = require("./autoReplyMatcher");

function hits(keywords, normalizedText) {
  if (!keywords?.length || !normalizedText) return [];
  return matcher.matchedKeywords({ keywords, matchType: "contains" }, normalizedText);
}

// Classifies a post among `topics`.
//   { avoid: topic, matchedKeywords }  the post touches a topic not to be commented;
//   { topic, matchedKeywords }         best-matching topic (most keywords hit, then
//                                      lower `order`);
//   null                               nothing matched.
function classifyPost(text, topics) {
  const normalized = matcher.normalize(text);
  if (!normalized) return null;
  const enabled = topics.filter((t) => t.enabled !== false);

  for (const topic of enabled.filter((t) => t.avoid)) {
    const found = hits(topic.keywords, normalized);
    if (found.length) return { avoid: topic, matchedKeywords: found };
  }

  let best = null;
  for (const topic of enabled.filter((t) => !t.avoid && !t.universal)) {
    const found = hits(topic.keywords, normalized);
    if (!found.length) continue;
    if (
      !best ||
      found.length > best.matchedKeywords.length ||
      (found.length === best.matchedKeywords.length && (topic.order ?? 100) < (best.topic.order ?? 100))
    ) {
      best = { topic, matchedKeywords: found };
    }
  }
  return best;
}

// Keywords of `keywords` found in `text` (the per-chat post filter).
function postKeywordHits(text, keywords) {
  return hits(keywords, matcher.normalize(text));
}

module.exports = { classifyPost, postKeywordHits };

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { shouldCollectAfterPost } = require("../src/services/androidOrchestrator");
const { applyAfterPost } = require("../src/services/androidMetrics");

const post = { type: "threadsPost", text: "x", publish: true };
const on = { metricsAfterPost: true };

test("статистику знімаємо після підтвердженої публікації", () => {
  assert.equal(shouldCollectAfterPost(post, { status: "posted", confirmed: true }, on), true);
});

test("непідтверджений пост: застосунок не перезапускаємо, бо пост ще вивантажується", () => {
  assert.equal(shouldCollectAfterPost(post, { status: "posted", confirmed: false }, on), false);
  assert.equal(shouldCollectAfterPost(post, undefined, on), false);
});

test("без увімкненого metricsAfterPost, у пробному прогоні й для інших дій - не знімаємо", () => {
  const ok = { confirmed: true };
  assert.equal(shouldCollectAfterPost(post, ok, {}), false);
  assert.equal(shouldCollectAfterPost(post, ok), false);
  assert.equal(shouldCollectAfterPost({ ...post, publish: false }, ok, on), false);
  assert.equal(shouldCollectAfterPost({ type: "threadsMetrics" }, ok, on), false);
});

test("applyAfterPost: збій статистики не кидає помилку", async () => {
  const account = { username: "test" };
  assert.equal(await applyAfterPost(account, { result: {} }), null);
  assert.equal(await applyAfterPost(account, null), null);
  assert.deepEqual(
    await applyAfterPost(account, { metrics: { ok: false, error: "вкладку профілю не знайдено" } }),
    { error: "вкладку профілю не знайдено" },
  );
});

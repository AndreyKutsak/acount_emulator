const express = require("express");
const scheduler = require("../services/scheduler");

const router = express.Router();

// Manual trigger for the background loop — runs one full cycle (publish due posts,
// refresh metrics, fetch threads comments) immediately and returns what happened.
// Useful for testing selectors and for the "run now" button without waiting for the
// next scheduled tick.
router.post("/run", async (req, res, next) => {
  try {
    const summary = await scheduler.tick();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.get("/status", (req, res) => {
  res.json(scheduler.getStatus());
});

module.exports = router;

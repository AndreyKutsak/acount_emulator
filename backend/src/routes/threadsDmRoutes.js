const express = require("express");
const c = require("../controllers/threadsDmController");

// Автовідповіді на особисті повідомлення Threads.
const router = express.Router();

router.get("/rules", c.listRules);
router.post("/rules", c.createRule);
router.post("/rules/test", c.testRules);
router.put("/rules/:ruleId", c.updateRule);
router.delete("/rules/:ruleId", c.deleteRule);

router.get("/accounts/:id/settings", c.getSettings);
router.put("/accounts/:id/settings", c.updateSettings);
router.post("/accounts/:id/run", c.runNow);
router.get("/accounts/:id/logs", c.logs);
router.get("/accounts/:id/stats", c.stats);

module.exports = router;

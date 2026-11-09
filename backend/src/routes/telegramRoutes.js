const express = require("express");
const {
  getAccounts,
  createAccount,
  deleteAccount,
  sendCode,
  resendCode,
  signIn,
  checkPassword,
  sendLoginEmail,
  verifyLoginEmail,
  requestPasswordRecovery,
  confirmPasswordRecovery,
  startQrLogin,
  pollQrLogin,
  importSession,
  cancelLogin,
  authLog,
  logOut,
  refreshProfile,
  listChats,
  getChat,
  listPosts,
  listComments,
  sendComment,
  joinChat,
} = require("../controllers/telegramController");

const auto = require("../controllers/telegramAutoCommentController");
const reply = require("../controllers/telegramAutoReplyController");
const limits = require("../controllers/telegramLimitsController");

const router = express.Router();

router.route("/accounts").get(getAccounts).post(createAccount);
router.delete("/accounts/:id", deleteAccount);

router.post("/accounts/:id/send-code", sendCode);
router.post("/accounts/:id/resend-code", resendCode);
router.post("/accounts/:id/sign-in", signIn);
router.post("/accounts/:id/password", checkPassword);
router.post("/accounts/:id/login-email", sendLoginEmail);
router.post("/accounts/:id/login-email/verify", verifyLoginEmail);
router.post("/accounts/:id/password-recovery", requestPasswordRecovery);
router.post("/accounts/:id/password-recovery/confirm", confirmPasswordRecovery);
router.route("/accounts/:id/qr-login").post(startQrLogin).get(pollQrLogin);
router.post("/accounts/:id/import-session", importSession);
router.post("/accounts/:id/cancel-login", cancelLogin);
router.get("/accounts/:id/auth-log", authLog);
router.post("/accounts/:id/logout", logOut);
router.post("/accounts/:id/refresh", refreshProfile);

router.get("/accounts/:id/chats", listChats);
router.post("/accounts/:id/join", joinChat);
router.get("/accounts/:id/chats/:chatId", getChat);
router.get("/accounts/:id/chats/:chatId/posts", listPosts);
router
  .route("/accounts/:id/chats/:chatId/posts/:postId/comments")
  .get(listComments)
  .post(sendComment);

// ---------- activity limits (anti-spam) ----------
router
  .route("/accounts/:id/limits")
  .get(limits.getLimits)
  .put(limits.updateLimits);
router.post("/accounts/:id/limits/clear", limits.clearBlock);

// ---------- comment topics ----------
router.route("/topics").get(auto.listTopics).post(auto.createTopic);
router.post("/topics/classify", auto.classifyText);
router.route("/topics/:topicId").put(auto.updateTopic).delete(auto.deleteTopic);

// ---------- comment templates ----------
router.route("/templates").get(auto.listTemplates).post(auto.createTemplates);
router.get("/templates/languages", auto.templateLanguages);
router.post("/templates/preview", auto.previewTemplate);
router
  .route("/templates/:templateId")
  .put(auto.updateTemplate)
  .delete(auto.deleteTemplate);

// ---------- auto-comment tasks ----------
router.get("/auto-comment/status", auto.status);
router
  .route("/accounts/:id/auto-comment")
  .get(auto.listTasks)
  .post(auto.createTask);
router.get("/accounts/:id/auto-comment/logs", auto.accountLogs);
router.post("/accounts/:id/clear-flood-wait", auto.clearFloodWait);
router
  .route("/auto-comment/:taskId")
  .put(auto.updateTask)
  .delete(auto.deleteTask);
router.post("/auto-comment/:taskId/run", auto.runTask);
router.post("/auto-comment/:taskId/replan", auto.replanTask);
router.get("/auto-comment/:taskId/logs", auto.taskLogs);

// ---------- auto-replies to private messages ----------
router.get("/auto-reply/status", reply.status);
router.post("/auto-reply/test", reply.testRules);
router.route("/auto-reply/rules").get(reply.listRules).post(reply.createRule);
router
  .route("/auto-reply/rules/:ruleId")
  .put(reply.updateRule)
  .delete(reply.deleteRule);
router
  .route("/accounts/:id/auto-reply")
  .get(reply.getSettings)
  .put(reply.updateSettings);
router.get("/accounts/:id/auto-reply/logs", reply.logs);
router.get("/accounts/:id/auto-reply/stats", reply.stats);

module.exports = router;

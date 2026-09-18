const express = require('express');
const {
  listSessions,
  startSession,
  stopSession,
  navigate,
  extract,
  scrapePost,
  publishPost,
  publishPostForAccount,
  refreshMetrics,
  checkAuth,
  listUserAgentPresets,
  listThreadsActions,
  threadsManualAction,
  openManualBrowser,
} = require('../controllers/automationController');

const router = express.Router();

router.get('/user-agent-presets', listUserAgentPresets);
router.get('/threads-actions', listThreadsActions);
router.post('/accounts/:accountId/check-auth', checkAuth);
router.post('/accounts/:accountId/threads-action', threadsManualAction);
router.post('/accounts/:accountId/open-browser', openManualBrowser);
router.post('/publish', publishPostForAccount);
router.post('/refresh-metrics', refreshMetrics);
router.route('/sessions').get(listSessions).post(startSession);
router.delete('/sessions/:sessionId', stopSession);
router.post('/sessions/:sessionId/navigate', navigate);
router.post('/sessions/:sessionId/extract', extract);
router.post('/sessions/:sessionId/scrape-post', scrapePost);
router.post('/sessions/:sessionId/publish-post', publishPost);

module.exports = router;

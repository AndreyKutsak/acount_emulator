const express = require('express');
const {
  getServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
  checkServer,
  checkAllServers,
} = require('../controllers/vpnServerController');
const {
  getSessionsForServer,
  createSession,
} = require('../controllers/vpnSessionController');

const router = express.Router();

router.route('/').get(getServers).post(createServer);
router.post('/check-all', checkAllServers);
router.route('/:id').get(getServer).put(updateServer).delete(deleteServer);
router.post('/:id/check', checkServer);

router.route('/:serverId/sessions').get(getSessionsForServer).post(createSession);

module.exports = router;

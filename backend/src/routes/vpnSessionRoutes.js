const express = require('express');
const {
  getAllSessions,
  closeSession,
  deleteSession,
} = require('../controllers/vpnSessionController');

const router = express.Router();

router.get('/', getAllSessions);
router.put('/:id/close', closeSession);
router.delete('/:id', deleteSession);

module.exports = router;

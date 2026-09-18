const express = require('express');
const {
  getAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  revealPassword,
} = require('../controllers/socialAccountController');

const router = express.Router();

router.route('/').get(getAccounts).post(createAccount);
router.route('/:id').get(getAccount).put(updateAccount).delete(deleteAccount);
router.post('/:id/reveal-password', revealPassword);

module.exports = router;

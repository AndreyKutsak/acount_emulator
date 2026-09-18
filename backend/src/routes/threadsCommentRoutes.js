const express = require('express');
const {
  listComments,
  fetchComments,
  replyToComment,
  markStatus,
  deleteComment,
} = require('../controllers/threadsCommentController');

const router = express.Router();

router.get('/', listComments);
router.post('/fetch', fetchComments);
router.post('/:id/reply', replyToComment);
router.patch('/:id/status', markStatus);
router.delete('/:id', deleteComment);

module.exports = router;

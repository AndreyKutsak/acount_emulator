const express = require('express');
const {
  getPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  updatePostAccount,
} = require('../controllers/postController');

const router = express.Router();

router.route('/').get(getPosts).post(createPost);
router.route('/:id').get(getPost).put(updatePost).delete(deletePost);
router.put('/:id/accounts/:accountId', updatePostAccount);

module.exports = router;

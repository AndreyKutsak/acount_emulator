const express = require('express');
const {
  getPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  updatePostAccount,
  validatePost,
  getDailyPlan,
  getJobTemplate,
  uploadImage,
} = require('../controllers/postController');

const router = express.Router();

router.post('/validate', validatePost);
router.post('/upload-image', uploadImage);
router.get('/daily-plan', getDailyPlan);
router.get('/template', getJobTemplate);
router.route('/').get(getPosts).post(createPost);
router.route('/:id').get(getPost).put(updatePost).delete(deletePost);
router.put('/:id/accounts/:accountId', updatePostAccount);

module.exports = router;

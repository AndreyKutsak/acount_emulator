import api from './client';

export const fetchPosts = () => api.get('/posts').then((res) => res.data);

export const fetchPost = (id) => api.get(`/posts/${id}`).then((res) => res.data);

export const createPost = (data) => api.post('/posts', data).then((res) => res.data);

export const updatePost = (id, data) => api.put(`/posts/${id}`, data).then((res) => res.data);

export const deletePost = (id) => api.delete(`/posts/${id}`).then((res) => res.data);

export const updatePostAccount = (postId, accountId, data) =>
  api.put(`/posts/${postId}/accounts/${accountId}`, data).then((res) => res.data);

export const publishPostNow = (postId, accountId) =>
  api.post('/automation/publish', { postId, accountId }).then((res) => res.data);

export const refreshPostMetrics = (postId, accountId) =>
  api.post('/automation/refresh-metrics', { postId, accountId }).then((res) => res.data);

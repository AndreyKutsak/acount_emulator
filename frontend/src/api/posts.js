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

export const validatePost = (data) => api.post('/posts/validate', data).then((res) => res.data);

export const fetchJobTemplate = () => api.get('/posts/template').then((res) => res.data);

export const fetchDailyPlan = (date) =>
  api.get('/posts/daily-plan', { params: date ? { date } : {} }).then((res) => res.data);

// Фото до поста: сам файл у тілі запиту -> { url } для images.
export const uploadPostImage = (file, onProgress) =>
  api
    .post('/posts/upload-image', file, {
      params: { name: file.name },
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: 0,
      onUploadProgress: (e) => onProgress?.(e.total ? e.loaded / e.total : 0),
    })
    .then((res) => res.data);

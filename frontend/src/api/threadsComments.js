import api from './client';

export const fetchThreadsComments = (params) =>
  api.get('/threads-comments', { params }).then((res) => res.data);

export const refreshThreadsComments = (accountId) =>
  api.post('/threads-comments/fetch', accountId ? { accountId } : {}).then((res) => res.data);

export const replyThreadsComment = (id, text) =>
  api.post(`/threads-comments/${id}/reply`, { text }).then((res) => res.data);

export const setThreadsCommentStatus = (id, status) =>
  api.patch(`/threads-comments/${id}/status`, { status }).then((res) => res.data);

export const deleteThreadsComment = (id) =>
  api.delete(`/threads-comments/${id}`).then((res) => res.data);

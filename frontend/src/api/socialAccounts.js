import api from './client';

export const fetchAccounts = () => api.get('/social-accounts').then((res) => res.data);

export const createAccount = (data) => api.post('/social-accounts', data).then((res) => res.data);

export const updateAccount = (id, data) =>
  api.put(`/social-accounts/${id}`, data).then((res) => res.data);

export const deleteAccount = (id) => api.delete(`/social-accounts/${id}`).then((res) => res.data);

export const revealPassword = (id) =>
  api.post(`/social-accounts/${id}/reveal-password`).then((res) => res.data.password);

export const checkAccountAuth = (id) =>
  api.post(`/automation/accounts/${id}/check-auth`).then((res) => res.data);

export const fetchUserAgentPresets = () =>
  api.get('/automation/user-agent-presets').then((res) => res.data);

export const fetchThreadsActions = () =>
  api.get('/automation/threads-actions').then((res) => res.data);

export const runThreadsAction = (id, action, payload) =>
  api.post(`/automation/accounts/${id}/threads-action`, { action, ...payload }).then((res) => res.data);

export const openAccountBrowser = (id) =>
  api.post(`/automation/accounts/${id}/open-browser`).then((res) => res.data);

export const closeBrowserSession = (sessionId) =>
  api.delete(`/automation/sessions/${sessionId}`).then((res) => res.data);

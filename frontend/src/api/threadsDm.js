import api from './client';

// Автовідповіді Threads (backend /api/threads-dm). channel: 'dm' - особисті,
// 'comments' - коментарі під нашими постами.
export const fetchDmRules = (accountId, channel = 'dm') =>
  api.get('/threads-dm/rules', { params: { channel, ...(accountId ? { accountId } : {}) } }).then((r) => r.data);

export const createDmRule = (data, channel = 'dm') =>
  api.post('/threads-dm/rules', { ...data, channel }).then((r) => r.data);

export const updateDmRule = (ruleId, data) => api.put(`/threads-dm/rules/${ruleId}`, data).then((r) => r.data);

export const deleteDmRule = (ruleId) => api.delete(`/threads-dm/rules/${ruleId}`).then((r) => r.data);

export const testDmRule = (data, channel = 'dm') =>
  api.post('/threads-dm/rules/test', { ...data, channel }).then((r) => r.data);

export const fetchDmSettings = (accountId, channel = 'dm') =>
  api.get(`/threads-dm/accounts/${accountId}/settings`, { params: { channel } }).then((r) => r.data);

export const updateDmSettings = (accountId, data, channel = 'dm') =>
  api.put(`/threads-dm/accounts/${accountId}/settings`, data, { params: { channel } }).then((r) => r.data);

// Піднімає телефон акаунта: до кількох хвилин.
export const runDmNow = (accountId, channel = 'dm') =>
  api
    .post(`/threads-dm/accounts/${accountId}/run`, {}, { params: { channel }, timeout: 900000 })
    .then((r) => r.data);

export const fetchDmLogs = (accountId, params = {}, channel = 'dm') =>
  api.get(`/threads-dm/accounts/${accountId}/logs`, { params: { ...params, channel } }).then((r) => r.data);

export const fetchDmStats = (accountId, days = 7, channel = 'dm') =>
  api.get(`/threads-dm/accounts/${accountId}/stats`, { params: { days, channel } }).then((r) => r.data);

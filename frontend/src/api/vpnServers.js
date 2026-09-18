import api from './client';

export const fetchServers = () => api.get('/vpn-servers').then((res) => res.data);

export const createServer = (data) => api.post('/vpn-servers', data).then((res) => res.data);

export const updateServer = (id, data) =>
  api.put(`/vpn-servers/${id}`, data).then((res) => res.data);

export const deleteServer = (id) => api.delete(`/vpn-servers/${id}`).then((res) => res.data);

export const checkServer = (id) => api.post(`/vpn-servers/${id}/check`).then((res) => res.data);

export const checkAllServers = () => api.post('/vpn-servers/check-all').then((res) => res.data);

export const fetchServerSessions = (serverId) =>
  api.get(`/vpn-servers/${serverId}/sessions`).then((res) => res.data);

export const createSession = (serverId, data) =>
  api.post(`/vpn-servers/${serverId}/sessions`, data).then((res) => res.data);

export const closeSession = (id) => api.put(`/vpn-sessions/${id}/close`).then((res) => res.data);

export const deleteSession = (id) => api.delete(`/vpn-sessions/${id}`).then((res) => res.data);

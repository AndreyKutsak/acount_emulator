import axios from 'axios';

// ManyFaces (менеджер емуляторів) через прокси бекенду /mf - працює з тієї ж
// адреси, що й сайт, з будь-якого домену чи телефона.
const mf = axios.create({ baseURL: '/mf/api', timeout: 120000 });

export const MANYFACES_UI_URL = '/mf/';

export const fetchProfiles = () => mf.get('/profiles').then((r) => r.data);
export const fetchDevices = () => mf.get('/devices').then((r) => r.data.devices || []);
export const fetchAndroidStatus = () => mf.get('/android/status').then((r) => r.data);
export const createProfile = (data) => mf.post('/profiles', data).then((r) => r.data);
export const updateProfile = (id, data) => mf.patch(`/profiles/${id}`, data).then((r) => r.data);
export const deleteProfile = (id) => mf.delete(`/profiles/${id}`).then((r) => r.data);
export const cloneProfile = (id) => mf.post(`/profiles/${id}/clone`).then((r) => r.data);
export const startProfile = (id) => mf.post(`/profiles/${id}/start`).then((r) => r.data);
export const stopProfile = (id) => mf.post(`/profiles/${id}/stop`).then((r) => r.data);

export function mfError(err, fallback) {
  const d = err?.response?.data;
  return (typeof d?.detail === 'string' && d.detail) || d?.message || fallback;
}

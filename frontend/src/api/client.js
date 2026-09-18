import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

export function errorMessage(err, fallback) {
  return err?.response?.data?.message || fallback;
}

export default api;

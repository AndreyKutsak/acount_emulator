import api from './client';

export const fetchItems = () => api.get('/items').then((res) => res.data);

export const createItem = (data) => api.post('/items', data).then((res) => res.data);

export const deleteItem = (id) => api.delete(`/items/${id}`).then((res) => res.data);

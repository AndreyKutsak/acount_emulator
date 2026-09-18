import api from "./client";

export const fetchStats = () => api.get("/stats").then((res) => res.data);

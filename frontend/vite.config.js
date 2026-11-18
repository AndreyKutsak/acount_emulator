import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Відкривати сайт з будь-якого домену (тунель, свій домен чи проксі перед
    // цим ПК). Без цього Vite відповідає «Blocked request. This host is not allowed».
    // Слухаємо й далі лише цей ПК: зовнішній доступ - через тунель / реверс-проксі.
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
      // ManyFaces через бекенд - доступний з тієї ж адреси, що й сайт.
      '/mf': 'http://localhost:5000',
    },
  },
});

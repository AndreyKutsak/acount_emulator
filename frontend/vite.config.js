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
    // xfwd - передати бекенду X-Forwarded-Host/For: у журналі видно, з якої адреси
    // (тунель, телефон) прийшов запит.
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true, xfwd: true },
      '/uploads': { target: 'http://localhost:5000', changeOrigin: true, xfwd: true },
      // ManyFaces через бекенд - доступний з тієї ж адреси, що й сайт.
      '/mf': { target: 'http://localhost:5000', changeOrigin: true, xfwd: true },
    },
  },
});

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.ico',
        'favicon-16.png',
        'favicon-32.png',
        'apple-touch-icon.png',
        'pwa-192.png',
        'pwa-512.png',
        'brand/goida-favicon.png',
        'brand/goida-icon-original.png',
        'brand/goida-icon-transparent.png',
      ],
      manifest: {
        name: 'Goida Chat',
        short_name: 'Goida',
        description: 'Приватные чаты, комнаты и голосовые сессии в Goida Chat',
        theme_color: '#090909',
        background_color: '#040404',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
});

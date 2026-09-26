import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages の公開先(https://creative-hues.github.io/aquarium-game/)に合わせる
const base = '/aquarium-game/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      // 新しい版を公開したら、自動で更新する
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'ちいさな水槽',
        short_name: '水槽',
        description: 'ひとりひとりの小さな水槽で、ふしぎな生き物をながめるアプリ',
        lang: 'ja',
        display: 'standalone',
        orientation: 'landscape',
        start_url: base,
        scope: base,
        theme_color: '#1a0f2e',
        background_color: '#1a0f2e',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // オフラインでも開けるよう、これらのファイルを端末に保存する
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
});

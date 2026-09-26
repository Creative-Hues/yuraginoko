import {
  defineConfig,
  minimal2023Preset as preset,
} from '@vite-pwa/assets-generator/config';

// public/icon.svg から、PWA に必要な各サイズのアイコン画像を作る設定
export default defineConfig({
  headLinkOptions: {
    preset: '2023',
  },
  preset,
  images: ['public/icon.svg'],
});

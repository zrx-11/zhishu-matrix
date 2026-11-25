import { defineConfig } from 'vite';

// 铁律 2：渲染结果不得在运行时发起任何网络请求。
// 因此 Three.js 走 npm 依赖由 Vite 打进 bundle，数据走同源 publicDir，不引任何 CDN。
export default defineConfig({
  root: '.',
  publicDir: 'data',
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  preview: {
    port: 4173,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
});

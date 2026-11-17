import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages 프로젝트 사이트는 /trader/ 아래에 배포된다.
  // 다른 호스트나 로컬에서는 기존처럼 / 를 사용한다.
  base: process.env.GITHUB_PAGES === 'true' ? '/trader/' : '/',
  plugins: [react()],
  server: { port: 5183, strictPort: false },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

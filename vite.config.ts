/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // Tauri 约定：固定端口 + 端口被占用时报错而不是换端口
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

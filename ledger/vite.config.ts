import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative addresses for the built files, so the app also works under a sub-path (the Home Assistant add-on).
  base: './',
  build: { outDir: 'dist' },
});

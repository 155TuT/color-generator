import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, isPreview }) => ({
  // Pages supplies its actual base path; ordinary development stays at the root.
  base: command === 'serve' && !isPreview ? '/' : `${process.env.PAGES_BASE_PATH?.replace(/\/$/, '') || ''}/`,
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: { app: 'index.html', docs: 'docs/index.html' },
    },
  },
}));

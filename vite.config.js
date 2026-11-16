import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = `http://127.0.0.1:${Number(env.PORT || process.env.PORT || 5000)}`;
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: { '/api': apiTarget, '/socket.io': { target: apiTarget, ws: true } },
      watch: { ignored: ['**/node_modules/**', '**/.git/**', '**/.cache/**', '**/dist/**'] },
    },
  };
});

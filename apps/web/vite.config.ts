import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({ plugins: [react()], build: { rollupOptions: { input: { app: fileURLToPath(new URL('./index.html', import.meta.url)), world: fileURLToPath(new URL('./world.html', import.meta.url)) } } }, server: { proxy: { '/api': 'http://localhost:3001', '/socket.io': { target: 'http://localhost:3001', ws: true } } } });

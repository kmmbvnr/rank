import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
    base: './',
    server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
    preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
    build: {
        outDir: mode === 'mobile' ? 'dist-mobile' : 'dist',
        rollupOptions: {
            input: {
                index: fileURLToPath(new URL('./index.html', import.meta.url)),
                console: fileURLToPath(new URL('./console.html', import.meta.url)),
            },
        },
    },
    // Capacitor opens index.html. Keep its entry a full-screen console, with no landing page.
    plugins: mode === 'mobile' ? [{
        name: 'rank-mobile-entry',
        transformIndexHtml: {
            order: 'pre',
            handler(html, context) {
                return context.filename.endsWith('/index.html')
                    ? readFileSync(new URL('./console.html', import.meta.url), 'utf8') : html;
            },
        },
    }] : [],
}));

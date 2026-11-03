import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type ProxyOptions } from 'vite';
import { execFileSync } from 'node:child_process';

let revision = 'unknown';
const version = JSON.parse(readFileSync(new URL('../mobile/package.json', import.meta.url), 'utf8')).version;
try { revision = execFileSync('git', ['describe', '--always', '--dirty'], { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' }).trim(); } catch { /* Source archives have no Git metadata. */ }

const eulerProxy: Record<string, ProxyOptions> = {
    '^/__rank_euler/[A-Za-z0-9_.-]+$': {
        target: 'https://projecteuler.net', changeOrigin: true,
        headers: { 'Accept-Encoding': 'identity' },
        configure: proxy => proxy.on('proxyReq', request => {
            // Browser credentials and fetch metadata belong to our origin.
            for (const name of request.getHeaderNames())
                if (name !== 'host' && name !== 'accept-encoding') request.removeHeader(name);
        }),
        rewrite: (path: string) => path.replace('/__rank_euler/', '/resources/documents/'),
    },
};

export default defineConfig(({ mode }) => ({
    define: { 'import.meta.env.VITE_RANK_REVISION': JSON.stringify(revision), 'import.meta.env.VITE_RANK_VERSION': JSON.stringify(version) },
    base: './',
    server: { proxy: eulerProxy, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
    preview: { proxy: eulerProxy, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
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

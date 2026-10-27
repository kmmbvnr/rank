import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { runRamGpu } from '../cli/src/ram-gpu';

let revision = 'unknown';
const version = JSON.parse(readFileSync(new URL('../mobile/package.json', import.meta.url), 'utf8')).version;
try { revision = execFileSync('git', ['describe', '--always', '--dirty'], { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' }).trim(); } catch { /* Source archives have no Git metadata. */ }

export default defineConfig(({ mode }) => ({
    define: { 'import.meta.env.VITE_RANK_REVISION': JSON.stringify(revision), 'import.meta.env.VITE_RANK_VERSION': JSON.stringify(version) },
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
    plugins: [{
        name: 'rank-local-gpu',
        configureServer(server) {
            server.middlewares.use('/__rank_ml', (request, response) => {
                response.setHeader('Content-Type', 'application/json');
                response.setHeader('Cache-Control', 'no-store');
                try {
                    const query = new URL(request.url ?? '', 'http://localhost');
                    response.end(JSON.stringify(runRamGpu(JSON.parse(query.searchParams.get('request') ?? '{}'))));
                } catch (error) { response.end(JSON.stringify({ error: String(error) })); }
            });
        },
    }, ...(mode === 'mobile' ? [{
        name: 'rank-mobile-entry',
        transformIndexHtml: {
            order: 'pre',
            handler(html, context) {
                return context.filename.endsWith('/index.html')
                    ? readFileSync(new URL('./console.html', import.meta.url), 'utf8') : html;
            },
        },
    }] : [])],
}));

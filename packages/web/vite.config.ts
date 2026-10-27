import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { sendRamGpu } from '../cli/src/ram-gpu';

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
            server.middlewares.use('/__rank_ml', async (request, response) => {
                response.setHeader('Content-Type', 'application/json');
                response.setHeader('Cache-Control', 'no-store');
                try {
                    if (request.method !== 'POST') { response.statusCode = 405; response.end(); return; }
                    const chunks: Buffer[] = [];
                    let size = 0;
                    for await (const chunk of request) {
                        size += chunk.length;
                        if (size > 32 * 1024 * 1024) throw new Error('RAM request is too large');
                        chunks.push(Buffer.from(chunk));
                    }
                    response.end(JSON.stringify(sendRamGpu(JSON.parse(Buffer.concat(chunks).toString('utf8')))));
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

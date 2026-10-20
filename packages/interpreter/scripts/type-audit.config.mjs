import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: { runner: fileURLToPath(new URL('./type-audit-runner.mjs', import.meta.url)) },
});

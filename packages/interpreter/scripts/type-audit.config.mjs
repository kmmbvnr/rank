import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: { runner: './scripts/type-audit-runner.mjs' },
});

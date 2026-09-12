// Unit tests run in node; the one file that mounts a chart opts into jsdom with a
// per-file `// @vitest-environment jsdom` pragma. The browser gates
// (`verify:browser`, `check:warnings`) stay separate — they need the docs repo.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.js'],
        environment: 'node',
    },
});

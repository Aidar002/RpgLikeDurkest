import { defineConfig } from 'vite';

// Allow overriding the public base path so the build also works on forks
// or local previews. Set VITE_BASE (e.g. "/", "/MyFork/") in CI when
// deploying to a different repo path.
const base = process.env.VITE_BASE ?? '/RpgLikeDurkest/';

export default defineConfig({
    base,
    build: {
        // Pull Phaser into its own chunk so the app code (which we actually
        // iterate on) stays small and cacheable independently from the engine.
        rolldownOptions: {
            output: {
                manualChunks: (id: string) => {
                    if (id.includes('node_modules/phaser')) {
                        return 'phaser';
                    }
                    return undefined;
                },
            },
        },
        // Phaser alone is ~1.3 MB minified; the default 500 kB warning is not
        // actionable without dropping the engine, so bump the threshold to a
        // realistic level for the phaser chunk.
        chunkSizeWarningLimit: 1500,
    },
});

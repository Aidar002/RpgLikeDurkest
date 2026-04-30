import { defineConfig } from 'vite';

// Allow overriding the public base path so the build also works on forks
// or local previews. Set VITE_BASE (e.g. "/", "/MyFork/") in CI when
// deploying to a different repo path.
const base = process.env.VITE_BASE ?? '/RpgLikeDurkest/';

export default defineConfig({
    base,
});

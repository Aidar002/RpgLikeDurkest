import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['dist/**', 'node_modules/**', '*.bat', '*.ps1', '.husky/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            // Browser globals (window, document, localStorage, AudioContext,
            // setTimeout, …) — sourced from the `globals` package so we
            // don't have to maintain a hand-curated list.
            globals: { ...globals.browser },
        },
        rules: {
            // Project style: warn but do not fail on these — the codebase
            // uses some intentional patterns we will tighten over time.
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-empty-function': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    }
);

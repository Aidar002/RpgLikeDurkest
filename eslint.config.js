import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['dist/**', 'node_modules/**', '*.bat', '*.ps1'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: {
                window: 'readonly',
                document: 'readonly',
                localStorage: 'readonly',
                AudioContext: 'readonly',
                OscillatorNode: 'readonly',
                OscillatorType: 'readonly',
                GainNode: 'readonly',
                AudioNode: 'readonly',
                AudioBufferSourceNode: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
            },
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

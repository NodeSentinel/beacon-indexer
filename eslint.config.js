// @ts-check
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import * as importPlugin from 'eslint-plugin-import';
import nodePlugin from 'eslint-plugin-node';
import prettierPlugin from 'eslint-plugin-prettier';
import tseslint from 'typescript-eslint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// FlatCompat instance scoped to the Next.js mini-app package
const compatMiniApp = new FlatCompat({
  baseDirectory: join(__dirname, 'packages/webapp'),
});

const nextMiniAppConfigs = compatMiniApp
  // We only extend the Next.js core rules here; TypeScript-related rules are
  // already covered by the root `typescript-eslint` configuration.
  .extends('next/core-web-vitals')
  .map((config) => {
    const { plugins, ...rest } = config;

    // Ensure the "import" plugin is available for rules like
    // "import/no-anonymous-default-export", and that it points to the same
    // instance we register in the root config to avoid redefinition issues.
    const normalizedPlugins = {
      ...(plugins ?? {}),
      import: importPlugin,
    };

    // Some Next.js ESLint rules still rely on deprecated ESLint 8 APIs
    // (e.g. `context.getAncestors`), which are no longer available in ESLint 9.
    // We explicitly turn off the problematic rules here until the plugin is updated.
    const normalizedRules = {
      ...(rest.rules ?? {}),
      '@next/next/no-duplicate-head': 'off',
      '@next/next/no-page-custom-font': 'off',
    };

    return {
      ...rest,
      plugins: normalizedPlugins,
      rules: normalizedRules,
      files: ['packages/webapp/**/*'],
    };
  });

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
      },
    },
    plugins: {
      prettier: prettierPlugin,
      import: importPlugin,
      node: nodePlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'prettier/prettier': 'warn',
    },
  },
  // Next.js + TypeScript rules for the app package
  ...nextMiniAppConfigs,
  prettierConfig,
  {
    ignores: [
      'node_modules',
      'dist',
      'build',
      'coverage',
      '.next',
      '.vercel',
      '.turbo',
      '.cache',
      'public',
      // Patrones específicos para los subdirectorios
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.next/**',
      '**/.vercel/**',
      '**/.turbo/**',
      '**/.cache/**',
      '**/public/**',
      // Package-specific patterns
      'packages/db/dist/**',
      'packages/db/generated/**',
      'packages/indexer/dist/**',
    ],
  },
);

import {
  createDefaultEsmPreset,
  type JestConfigWithTsJest,
  pathsToModuleNameMapper,
} from 'ts-jest';

import { compilerOptions } from './tsconfig.json';

const defaultEsmPreset = createDefaultEsmPreset();

const config: JestConfigWithTsJest = {
  ...defaultEsmPreset,
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>'],
  modulePaths: [compilerOptions.baseUrl],
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, {
    prefix: '<rootDir>/',
    useESM: true,
  }),
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
  clearMocks: true,
};

export default config;

/** @type {import('ts-jest').JestConfigWithTsJest} **/
export default {
  clearMocks: true,
  testEnvironment: 'node',
  testMatch: [
    '**/tests/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  preset: 'ts-jest',
  resolver: 'ts-jest-resolver',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      useESM: true,
    }],
  },
};

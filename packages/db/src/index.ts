// Re-export everything from the generated Prisma client
// This makes @beacon-indexer/db work as a drop-in replacement for @prisma/client

// Export everything from the main client
export * from '../generated/client/index.js';

// Export specific utilities that might be needed
export { Decimal } from '../generated/client/runtime/library.js';

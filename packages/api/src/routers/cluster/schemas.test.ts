import { describe, expect, it } from 'vitest';

import { CreateClusterInputSchema, UpdateClusterInputSchema } from './schemas.js';

describe('cluster schemas', () => {
  it('accepts a Lido CSM operator id on cluster creation', () => {
    // This case verifies create payloads can persist a Lido CSM operator reference.
    const result = CreateClusterInputSchema.parse({
      name: 'Lido cluster',
      validatorIndexes: [1],
      lidoCsmOperatorId: 12,
    });

    // Confirms the parsed payload keeps the numeric operator id.
    expect(result.lidoCsmOperatorId).toBe(12);
  });

  it('rejects a nullable Lido CSM operator id on cluster update', () => {
    // This case verifies clearing Lido CSM operators must use the dedicated cluster action.
    const parse = () =>
      UpdateClusterInputSchema.parse({
        lidoCsmOperatorId: null,
      });

    // Confirms update payloads cannot smuggle a clear operation into the generic save route.
    expect(parse).toThrow();
  });

  it('accepts a concrete Lido CSM operator id on cluster update', () => {
    // This case verifies update payloads can persist a selected Lido CSM operator reference.
    const result = UpdateClusterInputSchema.parse({
      lidoCsmOperatorId: 12,
    });

    // Confirms the parsed payload keeps the numeric operator id.
    expect(result.lidoCsmOperatorId).toBe(12);
  });
});

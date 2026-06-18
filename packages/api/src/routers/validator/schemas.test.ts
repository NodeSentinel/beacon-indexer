import { describe, expect, it } from 'vitest';

import { ValidatorSearchInputSchema } from './schemas.js';

describe('ValidatorSearchInputSchema', () => {
  it('accepts a Lido CSM operator id as the only search field', () => {
    const result = ValidatorSearchInputSchema.parse({ lidoCsmOperatorId: '123' });

    expect(result.lidoCsmOperatorId).toBe(123);
  });

  it('rejects a Lido CSM operator id mixed with another search field', () => {
    expect(() =>
      ValidatorSearchInputSchema.parse({
        index: 1,
        lidoCsmOperatorId: 123,
      }),
    ).toThrow();
  });
});

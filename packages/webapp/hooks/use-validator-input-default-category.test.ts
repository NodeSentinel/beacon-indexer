import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('useValidatorInput default category', () => {
  it('initializes the selected search category from the selected chain', () => {
    // Read the hook source because it depends on React state and app environment wiring.
    const hookSource = readFileSync(new URL('./use-validator-input.ts', import.meta.url), 'utf8');

    // Confirm the hook asks the shared helper for the chain-specific default category.
    assert.match(hookSource, /getDefaultValidatorSearchCategory\(chain\)/);
  });

  it('receives the configured chain from the cluster validator input component', () => {
    // Read the component source to confirm the app chain reaches the hook initializer.
    const inputSource = readFileSync(
      new URL('../components/cluster/cluster-form/validator-input.tsx', import.meta.url),
      'utf8',
    );

    // Confirm the component passes NEXT_PUBLIC_CHAIN into the validator input hook.
    assert.match(inputSource, /chain:\s*env\.NEXT_PUBLIC_CHAIN/);
  });
});

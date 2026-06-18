import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ValidatorChip } from './validator-chip';

(globalThis as { React?: typeof React }).React = React;

// Provides an inert callback for server-rendered component tests.
const noop = () => {};

describe('ValidatorChip', () => {
  it('shows the validator index even when the validator was found by pubkey', () => {
    const markup = renderToStaticMarkup(
      <ValidatorChip
        validator={{
          id: 'validator-1',
          type: 'pubkey',
          value:
            '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef',
          index: 1631439,
          displayName: 'Validator #1631439',
          withdrawalAddress: '0x1234567890123456789012345678901234567890',
        }}
        onRemove={noop}
      />,
    );

    assert.match(markup, /1631439/);
    assert.doesNotMatch(markup, /0xabcd/);
  });
});

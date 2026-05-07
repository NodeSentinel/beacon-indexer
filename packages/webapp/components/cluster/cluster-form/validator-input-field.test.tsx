import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ValidatorInputField } from './validator-input-field';
import { WithdrawalAddressCard } from './withdrawal-address-card';

(globalThis as { React?: typeof React }).React = React;

// Provides inert callbacks for server-rendered component tests.
const noop = () => {};

describe('ValidatorInputField', () => {
  it('keeps the add button label stable when the empty input has background loading', () => {
    const markup = renderToStaticMarkup(
      <ValidatorInputField
        inputValue=""
        validationState="idle"
        errorMessage=""
        isSearching
        isMobile={false}
        helpDialogOpen={false}
        onHelpDialogChange={noop}
        onInputChange={noop}
        onKeyDown={noop}
        onAdd={noop}
      />,
    );

    assert.match(markup, />Add</);
    assert.doesNotMatch(markup, /Adding\.\.\./);
  });
});

describe('WithdrawalAddressCard', () => {
  it('labels the grouped validator hash as a withdrawal address', () => {
    const markup = renderToStaticMarkup(
      <WithdrawalAddressCard
        address="0x1234567890123456789012345678901234567890"
        validators={[
          {
            id: 'validator-1',
            type: 'index',
            value: '1',
            index: 1,
            displayName: 'Validator #1',
            withdrawalAddress: '0x1234567890123456789012345678901234567890',
          },
        ]}
        totalCount={1}
        missingCount={0}
        onRemoveAddress={noop}
        onRemoveValidator={noop}
        onAddMissing={noop}
      />,
    );

    assert.match(markup, /Withdrawal address/);
  });
});

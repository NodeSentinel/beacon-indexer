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
  it('renders category tabs without the unsupported lido category', () => {
    const markup = renderToStaticMarkup(
      <ValidatorInputField
        inputValue=""
        selectedCategory="index"
        validationState="idle"
        chain="gnosis"
        errorMessage=""
        isSearching={false}
        isMobile={false}
        helpDialogOpen={false}
        onCategoryChange={noop}
        onHelpDialogChange={noop}
        onInputChange={noop}
        onKeyDown={noop}
        onAdd={noop}
      />,
    );

    assert.match(markup, /Index/);
    assert.match(markup, /Pub Key/);
    assert.match(markup, /Withdrawal/);
    assert.doesNotMatch(markup, /Lido/);
  });

  it('renders the Lido CSM category for Ethereum', () => {
    const markup = renderToStaticMarkup(
      <ValidatorInputField
        inputValue=""
        selectedCategory="index"
        validationState="idle"
        chain="ethereum"
        errorMessage=""
        isSearching={false}
        isMobile={false}
        helpDialogOpen={false}
        onCategoryChange={noop}
        onHelpDialogChange={noop}
        onInputChange={noop}
        onKeyDown={noop}
        onAdd={noop}
      />,
    );

    assert.match(markup, /Lido CSM/);
    assert.match(markup, /\/assets\/lido-csm\.svg/);
  });

  it('hides the Lido CSM category for Gnosis', () => {
    const markup = renderToStaticMarkup(
      <ValidatorInputField
        inputValue=""
        selectedCategory="index"
        validationState="idle"
        chain="gnosis"
        errorMessage=""
        isSearching={false}
        isMobile={false}
        helpDialogOpen={false}
        onCategoryChange={noop}
        onHelpDialogChange={noop}
        onInputChange={noop}
        onKeyDown={noop}
        onAdd={noop}
      />,
    );

    assert.doesNotMatch(markup, /Lido CSM/);
  });

  it('keeps the add button label stable when the empty input has background loading', () => {
    const markup = renderToStaticMarkup(
      <ValidatorInputField
        inputValue=""
        selectedCategory="index"
        validationState="idle"
        chain="gnosis"
        errorMessage=""
        isSearching
        isMobile={false}
        helpDialogOpen={false}
        onCategoryChange={noop}
        onHelpDialogChange={noop}
        onInputChange={noop}
        onKeyDown={noop}
        onAdd={noop}
      />,
    );

    assert.match(markup, />Add</);
    assert.doesNotMatch(markup, /Adding\.\.\./);
  });

  it('shows the current Lido CSM operator as disabled with a delete action', () => {
    const markup = renderToStaticMarkup(
      <ValidatorInputField
        inputValue=""
        selectedCategory="lidoCsm"
        validationState="idle"
        chain="ethereum"
        errorMessage=""
        isSearching={false}
        isMobile={false}
        helpDialogOpen={false}
        currentLidoCsmOperatorId="12"
        onCategoryChange={noop}
        onHelpDialogChange={noop}
        onInputChange={noop}
        onKeyDown={noop}
        onAdd={noop}
        onDeleteLidoCsmOperator={noop}
      />,
    );

    assert.match(markup, /value="12"/);
    assert.match(markup, /disabled=""/);
    assert.match(markup, />Delete</);
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

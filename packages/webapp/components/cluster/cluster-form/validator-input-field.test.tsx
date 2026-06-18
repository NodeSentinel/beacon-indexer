import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { getBulkActionDialogCopy } from './bulk-action-dialog';
import { ValidatorInputField } from './validator-input-field';
import { ValidatorsList } from './validators-list';
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
    assert.ok(markup.indexOf('Lido CSM') < markup.indexOf('Index'));
  });

  it('renders the category tabs in a horizontal scroll area', () => {
    const markup = renderToStaticMarkup(
      <ValidatorInputField
        inputValue=""
        selectedCategory="index"
        validationState="idle"
        chain="ethereum"
        errorMessage=""
        isSearching={false}
        isMobile
        helpDialogOpen={false}
        onCategoryChange={noop}
        onHelpDialogChange={noop}
        onInputChange={noop}
        onKeyDown={noop}
        onAdd={noop}
      />,
    );

    assert.match(markup, /overflow-x-auto/);
    assert.match(markup, /w-max/);
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

describe('BulkActionDialog', () => {
  it('uses Lido CSM copy without rendering an empty source box', () => {
    const bulkAction = {
      action: 'add' as const,
      withdrawalAddress: '',
      validatorCount: 12,
      validators: [],
      lidoCsmOperatorId: 344,
    };

    const copy = getBulkActionDialogCopy(bulkAction);

    assert.match(copy.description, /Lido CSM operator 344 has 12 validators/);
    assert.equal(copy.sourceValue, undefined);
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

describe('ValidatorsList', () => {
  it('shows a Lido CSM add banner when operator validators are missing', () => {
    const markup = renderToStaticMarkup(
      <ValidatorsList
        validators={[]}
        allWithdrawalAddresses={[]}
        validatorsByAddress={{}}
        missingValidatorsByAddress={{}}
        isEditMode
        lidoCsmOperatorId="344"
        lidoCsmValidatorCount={50}
        missingLidoCsmValidatorCount={1}
        onRemoveValidator={noop}
        onRemoveByWithdrawal={noop}
        onAddMissingValidators={noop}
        onAddMissingLidoCsmValidators={noop}
      />,
    );

    assert.match(markup, /Lido CSM operator 344/);
    assert.match(markup, /1 more validator available/);
    assert.match(markup, /Add all/);
  });
});

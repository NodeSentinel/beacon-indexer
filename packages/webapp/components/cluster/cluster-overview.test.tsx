import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ClusterOverview from './cluster-overview';
import { getTokenConfig } from '@/lib/utils';
import type { Cluster } from '@/types/cluster';
import type { Stats } from '@/types/validator';

(globalThis as { React?: typeof React }).React = React;

// Provides an inert callback for server-rendered component tests.
const noop = () => {};

// Builds the minimum cluster data needed to render balance fields.
const cluster: Cluster = {
  id: 'cluster-1',
  name: 'Ethereum Cluster',
  visibility: 'private',
  ownerId: 'owner-1',
  withdrawalAddresses: [],
  feeRecipientAddress: null,
  validatorIndices: [],
  validators: [],
  totalBalance: 96.123456,
  totalEffectiveBalance: 96,
  claimableRewards: 0.123456,
  performance: 99,
};

// Builds the minimum stats data needed to render the rewards table.
const stats: Stats = {
  performance1h: 99,
  balance: 96.123456,
  balanceUsd: 240000,
  claimable: 0.123456,
  claimableUsd: 300,
  apyDay: 1,
  apyWeek: 2,
  apyMonth: 3,
  gnoDay: 0.111111,
  gnoWeek: 0.222222,
  gnoMonth: 0.333333,
  xdaiDay: 0.01,
  xdaiWeek: 0.02,
  xdaiMonth: 0.03,
  missedDay: 0.004567,
  missedWeek: 0.005678,
  missedMonth: 0.006789,
  totalDay: 1,
  totalWeek: 2,
  totalMonth: 3,
  gnoPrice: 2500,
  lastUpdated: '2026-05-08T00:00:00.000Z',
};

describe('ClusterOverview', () => {
  it('builds display token config from the selected chain', () => {
    // Confirm Ethereum displays ETH for both consensus and execution values.
    assert.deepEqual(getTokenConfig('ethereum'), {
      balanceDecimals: 4,
      executionTokenSymbol: 'ETH',
      tokenSymbol: 'ETH',
    });

    // Confirm Gnosis displays GNO for consensus values and xDAI for execution values.
    assert.deepEqual(getTokenConfig('gnosis'), {
      balanceDecimals: 2,
      executionTokenSymbol: 'xDAI',
      tokenSymbol: 'GNO',
    });
  });

  it('uses Ethereum token labels and hides Gnosis-only claimable rewards', () => {
    // Render the overview with the default Ethereum chain environment.
    const markup = renderToStaticMarkup(
      <ClusterOverview
        cluster={cluster}
        gnoPrice={2500}
        onManage={noop}
        showManageButton={false}
        stats={stats}
      />,
    );

    // Confirm total balance uses ETH with four decimals.
    assert.match(markup, /96\.1235 ETH/);

    // Confirm effective balance keeps integer formatting with the ETH token.
    assert.match(markup, /96 ETH/);
    // Confirm claimable rewards are omitted because they are only available on Gnosis.
    assert.doesNotMatch(markup, /CLAIMABLE/);
    assert.doesNotMatch(markup, /0\.1235 ETH/);

    // Confirm old Gnosis labels are not rendered on Ethereum.
    assert.doesNotMatch(markup, /GNO/);
    assert.doesNotMatch(markup, /xDAI/);
  });
});

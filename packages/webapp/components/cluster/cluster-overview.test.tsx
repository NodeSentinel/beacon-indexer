import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ClusterOverview from './cluster-overview';
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
  it('uses Ethereum token labels and four decimals for balance and claimable only', () => {
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

    // Confirm total balance and claimable rewards use ETH with four decimals.
    assert.match(markup, /96\.1235 ETH/);
    assert.match(markup, /0\.1235 ETH/);

    // Confirm effective balance keeps integer formatting with the ETH token.
    assert.match(markup, /96 ETH/);

    // Confirm old Gnosis labels are not rendered on Ethereum.
    assert.doesNotMatch(markup, /GNO/);
    assert.doesNotMatch(markup, /xDAI/);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { countBatchDeliveryResults, splitRecipientsIntoBatches } from './send-batches.js';

test('splitRecipientsIntoBatches returns batches of ten and preserves recipient order', () => {
  // This case builds a recipient list large enough to require multiple batches.
  const recipients = Array.from({ length: 23 }, (_, index) => `${index + 1}`);

  // This call splits the recipients into the batch size used by broadcast sends.
  const batches = splitRecipientsIntoBatches(recipients, 10);

  // This assertion verifies the expected 10/10/3 batch layout.
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [10, 10, 3],
  );

  // This assertion verifies the helper keeps the original send order intact.
  assert.deepEqual(batches.flat(), recipients);
});

test('countBatchDeliveryResults treats rejected sends as failures instead of aborting the batch', () => {
  // This case simulates a mixed batch where one send rejects and the others still finish.
  const results: PromiseSettledResult<boolean>[] = [
    { status: 'fulfilled', value: true },
    { status: 'rejected', reason: new Error('telegram failure') },
    { status: 'fulfilled', value: false },
    { status: 'fulfilled', value: true },
  ];

  // This call counts the finished batch without throwing on the rejected send.
  const counts = countBatchDeliveryResults(results);

  // This assertion verifies successful deliveries are counted separately from all failures.
  assert.deepEqual(counts, {
    failedCount: 2,
    sentCount: 2,
  });
});

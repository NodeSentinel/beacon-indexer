import assert from 'node:assert/strict';
import test from 'node:test';

import { formatCommunicationPreviewHeader } from './list-format.js';

test('formatCommunicationPreviewHeader shows id description and send command', () => {
  // This communication represents one pending broadcast returned by the API.
  const communication = {
    id: 7,
    description: 'Maintenance window',
  };

  // This call builds the metadata message shown before the real preview body.
  const header = formatCommunicationPreviewHeader(communication);

  // This assertion verifies admins can identify and send the communication from the list.
  assert.equal(
    header,
    '<b>Communication #7</b>\nDescription: Maintenance window\nSend: /send_communication 7',
  );
});

test('formatCommunicationPreviewHeader escapes html in the communication description', () => {
  // This communication has characters that would be parsed as Telegram HTML.
  const communication = {
    id: 8,
    description: 'Alert <mainnet> & validators',
  };

  // This call protects metadata while leaving the real preview body to be sent separately.
  const header = formatCommunicationPreviewHeader(communication);

  // This assertion verifies the metadata message remains valid HTML.
  assert.equal(
    header,
    '<b>Communication #8</b>\nDescription: Alert &lt;mainnet&gt; &amp; validators\nSend: /send_communication 8',
  );
});

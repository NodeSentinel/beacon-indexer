import assert from 'node:assert/strict';
import test from 'node:test';

import { getAdminHelpMessage } from './admin.js';

test('getAdminHelpMessage documents the private admin commands', () => {
  // This call builds the hidden admin command helper text.
  const message = getAdminHelpMessage();

  // This assertion verifies the helper includes the create preview and send workflow.
  assert.match(message, /\/create_communication &lt;description&gt; &gt;&gt; &lt;message&gt;/);
  assert.match(message, /\/list_communications/);
  assert.match(message, /\/send_communication &lt;id&gt;/);
});

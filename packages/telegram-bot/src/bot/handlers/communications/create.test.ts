import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCreateCommunicationCommand } from './create-parser.js';

test('parseCreateCommunicationCommand parses description and message separated by double greater-than', () => {
  // This input matches the admin command format used to create pending communications.
  const commandText = '/create_communication Maintenance notice >> Validators will be monitored.';

  // This call extracts the communication fields without sending the communication.
  const parsed = parseCreateCommunicationCommand(commandText);

  // This assertion verifies both sides of the separator are trimmed and returned.
  assert.deepEqual(parsed, {
    description: 'Maintenance notice',
    message: 'Validators will be monitored.',
  });
});

test('parseCreateCommunicationCommand rejects commands without the double greater-than separator', () => {
  // This input omits the required separator between description and message.
  const commandText = '/create_communication Maintenance notice Validators will be monitored.';

  // This call validates the command format before any API request is made.
  const parsed = parseCreateCommunicationCommand(commandText);

  // This assertion verifies invalid input is represented as a missing parse result.
  assert.equal(parsed, null);
});

test('parseCreateCommunicationCommand rejects commands with an empty message', () => {
  // This input includes the separator but leaves the message side empty.
  const commandText = '/create_communication Maintenance notice >>   ';

  // This call validates that both required communication fields exist.
  const parsed = parseCreateCommunicationCommand(commandText);

  // This assertion verifies incomplete input is rejected.
  assert.equal(parsed, null);
});

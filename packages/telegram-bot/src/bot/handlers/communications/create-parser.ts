export interface ParsedCreateCommunicationCommand {
  description: string;
  message: string;
}

const CREATE_COMMUNICATION_SEPARATOR = '>>';

/**
 * Parses the communication fields from the /create_communication command text.
 */
export function parseCreateCommunicationCommand(
  text: string | undefined,
): ParsedCreateCommunicationCommand | null {
  if (!text) return null;

  const commandBody = text.replace(/^\/create_communication(?:@\S+)?\s*/u, '');
  const separatorIndex = commandBody.indexOf(CREATE_COMMUNICATION_SEPARATOR);

  if (separatorIndex === -1) return null;

  const description = commandBody.slice(0, separatorIndex).trim();
  const message = commandBody.slice(separatorIndex + CREATE_COMMUNICATION_SEPARATOR.length).trim();

  if (!description || !message) return null;

  return {
    description,
    message,
  };
}

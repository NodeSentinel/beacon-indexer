interface CommunicationPreview {
  id: number;
  description: string;
}

/**
 * Escapes text used inside Telegram HTML metadata messages.
 */
function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formats the metadata shown before a communication preview.
 */
export function formatCommunicationPreviewHeader(communication: CommunicationPreview) {
  return [
    `<b>Communication #${communication.id}</b>`,
    `Description: ${escapeHtml(communication.description)}`,
    `Send: /send_communication ${communication.id}`,
  ].join('\n');
}

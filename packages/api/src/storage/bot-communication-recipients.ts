export interface CommunicationTargeting {
  exclude: string[];
  onlyTo: string[];
}

/**
 * Resolves the final telegram ids for a communication.
 */
export function resolveCommunicationRecipients(
  broadcastTelegramIds: string[],
  targeting: CommunicationTargeting,
): string[] {
  // Use a set so exclusion checks stay simple and predictable.
  const excludedTelegramIds = new Set(targeting.exclude);

  // Use the targeted telegram ids directly when the communication specifies them.
  const recipientTelegramIds =
    targeting.onlyTo.length > 0 ? targeting.onlyTo : broadcastTelegramIds;

  // Exclusion always wins over the initial recipient list.
  return recipientTelegramIds.filter((telegramId) => !excludedTelegramIds.has(telegramId));
}

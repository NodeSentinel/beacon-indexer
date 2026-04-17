export interface CommunicationTargeting {
  exclude: string[];
  onlyTo: string[];
}

/**
 * Resolves the final audience for a communication.
 */
export function resolveCommunicationRecipients<T extends { id: string }>(
  users: T[],
  targeting: CommunicationTargeting,
): T[] {
  // Use sets so the inclusion and exclusion checks stay simple and predictable.
  const excludedUserIds = new Set(targeting.exclude);
  const onlyUserIds = new Set(targeting.onlyTo);

  return users.filter((user) => {
    // Exclusion always wins, even when the user also appears in onlyTo.
    if (excludedUserIds.has(user.id)) return false;

    // When onlyTo is empty, every notifiable user is eligible.
    if (onlyUserIds.size === 0) return true;

    // When onlyTo has values, only the listed users are eligible.
    return onlyUserIds.has(user.id);
  });
}

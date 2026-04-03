type ValidatorStatePayload = {
  clusterNames?: unknown;
  validatorIndex?: unknown;
};

const VALIDATOR_INACTIVE_NOTIFICATION_TYPE = 'validator.inactive';
const VALIDATOR_RECOVERED_NOTIFICATION_TYPE = 'validator.recovered';

export function formatNotificationMessage(type: string, payload: unknown): string {
  switch (type) {
    case VALIDATOR_INACTIVE_NOTIFICATION_TYPE:
      return formatValidatorStateMessage('inactive', payload);
    case VALIDATOR_RECOVERED_NOTIFICATION_TYPE:
      return formatValidatorStateMessage('active again', payload);
    default:
      return `Notification: ${type}`;
  }
}

function formatValidatorStateMessage(statusLabel: string, payload: unknown): string {
  const data = (payload ?? {}) as ValidatorStatePayload;
  const validatorIndex =
    typeof data.validatorIndex === 'number' || typeof data.validatorIndex === 'string'
      ? String(data.validatorIndex)
      : 'unknown';

  const clusterNames = Array.isArray(data.clusterNames)
    ? data.clusterNames.filter((name): name is string => typeof name === 'string')
    : [];

  if (clusterNames.length === 0) {
    return `Validator ${validatorIndex} is ${statusLabel}.`;
  }

  return `Validator ${validatorIndex} is ${statusLabel}.\nClusters: ${clusterNames.join(', ')}.`;
}

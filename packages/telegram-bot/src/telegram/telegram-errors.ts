const BLOCKED_ERROR_CODE = 403;
const SAME_MESSAGE_DESCRIPTION = 'Bad Request: message is not modified';

export function isBlockedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'error_code' in error &&
    (error as { error_code: number }).error_code === BLOCKED_ERROR_CODE
  );
}

export function isSameMessageError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'description' in error &&
    (error as { description: string }).description.startsWith(SAME_MESSAGE_DESCRIPTION)
  );
}

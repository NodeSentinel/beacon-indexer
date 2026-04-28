/**
 * Cleans machine context so it can be safely written to logs.
 */
export function cleanContextForLogging(context: unknown): Record<string, unknown> | undefined {
  if (!context || typeof context !== 'object') {
    return undefined;
  }

  const seen = new WeakSet();

  const cleanValue = (value: unknown): unknown => {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value !== 'object') {
      return value;
    }

    if (seen.has(value as object)) {
      return '[Circular]';
    }

    if (value instanceof Function) {
      return '[Function]';
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    if (Array.isArray(value)) {
      seen.add(value);
      return value.map((item) => cleanValue(item));
    }

    if (
      value instanceof Date ||
      value instanceof RegExp ||
      value instanceof Map ||
      value instanceof Set
    ) {
      return String(value);
    }

    const obj = value as Record<string, unknown>;
    if (
      '_originalClient' in obj ||
      'subscribe' in obj ||
      'getSnapshot' in obj ||
      'send' in obj ||
      'id' in obj
    ) {
      const safe: Record<string, unknown> = {};
      if ('id' in obj && typeof obj.id === 'string') {
        safe.id = obj.id;
      }
      if ('type' in obj && typeof obj.type === 'string') {
        safe.type = obj.type;
      }
      return safe;
    }

    seen.add(value);
    const cleanedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith('_') || key === 'subscribe' || key === 'send') {
        continue;
      }

      try {
        cleanedObj[key] = cleanValue(val);
      } catch {
        cleanedObj[key] = '[Non-serializable]';
      }
    }

    return cleanedObj;
  };

  try {
    const result = cleanValue(context);
    return typeof result === 'object' && result !== null && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

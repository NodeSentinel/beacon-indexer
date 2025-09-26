import { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import createLogger from '@/src/lib/pino.js';

// Create the HTTP logger using the existing createLogger function with blue color
const httpLogger = createLogger('HTTP', true, 'blue');

export function logRequest(request: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  // Log the request using the custom logger format
  httpLogger.info(`${request.method?.toUpperCase()} ${request.url}`);

  return request;
}

export function logResponse(response: AxiosResponse): AxiosResponse {
  // Log the response using the custom logger format
  const logLevel = response.status >= 400 ? 'error' : 'info';
  const message = `${response.status} ${response.config?.method?.toUpperCase()} ${response.config?.url}`;

  if (logLevel === 'error') {
    httpLogger.error(message, { statusCode: response.status });
  } else {
    httpLogger.info(message);
  }

  return response;
}

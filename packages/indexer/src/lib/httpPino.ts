import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

// NOTE: Using process.env directly instead of importing env.ts to avoid triggering
// full environment variable validation when this module is loaded.
// This is an infrastructure/logging module that should work independently of
// blockchain-specific environment variables.
import createLogger from '@/src/lib/pino.js';

// Extend Axios config to include metadata for timing and nodeType
interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  metadata?: {
    startTime?: number;
    nodeType?: 'full' | 'archive';
  };
}

const httpLogger = createLogger('HTTP');

/**
 * Extract endpoint path from a full URL
 * Returns just the path and query string, without the base URL
 */
function extractEndpointPath(url: string | undefined): string {
  if (!url) return 'unknown';
  try {
    const urlObj = new URL(url);
    return urlObj.pathname + urlObj.search;
  } catch {
    // If URL parsing fails, try to extract path manually
    const match = url.match(/https?:\/\/[^/]+(\/.*)/);
    return match ? match[1] : url;
  }
}

export function logRequest(request: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  // Store timestamp for duration calculation
  const extendedRequest = request as ExtendedAxiosRequestConfig;
  extendedRequest.metadata = extendedRequest.metadata || {};
  extendedRequest.metadata.startTime = Date.now();

  return request;
}

export function logResponse(response: AxiosResponse): AxiosResponse {
  // Calculate duration
  const extendedConfig = response.config as ExtendedAxiosRequestConfig | undefined;
  const startTime = extendedConfig?.metadata?.startTime;
  const duration = startTime ? Date.now() - startTime : undefined;
  const durationStr = duration ? `${duration}ms` : undefined;
  const nodeType = extendedConfig?.metadata?.nodeType;

  const isError = response.status >= 400;
  const isDebugLevel = process.env.LOG_LEVEL === 'debug';
  const endpoint = extractEndpointPath(response.config?.url);
  const statusText = response.statusText || '';
  const errorMessage = statusText ? ` - ${statusText}` : '';
  const nodeTypePrefix = nodeType ? `[${nodeType.toUpperCase()}] ` : '';
  const message = `${nodeTypePrefix}${response.status} ${response.config?.method?.toUpperCase()} ${endpoint}${errorMessage}`;

  // Always log errors, or log all responses if LOG_LEVEL is debug
  if (isError || isDebugLevel) {
    if (isError) {
      const logData: {
        statusCode: number;
        message?: string;
        duration?: string;
        nodeType?: string;
      } = {
        statusCode: response.status,
      };
      // Include response data message if available
      if (response.data && typeof response.data === 'object' && 'message' in response.data) {
        logData.message = String(response.data.message);
      } else if (statusText) {
        logData.message = statusText;
      }
      if (durationStr) {
        logData.duration = durationStr;
      }
      if (nodeType) {
        logData.nodeType = nodeType;
      }
      httpLogger.error(message, logData);
    } else {
      // Success responses only in DEBUG mode
      const logData: { duration?: string; nodeType?: string } = {};
      if (durationStr) {
        logData.duration = durationStr;
      }
      if (nodeType) {
        logData.nodeType = nodeType;
      }
      httpLogger.debug(message, Object.keys(logData).length > 0 ? logData : undefined);
    }
  }

  return response;
}

export function logError(error: AxiosError): Promise<never> {
  // Calculate duration
  const extendedConfig = error.config as ExtendedAxiosRequestConfig | undefined;
  const startTime = extendedConfig?.metadata?.startTime;
  const duration = startTime ? Date.now() - startTime : undefined;
  const durationStr = duration ? `${duration}ms` : undefined;
  const nodeType = extendedConfig?.metadata?.nodeType;

  // Log the error with endpoint information
  const endpoint = extractEndpointPath(error.config?.url || error.request?.url);
  const statusCode = error.response?.status;
  const method = error.config?.method?.toUpperCase() || 'UNKNOWN';
  const statusText = error.response?.statusText || '';
  const errorMessage = error.message || statusText || '';
  const nodeTypePrefix = nodeType ? `[${nodeType.toUpperCase()}] ` : '';
  const message = statusCode
    ? `${nodeTypePrefix}${statusCode} ${method} ${endpoint} - ${errorMessage}`
    : `${nodeTypePrefix}ERROR ${method} ${endpoint} - ${errorMessage}`;

  const logData: {
    statusCode?: number;
    error: string;
    message?: string;
    duration?: string;
    nodeType?: string;
  } = {
    error: error.message,
  };

  if (statusCode) {
    logData.statusCode = statusCode;
  }

  // Include response data message if available
  if (error.response?.data) {
    if (typeof error.response.data === 'object' && 'message' in error.response.data) {
      logData.message = String(error.response.data.message);
    } else if (typeof error.response.data === 'string') {
      logData.message = error.response.data;
    }
  } else if (statusText) {
    logData.message = statusText;
  }

  if (durationStr) {
    logData.duration = durationStr;
  }

  if (nodeType) {
    logData.nodeType = nodeType;
  }

  // Always log errors at ERROR level
  httpLogger.error(message, logData);

  return Promise.reject(error);
}

import axios, { InternalAxiosRequestConfig } from 'axios';

import { logRequest, logResponse } from '@/src/lib/httpPino.js';
import { limitRequests } from '@/src/services/execution/utils/rateLimiter.js';

export const instance = axios.create();

// interceptor to limit requests
instance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  await limitRequests(() => Promise.resolve());
  logRequest(config);
  return config;
});

instance.interceptors.response.use(logResponse);

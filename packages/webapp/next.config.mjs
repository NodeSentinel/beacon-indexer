import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

/** @type {import('next').NextConfig} */
const createNextConfig = (phase) => {
  const isDevelopment = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    eslint: {
      ignoreDuringBuilds: true,
    },
    typescript: {
      ignoreBuildErrors: true,
    },
    images: {
      unoptimized: true,
    },
    async headers() {
      // Allow localhost connections in development for API calls
      const connectSrc = isDevelopment
        ? "connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:*"
        : "connect-src 'self' https: wss:";

      return [
        {
          // Apply headers to all routes
          source: '/:path*',
          headers: [
            {
              key: 'Content-Security-Policy',
              value: [
                "default-src 'self'",
                "img-src 'self' data: https:",
                "style-src 'self' 'unsafe-inline'",
                "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
                'frame-ancestors https://*.telegram.org https://web.telegram.org https://*.web.telegram.org',
                connectSrc,
                "font-src 'self' data:",
              ].join('; '),
            },
            {
              key: 'Referrer-Policy',
              value: 'strict-origin-when-cross-origin',
            },
            {
              key: 'Permissions-Policy',
              value: 'camera=(), microphone=(), geolocation=()',
            },
          ],
        },
        {
          // Cache static assets
          source: '/fonts/:path*',
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
        },
        {
          // Cache images
          source: '/_next/image/:path*',
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
        },
      ];
    },
  };
};

export default createNextConfig;

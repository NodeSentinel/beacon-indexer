import crypto from 'node:crypto';

import { ORPCError } from '@orpc/server';

import { AuthStrategy, type TokenUser } from '../types.js';

import { env } from '@/config/env.js';

/**
 * Simple token authentication strategy
 * In production, you might want to use JWT or validate against a database
 */
export async function authenticateToken(token: string): Promise<TokenUser> {
  if (!token) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'Missing authentication token',
    });
  }

  // Remove 'Bearer ' prefix if present
  const cleanToken = token.replace(/^Bearer\s+/i, '');

  try {
    // Simple example: validate token format and extract user ID
    // In production, verify JWT signature or check database
    const [userId, signature] = cleanToken.split('.');

    if (!userId || !signature) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'Invalid token format',
      });
    }

    // Verify signature (simple example - use JWT in production)
    const expectedSignature = crypto
      .createHmac('sha256', env.API_TOKEN_SECRET)
      .update(userId)
      .digest('hex')
      .substring(0, 16);

    if (signature !== expectedSignature) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'Invalid token signature',
      });
    }

    return {
      id: userId,
      userId,
      strategy: AuthStrategy.TOKEN,
      metadata: {
        scopes: ['read', 'write'], // You can implement scope-based permissions
      },
    };
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }

    throw new ORPCError('UNAUTHORIZED', {
      message: 'Invalid authentication token',
    });
  }
}

/**
 * Utility to generate a token for testing
 * In production, implement proper JWT generation
 */
export function generateToken(userId: string): string {
  const signature = crypto
    .createHmac('sha256', env.API_TOKEN_SECRET)
    .update(userId)
    .digest('hex')
    .substring(0, 16);

  return `${userId}.${signature}`;
}

import { ORPCError } from '@orpc/server';
import { z } from 'zod';

import { apiKeyProcedure } from '@/lib/procedures.js';
import { botProcedure } from '@/routers/bot/procedures.js';
import {
  BotCommunicationDetailsSchema,
  BotCommunicationSchema,
  BotCommunicationSentSchema,
  CommunicationIdParamSchema,
  CreateBotCommunicationSchema,
} from '@/routers/bot/schemas.js';
import { resolveCommunicationRecipients } from '@/storage/bot-communication-recipients.js';
import { BotCommunicationsStorage } from '@/storage/bot-communications.js';
import { ApiResponseSchema, errorResponse, successResponse } from '@/utils/response.js';

const BotCommunicationResponseSchema = ApiResponseSchema(BotCommunicationSchema);
type BotCommunicationResponse = z.infer<typeof BotCommunicationResponseSchema>;

const BotCommunicationDetailsResponseSchema = ApiResponseSchema(BotCommunicationDetailsSchema);
type BotCommunicationDetailsResponse = z.infer<typeof BotCommunicationDetailsResponseSchema>;

const BotCommunicationSentResponseSchema = ApiResponseSchema(BotCommunicationSentSchema);
type BotCommunicationSentResponse = z.infer<typeof BotCommunicationSentResponseSchema>;

/**
 * Maps a communication row into the API response shape.
 */
function mapCommunication(communication: {
  id: number;
  description: string;
  message: string;
  exclude: string[];
  onlyTo: string[];
  sent: boolean;
  sentAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: communication.id,
    description: communication.description,
    message: communication.message,
    exclude: communication.exclude,
    onlyTo: communication.onlyTo,
    sent: communication.sent,
    sentAt: communication.sentAt?.toISOString() ?? null,
    createdAt: communication.createdAt.toISOString(),
  };
}

/**
 * Creates a new pending communication through API key authentication.
 * POST /bot/communications
 */
export const createBotCommunication = apiKeyProcedure
  .route({ method: 'POST', path: '/bot/communications' })
  .input(CreateBotCommunicationSchema)
  .output(BotCommunicationResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotCommunicationsStorage();
      const communication = await storage.create(input);

      return successResponse(mapCommunication(communication)) as BotCommunicationResponse;
    } catch (error) {
      return errorResponse(
        'CREATE_COMMUNICATION_ERROR',
        error instanceof Error ? error.message : 'Failed to create communication',
      ) as BotCommunicationResponse;
    }
  });

/**
 * Returns one communication plus the users that should receive it.
 * GET /bot/communications/{id}
 */
export const getBotCommunication = botProcedure
  .route({ method: 'GET', path: '/bot/communications/{id}' })
  .input(CommunicationIdParamSchema)
  .output(BotCommunicationDetailsResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotCommunicationsStorage();
      const communication = await storage.findById(input.id);

      if (!communication) {
        throw new ORPCError('NOT_FOUND', {
          message: `Communication ${input.id} was not found`,
        });
      }

      // Load broadcast recipients only when the communication does not target explicit telegram ids.
      const broadcastTelegramIds =
        communication.onlyTo.length > 0 ? [] : await storage.listBroadcastTelegramIds();
      const recipients = resolveCommunicationRecipients(broadcastTelegramIds, communication);

      return successResponse({
        ...mapCommunication(communication),
        recipients,
      }) as BotCommunicationDetailsResponse;
    } catch (error) {
      return errorResponse(
        'GET_COMMUNICATION_ERROR',
        error instanceof Error ? error.message : 'Failed to get communication',
      ) as BotCommunicationDetailsResponse;
    }
  });

/**
 * Marks a communication as sent after the bot finishes delivery attempts.
 * PUT /bot/communications/{id}/sent
 */
export const markBotCommunicationSent = botProcedure
  .route({ method: 'PUT', path: '/bot/communications/{id}/sent' })
  .input(CommunicationIdParamSchema)
  .output(BotCommunicationSentResponseSchema)
  .handler(async ({ input }) => {
    try {
      const storage = new BotCommunicationsStorage();
      const updated = await storage.markSent(input.id);

      if (!updated) {
        throw new ORPCError('CONFLICT', {
          message: `Communication ${input.id} was already sent`,
        });
      }

      return successResponse({
        id: input.id,
        sent: true,
      }) as BotCommunicationSentResponse;
    } catch (error) {
      return errorResponse(
        'MARK_COMMUNICATION_SENT_ERROR',
        error instanceof Error ? error.message : 'Failed to mark communication as sent',
      ) as BotCommunicationSentResponse;
    }
  });

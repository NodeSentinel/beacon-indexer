/* eslint-disable @typescript-eslint/no-explicit-any */
import { ORPCError } from '@orpc/server';
import { z } from 'zod';

import type { ApiDependencies } from '@/dependencies.js';
import { createBotProcedure } from '@/routers/bot/procedures.js';
import {
  BotCommunicationDetailsSchema,
  BotCommunicationSchema,
  BotCommunicationSentSchema,
  CommunicationIdParamSchema,
  CreateBotCommunicationSchema,
} from '@/routers/bot/schemas.js';
import { resolveCommunicationRecipients } from '@/storage/bot-communication-recipients.js';
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
 * Creates the bot communications routes.
 */
export function createBotCommunicationsRoutes(
  params: Pick<ApiDependencies, 'botCommunicationsStorage' | 'procedures'>,
) {
  const botProcedure = createBotProcedure(params.procedures);
  const { apiKeyProcedure } = params.procedures;

  const createBotCommunication = apiKeyProcedure
    .route({ method: 'POST', path: '/bot/communications' })
    .input(CreateBotCommunicationSchema)
    .output(BotCommunicationResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        return successResponse(
          mapCommunication(await params.botCommunicationsStorage.create(input)),
        ) as BotCommunicationResponse;
      } catch (error) {
        return errorResponse(
          'CREATE_COMMUNICATION_ERROR',
          error instanceof Error ? error.message : 'Failed to create communication',
        ) as BotCommunicationResponse;
      }
    });

  const getBotCommunication = botProcedure
    .route({ method: 'GET', path: '/bot/communications/{id}' })
    .input(CommunicationIdParamSchema)
    .output(BotCommunicationDetailsResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        const communication = await params.botCommunicationsStorage.findById(input.id);

        if (!communication) {
          throw new ORPCError('NOT_FOUND', {
            message: `Communication ${input.id} was not found`,
          });
        }

        const broadcastTelegramIds =
          communication.onlyTo.length > 0
            ? []
            : await params.botCommunicationsStorage.listBroadcastTelegramIds();

        return successResponse({
          ...mapCommunication(communication),
          recipients: resolveCommunicationRecipients(broadcastTelegramIds, communication),
        }) as BotCommunicationDetailsResponse;
      } catch (error) {
        return errorResponse(
          'GET_COMMUNICATION_ERROR',
          error instanceof Error ? error.message : 'Failed to get communication',
        ) as BotCommunicationDetailsResponse;
      }
    });

  const markBotCommunicationSent = botProcedure
    .route({ method: 'PUT', path: '/bot/communications/{id}/sent' })
    .input(CommunicationIdParamSchema)
    .output(BotCommunicationSentResponseSchema)
    .handler(async ({ input }: any) => {
      try {
        const updated = await params.botCommunicationsStorage.markSent(input.id);

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

  return {
    createBotCommunication,
    getBotCommunication,
    markBotCommunicationSent,
  };
}

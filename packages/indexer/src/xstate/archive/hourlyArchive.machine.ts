import { setup, fromPromise, assertEvent } from 'xstate';

import { HourlyArchiveController } from '@/src/services/consensus/controllers/hourlyArchive.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

/**
 * @fileoverview The hourly archive machine is responsible for archiving hourly validator data.
 *
 * It is triggered by EPOCH_PROCESSED events from the epoch orchestrator (on each processed epoch).
 * The machine handles:
 * - Event-driven triggering (no polling)
 * - Non-overlapping execution (ignores events while archiving)
 * - Readiness validation and archive execution
 * - Error handling
 */

export const hourlyArchiveMachine = setup({
  types: {} as {
    context: {
      hourlyArchiveController: HourlyArchiveController;
    };
    events: { type: 'EPOCH_PROCESSED'; epoch: number };
    input: {
      hourlyArchiveController: HourlyArchiveController;
    };
  },
  actors: {
    runArchive: fromPromise(
      async ({ input }: { input: { controller: HourlyArchiveController } }) => {
        return await input.controller.archive();
      },
    ),
  },
  guards: {
    archiveSucceeded: ({ event }) => {
      if (!('output' in event)) return false;
      const output = event.output as Date | null;
      return output !== null;
    },
  },
}).createMachine({
  id: 'HourlyArchive',
  initial: 'idle',
  context: ({ input }) => ({
    hourlyArchiveController: input.hourlyArchiveController,
  }),
  states: {
    idle: {
      description: 'Waiting for EPOCH_PROCESSED event',
      on: {
        EPOCH_PROCESSED: {
          target: 'archiving',
          actions: [
            pinoLog(
              ({ event }) =>
                `Received EPOCH_PROCESSED for epoch ${event.epoch}, checking archive eligibility`,
              'HourlyArchive',
            ),
          ],
        },
      },
    },
    archiving: {
      description: 'Archiving the oldest eligible hour',
      invoke: {
        src: 'runArchive',
        input: ({ context }) => {
          return {
            controller: context.hourlyArchiveController,
          };
        },
        onDone: [
          {
            guard: 'archiveSucceeded',
            target: 'idle',
            actions: [
              pinoLog(({ event }) => {
                const hour = event.output as Date;
                return `Archive completed: hour=${hour.toISOString()}`;
              }, 'HourlyArchive'),
            ],
          },
          {
            target: 'idle',
            actions: [
              pinoLog(
                () => 'No eligible hour found (partitions not ready or cutoff not reached)',
                'HourlyArchive',
              ),
            ],
          },
        ],
        onError: {
          target: 'idle',
          actions: [
            pinoLog(({ event }) => `Archive error: ${event.error}`, 'HourlyArchive', 'error'),
          ],
        },
      },
      // While archiving, ignore additional EPOCH_PROCESSED events (non-overlap)
      on: {
        EPOCH_PROCESSED: {
          actions: pinoLog(
            ({ event }) =>
              `Ignoring EPOCH_PROCESSED for epoch ${event.epoch} - archive already in progress`,
            'HourlyArchive',
            'debug',
          ),
        },
      },
    },
  },
});

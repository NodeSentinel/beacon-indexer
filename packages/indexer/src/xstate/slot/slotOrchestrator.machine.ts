/**
 * @fileoverview The slot orchestrator is a state machine that is responsible for orchestrating the processing of slots within an epoch.
 *
 * It is responsible for:
 * - Finding the next unprocessed slot via SlotController
 * - Spawning slot processor machines sequentially
 * - Monitoring slot completion
 * - Moving to the next slot until all slots are processed
 * - Safely handling the case where slots haven't been created yet
 *
 * This machine processes slots one at a time within an epoch.
 */

import { setup, assign, stopChild, sendParent, ActorRefFrom, fromPromise } from 'xstate';

import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { getEpochSlots } from '@/src/services/consensus/utils/misc.js';
import { logActor, logRemoveMachine } from '@/src/xstate/multiMachineLogger.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';
import { slotProcessorMachine } from '@/src/xstate/slot/slotProcessor.machine.js';
import { sendTelegramError } from '@/src/xstate/telegramAlert.js';

export interface SlotOrchestratorContext {
  epoch: number;
  startSlot: number;
  endSlot: number;
  currentSlot: number | null;
  lookbackSlot: number;

  slotActor: ActorRefFrom<typeof slotProcessorMachine> | null;

  slotController: SlotController;
}

export interface SlotOrchestratorInput {
  epoch: number;
  lookbackSlot: number;
  slotController: SlotController;
}

// Extract the SLOTS_COMPLETED event type for reuse in other machines
export type SlotsCompletedEvent = { type: 'SLOTS_COMPLETED'; epoch: number };

export type SlotOrchestratorEvents = SlotsCompletedEvent | { type: 'SLOT_COMPLETED' };

export const slotOrchestratorMachine = setup({
  types: {} as {
    context: SlotOrchestratorContext;
    events: SlotOrchestratorEvents;
    input: SlotOrchestratorInput;
  },
  actors: {
    slotProcessor: slotProcessorMachine,
    findNextSlotStatus: fromPromise(
      async ({
        input,
      }: {
        input: { slotController: SlotController; startSlot: number; endSlot: number };
      }) => {
        return input.slotController.getEpochSlotsStatus(input.startSlot, input.endSlot);
      },
    ),
  },
  guards: {
    hasNextSlotToProcess: (_, params: { nextSlotToProcess: number | null }) => {
      return params.nextSlotToProcess !== null;
    },
    allSlotsProcessed: (_, params: { allSlotsProcessed: boolean }) => {
      return params.allSlotsProcessed === true;
    },
  },
  delays: {},
}).createMachine({
  id: 'SlotOrchestrator',
  initial: 'findingNextSlot',
  context: ({ input }) => {
    const { startSlot: _startSlot, endSlot } = getEpochSlots(input.epoch);
    const startSlot = Math.max(_startSlot, input.lookbackSlot);

    return {
      epoch: input.epoch,
      startSlot,
      endSlot,
      currentSlot: null,
      slotActor: null,
      lookbackSlot: input.lookbackSlot,
      slotController: input.slotController,
    };
  },
  states: {
    findingNextSlot: {
      entry: pinoLog(
        ({ context }) => `Finding next slot to process for epoch ${context.epoch}`,
        'SlotOrchestrator',
      ),
      invoke: {
        src: 'findNextSlotStatus',
        input: ({ context }) => ({
          slotController: context.slotController,
          startSlot: context.startSlot,
          endSlot: context.endSlot,
        }),
        onDone: [
          {
            // Case 1: There's a slot to process
            guard: {
              type: 'hasNextSlotToProcess',
              params: ({ event }) => ({
                nextSlotToProcess: event.output.nextSlotToProcess,
              }),
            },
            target: 'spawningSlotProcessor',
            actions: assign({
              currentSlot: ({ event }) => event.output.nextSlotToProcess,
            }),
          },
          {
            // Case 2: No slot to process and all slots are processed
            guard: {
              type: 'allSlotsProcessed',
              params: ({ event }) => ({
                allSlotsProcessed: event.output.allSlotsProcessed,
              }),
            },
            target: 'allSlotsComplete',
            actions: pinoLog(
              ({ context }) => `All slots processed for epoch ${context.epoch}`,
              'SlotOrchestrator',
            ),
          },
          {
            // Case 3: No slot to process but not all slots are processed (slots not created yet)
            target: 'errorSlotsNotCreated',
            actions: pinoLog(
              ({ context }) =>
                `No slots available yet for epoch ${context.epoch}, waiting for slots to be created`,
              'SlotOrchestrator',
              'warn',
            ),
          },
        ],
        onError: {
          actions: [
            pinoLog(
              ({ context, event }) =>
                `error finding next slot to process for epoch ${context.epoch}: ${event.error}`,
              'SlotOrchestrator',
              'error',
            ),
            sendTelegramError(
              ({ context }) => `Error finding next slot to process for epoch ${context.epoch}`,
              'SlotOrchestrator',
            ),
          ],
        },
      },
    },

    errorSlotsNotCreated: {
      entry: pinoLog(
        ({ context }) => `No slots found for epoch ${context.epoch}`,
        'SlotOrchestrator',
        'error',
      ),
    },

    spawningSlotProcessor: {
      entry: [
        assign({
          slotActor: ({ context, spawn }) => {
            const slotId = `slotProcessor:${context.epoch}:${context.currentSlot}`;

            const actor = spawn('slotProcessor', {
              id: slotId,
              input: {
                epoch: context.epoch,
                slot: context.currentSlot!,
                lookbackSlot: context.lookbackSlot,
                slotController: context.slotController,
              },
            });

            // Automatically log the actor's state and context
            logActor(actor, slotId);

            return actor;
          },
        }),
        pinoLog(
          ({ context }) =>
            `Spawning slot processor for slot ${context.currentSlot} in epoch ${context.epoch}`,
          'SlotOrchestrator',
        ),
      ],
      on: {
        SLOT_COMPLETED: {
          target: 'slotComplete',
          actions: [
            pinoLog(
              ({ context }) => `Slot ${context.currentSlot} completed for epoch ${context.epoch}`,
              'SlotOrchestrator',
            ),
            ({ context }) => {
              logRemoveMachine(context.slotActor?.id || '', 'SLOT_COMPLETED');
            },
            stopChild(({ context }) => context.slotActor?.id || ''),
            assign({
              slotActor: null,
              currentSlot: null,
            }),
          ],
        },
      },
    },

    slotComplete: {
      // Immediately go back to finding the next slot
      always: {
        target: 'findingNextSlot',
      },
    },

    allSlotsComplete: {
      entry: [
        pinoLog(
          ({ context }) => `All slots complete for epoch ${context.epoch}`,
          'SlotOrchestrator',
        ),
        sendParent(({ context }) => ({
          type: 'SLOTS_COMPLETED',
          epoch: context.epoch,
        })),
      ],
      type: 'final',
    },
  },
});

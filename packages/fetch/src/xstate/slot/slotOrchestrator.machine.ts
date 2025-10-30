import { setup, assign, stopChild, sendParent, ActorRefFrom } from 'xstate';

import { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { getEpochSlots } from '@/src/services/consensus/utils/misc.js';
import { logActor, logRemoveMachine } from '@/src/xstate/multiMachineLogger.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';
import { findMinUnprocessedSlotInEpoch } from '@/src/xstate/slot/slot.actors.js';
import { slotProcessorMachine } from '@/src/xstate/slot/slotProcessor.machine.js';

export interface SlotOrchestratorContext {
  epoch: number;
  startSlot: number;
  endSlot: number;
  currentSlot: number;
  slotActor: ActorRefFrom<typeof slotProcessorMachine> | null;
  lookbackSlot: number;
  slotDuration: number;
  slotController: SlotController;
}

export interface SlotOrchestratorInput {
  epoch: number;
  lookbackSlot: number;
  slotDuration: number;
  slotController: SlotController;
}

// Extract the SLOTS_COMPLETED event type for reuse in other machines
export type SlotsCompletedEvent = { type: 'SLOTS_COMPLETED'; epoch: number };

export type SlotOrchestratorEvents =
  | SlotsCompletedEvent
  | { type: 'SLOT_COMPLETED' }
  | { type: 'NEXT_SLOT_FOUND'; nextSlot: number };

/**
 * @fileoverview The slot orchestrator is a state machine that is responsible for orchestrating the processing of slots within an epoch.
 *
 * It is responsible for:
 * - Getting all slots for the epoch
 * - Finding the next unprocessed slot
 * - Spawning slot processor machines sequentially
 * - Monitoring slot completion
 * - Moving to the next slot until all slots are processed
 *
 * This machine processes slots one at a time within an epoch.
 */

export const slotOrchestratorMachine = setup({
  types: {} as {
    context: SlotOrchestratorContext;
    events: SlotOrchestratorEvents;
    input: SlotOrchestratorInput;
  },
  actors: {
    slotProcessor: slotProcessorMachine,
    findMinUnprocessedSlotInEpoch,
  },
  guards: {
    hasSlotToProcess: ({ context }) => context.currentSlot <= context.endSlot,
  },
  actions: {
    sendEvent_slotsCompleted: sendParent(({ context }) => ({
      type: 'SLOTS_COMPLETED',
      epoch: context.epoch,
    })),
    spawn_slotProcessor: assign({
      slotActor: ({ context, spawn }) => {
        const slotId = `slotProcessor:${context.epoch}:${context.currentSlot}`;

        const actor = spawn('slotProcessor', {
          id: slotId,
          input: {
            epoch: context.epoch,
            slot: context.currentSlot,
            slotDuration: context.slotDuration,
            lookbackSlot: context.lookbackSlot,
            slotController: context.slotController,
          },
        });

        // Automatically log the actor's state and context
        logActor(actor, slotId);

        return actor;
      },
    }),
    stopSlotProcessor: stopChild(({ context }) => context.slotActor?.id || ''),
    assign_resetActorAndIncrementSlot: assign({
      slotActor: null,
      currentSlot: ({ context }) => context.currentSlot! + 1,
    }),
    removeMachineLog: ({ context }) => {
      logRemoveMachine(context.slotActor?.id || '', 'SLOT_COMPLETED');
    },
  },
}).createMachine({
  id: 'SlotOrchestrator',
  initial: 'spawningSlotProcessor',
  context: ({ input }) => {
    const { startSlot: _startSlot, endSlot } = getEpochSlots(input.epoch);
    const startSlot = Math.max(_startSlot, input.lookbackSlot);

    return {
      epoch: input.epoch,
      startSlot,
      endSlot,
      currentSlot: startSlot,
      slotActor: null,
      lookbackSlot: input.lookbackSlot,
      slotDuration: input.slotDuration,
      slotController: input.slotController,
    };
  },
  states: {
    spawningSlotProcessor: {
      entry: [
        'spawn_slotProcessor',
        pinoLog(
          ({ context }) => `Spawning slot processor for epoch ${context.epoch}`,
          'SlotOrchestrator',
        ),
      ],
      on: {
        SLOT_COMPLETED: {
          target: 'slotComplete',
          actions: [
            pinoLog(
              ({ context }) => `Slot completed for epoch ${context.epoch}`,
              'SlotOrchestrator',
            ),
            'removeMachineLog',
            'stopSlotProcessor',
            'assign_resetActorAndIncrementSlot',
          ],
        },
      },
    },

    slotComplete: {
      entry: pinoLog(
        ({ context }) => `Slot complete for epoch ${context.epoch}`,
        'SlotOrchestrator',
      ),

      always: [
        {
          guard: 'hasSlotToProcess',
          target: 'spawningSlotProcessor',
        },
        {
          target: 'allSlotsComplete',
        },
      ],
    },

    allSlotsComplete: {
      entry: ['sendEvent_slotsCompleted'],
      type: 'final',
    },
  },
});

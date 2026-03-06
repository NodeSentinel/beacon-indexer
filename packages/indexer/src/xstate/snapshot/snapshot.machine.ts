import { setup, fromPromise, assign } from 'xstate';

import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

type SnapshotContext = {
  snapshotController: SnapshotController;
  slotDuration: number;
  slotsPerEpoch: number;
  maxAttestationDelay: number;
  delaySlotsToHead: number;
  missedAttestationsForInactivity: number;
  // In-memory tracking (null = never updated, forces first run)
  lastProcessedSlot: number | null;
  lastEpochUpdate: number | null;
  last1dUpdate: number | null;
  last1wUpdate: number | null;
  last1mUpdate: number | null;
};

type TickResult = {
  updatedLevels: string[];
  lastProcessedSlot: number | null;
  lastEpochUpdate: number | null;
  last1dUpdate: number | null;
  last1wUpdate: number | null;
  last1mUpdate: number | null;
};

const INTERVAL_1D = 30 * 60 * 1000; // 30 minutes
const INTERVAL_1W = 3 * 60 * 60 * 1000; // 3 hours
const INTERVAL_1M = 6 * 60 * 60 * 1000; // 6 hours

export const snapshotMachine = setup({
  types: {} as {
    context: SnapshotContext;
    input: {
      snapshotController: SnapshotController;
      slotDuration: number;
      slotsPerEpoch: number;
      maxAttestationDelay: number;
      delaySlotsToHead: number;
      missedAttestationsForInactivity: number;
    };
  },
  delays: {
    slotDuration: ({ context }) => context.slotDuration,
  },
  actors: {
    runTick: fromPromise(async ({ input }: { input: { context: SnapshotContext } }) => {
      const ctx = input.context;
      const controller = ctx.snapshotController;
      const now = Date.now();
      const updatedLevels: string[] = [];

      let lastEpochUpdate = ctx.lastEpochUpdate;
      let last1dUpdate = ctx.last1dUpdate;
      let last1wUpdate = ctx.last1wUpdate;
      let last1mUpdate = ctx.last1mUpdate;

      // Level 1: Attestations + inactivity (every tick)
      await controller.updateAttestationsAndStatus({
        slotsPerEpoch: ctx.slotsPerEpoch,
        maxAttestationDelay: ctx.maxAttestationDelay,
        delaySlotsToHead: ctx.delaySlotsToHead,
        missedAttestationsForInactivity: ctx.missedAttestationsForInactivity,
      });
      updatedLevels.push('attestations');

      // Level 2 + 3: Balances + 1h performance (every epoch)
      // On first run (null) or when enough time has passed for a new epoch
      const epochDuration = ctx.slotDuration * ctx.slotsPerEpoch;
      if (lastEpochUpdate === null || now - lastEpochUpdate >= epochDuration) {
        await controller.updateBalances();
        updatedLevels.push('balances');

        await controller.updatePerformance1h(ctx.maxAttestationDelay);
        updatedLevels.push('1h');

        lastEpochUpdate = now;
      }

      // Level 4: 1d performance (every 30 min)
      if (last1dUpdate === null || now - last1dUpdate >= INTERVAL_1D) {
        await controller.updatePerformance1d();
        last1dUpdate = now;
        updatedLevels.push('1d');
      }

      // Level 5: 1w performance (every 3h)
      if (last1wUpdate === null || now - last1wUpdate >= INTERVAL_1W) {
        await controller.updatePerformance1w();
        last1wUpdate = now;
        updatedLevels.push('1w');
      }

      // Level 6: 1m performance (every 6h)
      if (last1mUpdate === null || now - last1mUpdate >= INTERVAL_1M) {
        await controller.updatePerformance1m();
        last1mUpdate = now;
        updatedLevels.push('1m');
      }

      return {
        updatedLevels,
        lastProcessedSlot: ctx.lastProcessedSlot,
        lastEpochUpdate,
        last1dUpdate,
        last1wUpdate,
        last1mUpdate,
      } satisfies TickResult;
    }),
  },
}).createMachine({
  id: 'Snapshot',
  initial: 'waiting',
  context: ({ input }) => ({
    snapshotController: input.snapshotController,
    slotDuration: input.slotDuration,
    slotsPerEpoch: input.slotsPerEpoch,
    maxAttestationDelay: input.maxAttestationDelay,
    delaySlotsToHead: input.delaySlotsToHead,
    missedAttestationsForInactivity: input.missedAttestationsForInactivity,
    lastProcessedSlot: null,
    lastEpochUpdate: null,
    last1dUpdate: null,
    last1wUpdate: null,
    last1mUpdate: null,
  }),
  states: {
    waiting: {
      after: {
        slotDuration: {
          target: 'ticking',
        },
      },
    },
    ticking: {
      invoke: {
        src: 'runTick',
        input: ({ context }) => ({ context }),
        onDone: {
          target: 'waiting',
          actions: [
            assign({
              lastProcessedSlot: ({ event }) => event.output.lastProcessedSlot,
              lastEpochUpdate: ({ event }) => event.output.lastEpochUpdate,
              last1dUpdate: ({ event }) => event.output.last1dUpdate,
              last1wUpdate: ({ event }) => event.output.last1wUpdate,
              last1mUpdate: ({ event }) => event.output.last1mUpdate,
            }),
            pinoLog(({ event }) => {
              const levels = event.output.updatedLevels;
              return `Snapshot tick: updated [${levels.join(', ')}]`;
            }, 'Snapshot'),
          ],
        },
        onError: {
          target: 'waiting',
          actions: [
            pinoLog(({ event }) => `Snapshot tick error: ${event.error}`, 'Snapshot', 'error'),
          ],
        },
      },
    },
  },
});

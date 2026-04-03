import type { Chain } from '@beacon-indexer/beacon-utils';
import { setup, fromPromise, assign, sendTo, ActorRefFrom } from 'xstate';

import { SnapshotController } from '@/src/services/consensus/controllers/snapshot.js';
import { incidentsMachine } from '@/src/xstate/incidents/incidents.machine.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

type SnapshotContext = {
  snapshotController: SnapshotController;
  incidentsActor: ActorRefFrom<typeof incidentsMachine>;
  slotDuration: number;
  slotsPerEpoch: number;
  chain: Chain;
  maxAttestationDelay: number;
  delaySlotsToHead: number;
  missedAttestationsForInactivity: number;
  // In-memory tracking (null = never updated, forces first run)
  lastProcessedSlot: number | null;
  lastEpochUpdate: number | null;
  lastDUpdate: number | null;
  lastWUpdate: number | null;
  lastMUpdate: number | null;
  lastNewValidatorCheck: number | null;
};

type TickResult = {
  updatedLevels: string[];
  lastProcessedSlot: number | null;
  lastEpochUpdate: number | null;
  lastDUpdate: number | null;
  lastWUpdate: number | null;
  lastMUpdate: number | null;
  lastNewValidatorCheck: number | null;
};

const INTERVAL_NEW_VALIDATOR_CHECK = 30 * 1000; // 30 seconds
const INTERVAL_D = 30 * 60 * 1000; // 30 minutes
const INTERVAL_W = 3 * 60 * 60 * 1000; // 3 hours
const INTERVAL_M = 6 * 60 * 60 * 1000; // 6 hours

const runTick = fromPromise(async ({ input }: { input: { context: SnapshotContext } }) => {
  const ctx = input.context;
  const controller = ctx.snapshotController;
  const now = Date.now();
  const updatedLevels: string[] = [];

  const currentEpoch = controller.getCurrentEpoch();
  let lastEpochUpdate = ctx.lastEpochUpdate;
  let lastDUpdate = ctx.lastDUpdate;
  let lastWUpdate = ctx.lastWUpdate;
  let lastMUpdate = ctx.lastMUpdate;
  let lastNewValidatorCheck = ctx.lastNewValidatorCheck;

  // Level 0: Detect and backfill new validators (every 30s)
  if (
    lastNewValidatorCheck === null ||
    now - lastNewValidatorCheck >= INTERVAL_NEW_VALIDATOR_CHECK
  ) {
    const count = await controller.detectAndBackfillNewValidators(ctx.maxAttestationDelay);
    if (count > 0) {
      updatedLevels.push(`new-validators(${count})`);
    }
    lastNewValidatorCheck = now;
  }

  // Level 1: Attestations + inactivity (every tick)
  await controller.updateAttestationsAndStatus({
    slotsPerEpoch: ctx.slotsPerEpoch,
    maxAttestationDelay: ctx.maxAttestationDelay,
    delaySlotsToHead: ctx.delaySlotsToHead,
    missedAttestationsForInactivity: ctx.missedAttestationsForInactivity,
  });
  updatedLevels.push('attestations');

  // Level 2 + 3: Balances + h performance (every new epoch)
  if (lastEpochUpdate === null || currentEpoch > lastEpochUpdate) {
    await controller.updateBalances();
    updatedLevels.push('balances');

    await controller.updatePerformanceH(ctx.maxAttestationDelay);
    updatedLevels.push('h');

    lastEpochUpdate = currentEpoch;
  }

  // Level 4: d performance (every 30 min)
  if (lastDUpdate === null || now - lastDUpdate >= INTERVAL_D) {
    await controller.updatePerformanceD(ctx.maxAttestationDelay);
    lastDUpdate = now;
    updatedLevels.push('d');
  }

  // Level 5: w performance (every 3h)
  if (lastWUpdate === null || now - lastWUpdate >= INTERVAL_W) {
    await controller.updatePerformanceW();
    lastWUpdate = now;
    updatedLevels.push('w');
  }

  // Level 6: m performance (every 6h)
  if (lastMUpdate === null || now - lastMUpdate >= INTERVAL_M) {
    await controller.updatePerformanceM();
    lastMUpdate = now;
    updatedLevels.push('m');
  }

  return {
    updatedLevels,
    lastProcessedSlot: ctx.lastProcessedSlot,
    lastEpochUpdate,
    lastDUpdate,
    lastWUpdate,
    lastMUpdate,
    lastNewValidatorCheck,
  } satisfies TickResult;
});

export const snapshotMachine = setup({
  types: {} as {
    context: SnapshotContext;
    input: {
      snapshotController: SnapshotController;
      incidentsActor: ActorRefFrom<typeof incidentsMachine>;
      slotDuration: number;
      slotsPerEpoch: number;
      chain: Chain;
      maxAttestationDelay: number;
      delaySlotsToHead: number;
      missedAttestationsForInactivity: number;
    };
  },
  delays: {
    tickInterval: ({ context }) => context.slotDuration * (context.chain === 'gnosis' ? 2 : 1),
  },
  actors: {
    runTick,
  },
}).createMachine({
  id: 'Snapshot',
  initial: 'waiting',
  context: ({ input }) => ({
    snapshotController: input.snapshotController,
    incidentsActor: input.incidentsActor,
    slotDuration: input.slotDuration,
    slotsPerEpoch: input.slotsPerEpoch,
    chain: input.chain,
    maxAttestationDelay: input.maxAttestationDelay,
    delaySlotsToHead: input.delaySlotsToHead,
    missedAttestationsForInactivity: input.missedAttestationsForInactivity,
    lastProcessedSlot: null,
    lastEpochUpdate: null,
    lastDUpdate: null,
    lastWUpdate: null,
    lastMUpdate: null,
    lastNewValidatorCheck: null,
  }),
  states: {
    waiting: {
      after: {
        tickInterval: {
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
              lastDUpdate: ({ event }) => event.output.lastDUpdate,
              lastWUpdate: ({ event }) => event.output.lastWUpdate,
              lastMUpdate: ({ event }) => event.output.lastMUpdate,
              lastNewValidatorCheck: ({ event }) => event.output.lastNewValidatorCheck,
            }),
            sendTo(({ context }) => context.incidentsActor, { type: 'SNAPSHOT_UPDATED' as const }),
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

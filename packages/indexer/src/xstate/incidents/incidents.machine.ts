import { setup, fromPromise } from 'xstate';

import { IncidentController } from '@/src/services/consensus/controllers/incident.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

const runSync = fromPromise(
  async ({
    input,
  }: {
    input: { incidentController: IncidentController; maxAttestationDelay: number };
  }) => {
    await input.incidentController.syncOpenIncidents(input.maxAttestationDelay);
  },
);

export const incidentsMachine = setup({
  types: {} as {
    context: {
      incidentController: IncidentController;
      maxAttestationDelay: number;
    };
    events: { type: 'SNAPSHOT_UPDATED' };
    input: {
      incidentController: IncidentController;
      maxAttestationDelay: number;
    };
  },
  actors: {
    runSync,
  },
}).createMachine({
  id: 'Incidents',
  initial: 'idle',
  context: ({ input }) => ({
    incidentController: input.incidentController,
    maxAttestationDelay: input.maxAttestationDelay,
  }),
  states: {
    idle: {
      on: {
        SNAPSHOT_UPDATED: {
          target: 'syncing',
        },
      },
    },
    syncing: {
      invoke: {
        src: 'runSync',
        input: ({ context }) => ({
          incidentController: context.incidentController,
          maxAttestationDelay: context.maxAttestationDelay,
        }),
        onDone: {
          target: 'idle',
          actions: [pinoLog(() => 'Incidents sync completed', 'Incidents')],
        },
        onError: {
          target: 'idle',
          actions: [
            pinoLog(({ event }) => `Incidents sync error: ${event.error}`, 'Incidents', 'error'),
          ],
        },
      },
      on: {
        SNAPSHOT_UPDATED: {
          actions: [
            pinoLog(
              () => 'Ignoring SNAPSHOT_UPDATED - incident sync already in progress',
              'Incidents',
            ),
          ],
        },
      },
    },
  },
});

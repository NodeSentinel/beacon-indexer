import { setup } from 'xstate';

import { IncidentTrackerController } from '@/src/services/consensus/controllers/incidentTracker.js';

export const incidentTrackerMachine = setup({
  types: {} as {
    context: {
      incidentTrackerController: IncidentTrackerController;
      slotDuration: number;
      maxAttestationDelay: number;
      inactiveMissedCount: number;
    };
    input: {
      incidentTrackerController: IncidentTrackerController;
      slotDuration: number;
      maxAttestationDelay: number;
      inactiveMissedCount: number;
    };
  },
  delays: {
    // Preserve the historical polling cadence so the disabled actor can still be
    // observed safely if it is ever instantiated for diagnostics.
    tickInterval: ({ context }) => context.slotDuration,
  },
}).createMachine({
  id: 'IncidentTracker',
  initial: 'waiting',
  context: ({ input }) => ({
    incidentTrackerController: input.incidentTrackerController,
    slotDuration: input.slotDuration,
    maxAttestationDelay: input.maxAttestationDelay,
    inactiveMissedCount: input.inactiveMissedCount,
  }),
  states: {
    waiting: {
      // Remain idle on every tick because activity processing now owns incident
      // creation and closure end to end.
      after: {
        tickInterval: {
          target: 'waiting',
        },
      },
    },
  },
});

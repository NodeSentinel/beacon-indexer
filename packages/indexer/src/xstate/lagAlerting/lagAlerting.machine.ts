import fs from 'fs/promises';
import path from 'path';

import type { BeaconTime } from '@beacon-indexer/beacon-utils/beaconTime';
import { setup, fromPromise, assign } from 'xstate';

import createLogger from '@/src/lib/pino.js';
import { sendTelegramAlert } from '@/src/lib/telegram.js';
import type { SlotController } from '@/src/services/consensus/controllers/slot.js';
import { pinoLog } from '@/src/xstate/pinoLog.js';

const LOGGER_CONTEXT = 'LagAlerting';

// Lag thresholds (in slots)
const LAG_ALERT_THRESHOLD = 100;
const LAG_RECOVERY_THRESHOLD = 5;

// Timing
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// Error log
const ERROR_LOG_TAIL_LINES = 20;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Telegram messages have a 4096 character limit.
// We reserve space for the message template and truncate the error log if needed.
const TELEGRAM_MAX_LENGTH = 4096;
const MESSAGE_TEMPLATE_OVERHEAD = 300; // space for headers, slots, tags
const MAX_ERROR_LOG_LENGTH = TELEGRAM_MAX_LENGTH - MESSAGE_TEMPLATE_OVERHEAD;

function truncateForTelegram(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncationNotice = '\n... (truncated)';
  return text.slice(0, maxLength - truncationNotice.length) + truncationNotice;
}

type LagCheckResult = {
  lastProcessedSlot: number | null;
  headSlot: number;
  lagSlots: number;
};

async function checkLag(input: {
  slotController: SlotController;
  beaconTime: BeaconTime;
}): Promise<LagCheckResult> {
  const headSlot = input.beaconTime.getChainCurrentSlot();
  const lastProcessedSlot = await input.slotController.getLastProcessedSlot();
  const lagSlots =
    lastProcessedSlot !== null
      ? headSlot - lastProcessedSlot
      : headSlot - input.beaconTime.getLookbackSlot();

  return { lastProcessedSlot, headSlot, lagSlots };
}

async function readErrorLogTail(): Promise<string> {
  const logsDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
  const errorLogPath = path.join(logsDir, 'errors-latest.log');

  try {
    const content = await fs.readFile(errorLogPath, 'utf-8');
    const lines = content.trim().split('\n');
    const tail = lines.slice(-ERROR_LOG_TAIL_LINES);
    return tail.join('\n');
  } catch (error) {
    createLogger(LOGGER_CONTEXT).error('Failed to read error log', error);
    return '(could not read error log)';
  }
}

async function sendLagAlert(input: {
  lagSlots: number;
  headSlot: number;
  lastProcessedSlot: number | null;
  chain: string;
}): Promise<void> {
  const errorLogTail = await readErrorLogTail();

  const escapedLog = truncateForTelegram(escapeHtml(errorLogTail), MAX_ERROR_LOG_LENGTH);

  const message = [
    `<b>Indexer Lag Alert [${escapeHtml(input.chain)}]</b>`,
    '',
    `Head slot: <code>${input.headSlot}</code>`,
    `Last processed: <code>${input.lastProcessedSlot ?? 'none'}</code>`,
    `Lag: <b>${input.lagSlots} slots</b>`,
    '',
    `<b>Last ${ERROR_LOG_TAIL_LINES} error log lines:</b>`,
    `<pre>${escapedLog}</pre>`,
  ].join('\n');

  await sendTelegramAlert(message);
}

async function sendRecoveryAlert(input: {
  lagSlots: number;
  headSlot: number;
  lastProcessedSlot: number | null;
  chain: string;
}): Promise<void> {
  const message = [
    `<b>Indexer Recovered [${escapeHtml(input.chain)}]</b>`,
    '',
    `Head slot: <code>${input.headSlot}</code>`,
    `Last processed: <code>${input.lastProcessedSlot ?? 'none'}</code>`,
    `Lag: <b>${input.lagSlots} slots</b>`,
  ].join('\n');

  await sendTelegramAlert(message);
}

export const lagAlertingMachine = setup({
  types: {} as {
    context: {
      slotController: SlotController;
      beaconTime: BeaconTime;
      chain: string;
      isInAlertState: boolean;
      lastAlertedAt: number | null;
      lastCheck: LagCheckResult | null;
    };
    input: {
      slotController: SlotController;
      beaconTime: BeaconTime;
      chain: string;
    };
  },
  actors: {
    checkLag: fromPromise(
      async ({ input }: { input: { slotController: SlotController; beaconTime: BeaconTime } }) => {
        return await checkLag(input);
      },
    ),
    sendLagAlert: fromPromise(
      async ({
        input,
      }: {
        input: {
          lagSlots: number;
          headSlot: number;
          lastProcessedSlot: number | null;
          chain: string;
        };
      }) => {
        await sendLagAlert(input);
      },
    ),
    sendRecoveryAlert: fromPromise(
      async ({
        input,
      }: {
        input: {
          lagSlots: number;
          headSlot: number;
          lastProcessedSlot: number | null;
          chain: string;
        };
      }) => {
        await sendRecoveryAlert(input);
      },
    ),
  },
  guards: {
    shouldAlert: ({ context }) => {
      if (!context.lastCheck) return false;
      if (context.lastCheck.lagSlots <= LAG_ALERT_THRESHOLD) return false;
      // Not in alert state yet → alert
      if (!context.isInAlertState) return true;
      // Already in alert state → only alert if cooldown expired
      if (!context.lastAlertedAt) return true;
      return Date.now() - context.lastAlertedAt >= ALERT_COOLDOWN_MS;
    },
    shouldRecover: ({ context }) => {
      if (!context.lastCheck) return false;
      return context.isInAlertState && context.lastCheck.lagSlots <= LAG_RECOVERY_THRESHOLD;
    },
  },
}).createMachine({
  id: 'LagAlerting',
  initial: 'sleeping',
  context: ({ input }) => ({
    slotController: input.slotController,
    beaconTime: input.beaconTime,
    chain: input.chain,
    isInAlertState: false,
    lastAlertedAt: null,
    lastCheck: null,
  }),
  states: {
    sleeping: {
      description: 'Waiting for next check interval (5 minutes)',
      after: {
        [CHECK_INTERVAL_MS]: 'checking',
      },
    },

    checking: {
      description: 'Querying last processed slot and comparing to chain head',
      invoke: {
        src: 'checkLag',
        input: ({ context }) => ({
          slotController: context.slotController,
          beaconTime: context.beaconTime,
        }),
        onDone: {
          target: 'evaluating',
          actions: assign({
            lastCheck: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'sleeping',
          actions: [
            pinoLog(({ event }) => `Error checking lag: ${event.error}`, LOGGER_CONTEXT, 'error'),
          ],
        },
      },
    },

    evaluating: {
      description: 'Deciding whether to alert, recover, or do nothing',
      always: [
        { target: 'alerting', guard: 'shouldAlert' },
        { target: 'recovering', guard: 'shouldRecover' },
        {
          target: 'sleeping',
          actions: [
            pinoLog(({ context }) => {
              const lag = context.lastCheck?.lagSlots ?? 0;
              if (context.isInAlertState) {
                return `Lag: ${lag} slots (in alert state, cooldown active)`;
              }
              return undefined; // skip log when healthy
            }, LOGGER_CONTEXT),
          ],
        },
      ],
    },

    alerting: {
      description: 'Sending lag alert via Telegram',
      invoke: {
        src: 'sendLagAlert',
        input: ({ context }) => ({
          lagSlots: context.lastCheck!.lagSlots,
          headSlot: context.lastCheck!.headSlot,
          lastProcessedSlot: context.lastCheck!.lastProcessedSlot,
          chain: context.chain,
        }),
        onDone: {
          target: 'sleeping',
          actions: [
            assign({
              isInAlertState: true,
              lastAlertedAt: () => Date.now(),
            }),
            pinoLog(
              ({ context }) => `Lag alert sent: ${context.lastCheck?.lagSlots} slots behind head`,
              LOGGER_CONTEXT,
              'warn',
            ),
          ],
        },
        onError: {
          target: 'sleeping',
          actions: [
            pinoLog(
              ({ event }) => `Failed to send lag alert: ${event.error}`,
              LOGGER_CONTEXT,
              'error',
            ),
          ],
        },
      },
    },

    recovering: {
      description: 'Sending recovery notification via Telegram',
      invoke: {
        src: 'sendRecoveryAlert',
        input: ({ context }) => ({
          lagSlots: context.lastCheck!.lagSlots,
          headSlot: context.lastCheck!.headSlot,
          lastProcessedSlot: context.lastCheck!.lastProcessedSlot,
          chain: context.chain,
        }),
        onDone: {
          target: 'sleeping',
          actions: [
            assign({
              isInAlertState: false,
              lastAlertedAt: null,
            }),
            pinoLog(
              ({ context }) =>
                `Recovery alert sent: lag back to ${context.lastCheck?.lagSlots} slots`,
              LOGGER_CONTEXT,
            ),
          ],
        },
        onError: {
          target: 'sleeping',
          actions: [
            assign({
              isInAlertState: false,
              lastAlertedAt: null,
            }),
            pinoLog(
              ({ event }) => `Failed to send recovery alert: ${event.error}`,
              LOGGER_CONTEXT,
              'error',
            ),
          ],
        },
      },
    },
  },
});

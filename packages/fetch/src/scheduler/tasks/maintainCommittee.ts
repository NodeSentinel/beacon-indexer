import { SimpleIntervalJob, AsyncTask } from 'toad-scheduler';

import createLogger from '@/src/lib/pino.js';
import { maintainCommittee } from '@/src/services/consensus/_feed/maintainCommittee.js';

const ID = 'maintainCommitteeTable';
const logger = createLogger(ID, true);

export const job = new SimpleIntervalJob(
  { minutes: 30, runImmediately: true },
  new AsyncTask(`${ID}_task`, () =>
    maintainCommittee(logger).catch((e) => logger.error('TASK-CATCH', e)),
  ),
  {
    id: ID,
    preventOverrun: true,
  },
);

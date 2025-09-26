import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('@/src/utils/db.js', () => ({
  db_hasBeaconRewardsFetched: vi.fn(),
  db_hasBlockAndSyncRewardsFetched: vi.fn(),
  db_countRemainingHoursAfterDate: vi.fn(),
}));

vi.mock('@/src/services/consensus/utils/misc.js', () => ({
  getEpochFromSlot: vi.fn(),
}));

vi.mock('@/src/services/consensus/utils/time.deprecated.js', () => ({
  getSlotNumberFromTimestamp: vi.fn(),
}));

import { canSummarize } from '../summarizeDaily.js';

import * as beaconUtils from '@/src/services/consensus/utils/misc.js';
import * as timeUtils from '@/src/services/consensus/utils/time.deprecated.js';
import * as db from '@/src/utils/db.js';

describe('summarizeDaily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('canSummarize', () => {
    it('should return false when beacon rewards are not fetched', async () => {
      // Arrange
      const dayToSummarize = new Date('2025-08-16');
      const mockEpoch = 1000;

      vi.mocked(timeUtils.getSlotNumberFromTimestamp).mockReturnValue(100000);
      vi.mocked(beaconUtils.getEpochFromSlot).mockReturnValue(mockEpoch);
      vi.mocked(db.db_hasBeaconRewardsFetched).mockResolvedValue(false);

      // Act
      const result = await canSummarize(dayToSummarize);

      // Assert
      expect(result).toBe(false);
      expect(db.db_hasBeaconRewardsFetched).toHaveBeenCalledWith(mockEpoch);
    });

    it('should return false when block and sync rewards are not fetched', async () => {
      // Arrange
      const dayToSummarize = new Date('2025-08-16');
      const mockEpoch = 1000;
      const mockSlot = 100032; // 100000 + 32

      vi.mocked(timeUtils.getSlotNumberFromTimestamp).mockReturnValue(100000);
      vi.mocked(beaconUtils.getEpochFromSlot).mockReturnValue(mockEpoch);
      vi.mocked(db.db_hasBeaconRewardsFetched).mockResolvedValue(true);
      vi.mocked(db.db_hasBlockAndSyncRewardsFetched).mockResolvedValue(false);

      // Act
      const result = await canSummarize(dayToSummarize);

      // Assert
      expect(result).toBe(false);
      expect(db.db_hasBlockAndSyncRewardsFetched).toHaveBeenCalledWith(mockSlot);
    });

    it('should return false when less than 24 hours of data remain after summary', async () => {
      // Arrange
      const dayToSummarize = new Date('2025-08-16'); // day to summarize is LastSummaryUpdate.dailyValidatorStats
      const mockSlot = 100000;
      const mockEpoch = 1000;

      vi.mocked(timeUtils.getSlotNumberFromTimestamp).mockReturnValue(mockSlot);
      vi.mocked(beaconUtils.getEpochFromSlot).mockReturnValue(mockEpoch);
      vi.mocked(db.db_hasBeaconRewardsFetched).mockResolvedValue(true);
      vi.mocked(db.db_hasBlockAndSyncRewardsFetched).mockResolvedValue(true);
      vi.mocked(db.db_countRemainingHoursAfterDate).mockResolvedValue(20); // Less than 24

      // Act
      const result = await canSummarize(dayToSummarize);

      // Assert
      expect(result).toBe(false);
      // we will summarize all the hours for lastSummaryUpdate, so we need to have at least 24 hours of data remaining
      expect(db.db_countRemainingHoursAfterDate).toHaveBeenCalledWith(dayToSummarize);
    });

    it('should return true when all conditions are met', async () => {
      // Arrange
      const lastSummaryUpdate = new Date('2025-08-16');
      const mockEpoch = 1000;
      const mockSlot = 100032;

      vi.mocked(timeUtils.getSlotNumberFromTimestamp).mockReturnValue(100000);
      vi.mocked(beaconUtils.getEpochFromSlot).mockReturnValue(mockEpoch);
      vi.mocked(db.db_hasBeaconRewardsFetched).mockResolvedValue(true);
      vi.mocked(db.db_hasBlockAndSyncRewardsFetched).mockResolvedValue(true);
      vi.mocked(db.db_countRemainingHoursAfterDate).mockResolvedValue(30); // More than 24

      // Act
      const result = await canSummarize(lastSummaryUpdate);

      // Assert
      expect(result).toBe(true);
      expect(db.db_hasBeaconRewardsFetched).toHaveBeenCalledWith(mockEpoch);
      expect(db.db_hasBlockAndSyncRewardsFetched).toHaveBeenCalledWith(mockSlot);
      expect(db.db_countRemainingHoursAfterDate).toHaveBeenCalledWith(lastSummaryUpdate);
    });
  });
});

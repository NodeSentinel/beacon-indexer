import ms from 'ms';
import { describe, expect, test } from 'vitest';

import { BeaconTime } from './time.js';

import { ethereumConfig, gnosisConfig } from '@/src/config/chain.js';

// Test data from actual nodes (converted to milliseconds)
const TEST_DATA = {
  ethereum: {
    slots: {
      9000000: ms('1714824023s'),
      10000000: ms('1726824023s'),
      12480000: ms('1756584023s'),
      12480031: ms('1756584395s'),
    },
    epochs: {
      281250: {
        startSlot: 9000000,
        endSlot: 9000031,
        timestamp: ms('1714824023s'),
      },
      312500: {
        startSlot: 10000000,
        endSlot: 10000031,
        timestamp: ms('1726824023s'),
      },
      390000: {
        startSlot: 12480000,
        endSlot: 12480031,
        timestamp: ms('1756584023s'),
      },
    },
  },
  gnosis: {
    slots: {
      18000000: ms('1728993340s'),
      19000000: ms('1733993340s'),
      18880000: ms('1733393340s'), // Start of epoch 1180000
      18880015: ms('1733393415s'), // End of epoch 1180000
    },
    epochs: {
      1125000: {
        startSlot: 18000000,
        endSlot: 18000015,
        timestamp: ms('1728993340s'),
      },
      1187500: {
        startSlot: 19000000,
        endSlot: 19000015,
        timestamp: ms('1733993340s'),
      },
      1180000: {
        startSlot: 18880000,
        endSlot: 18880015,
        timestamp: ms('1733393340s'),
      },
    },
  },
} as const;

describe('BeaconTime', () => {
  describe('Ethereum Mainnet', () => {
    const ethereumBeaconTime = new BeaconTime({
      genesisTimestamp: ethereumConfig.beacon.genesisTimestamp,
      slotDurationMs: ethereumConfig.beacon.slotDuration,
      slotsPerEpoch: ethereumConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: ethereumConfig.beacon.epochsPerSyncCommitteePeriod,
      slotStartIndexing: 32,
    });

    test('should convert slot to timestamp correctly', () => {
      // Timestamps from actual node
      expect(ethereumBeaconTime.getTimestampFromSlotNumber(9000000)).toBe(
        TEST_DATA.ethereum.slots[9000000],
      );
      expect(ethereumBeaconTime.getTimestampFromSlotNumber(10000000)).toBe(
        TEST_DATA.ethereum.slots[10000000],
      );
      expect(ethereumBeaconTime.getTimestampFromSlotNumber(12480000)).toBe(
        TEST_DATA.ethereum.slots[12480000],
      );
      expect(ethereumBeaconTime.getTimestampFromSlotNumber(12480031)).toBe(
        TEST_DATA.ethereum.slots[12480031],
      );
    });

    test('should convert timestamp to slot correctly', () => {
      // Timestamps from actual node
      expect(ethereumBeaconTime.getSlotNumberFromTimestamp(TEST_DATA.ethereum.slots[9000000])).toBe(
        9000000,
      );
      expect(
        ethereumBeaconTime.getSlotNumberFromTimestamp(TEST_DATA.ethereum.slots[10000000]),
      ).toBe(10000000);
      expect(
        ethereumBeaconTime.getSlotNumberFromTimestamp(TEST_DATA.ethereum.slots[12480000]),
      ).toBe(12480000);
      expect(
        ethereumBeaconTime.getSlotNumberFromTimestamp(TEST_DATA.ethereum.slots[12480031]),
      ).toBe(12480031);
    });

    test('should convert epoch to timestamp correctly', () => {
      const epoch9000000 = Math.floor(9000000 / 32); // 281250
      const epoch10000000 = Math.floor(10000000 / 32); // 312500

      expect(ethereumBeaconTime.getTimestampFromEpochNumber(epoch9000000)).toBe(
        TEST_DATA.ethereum.slots[9000000],
      );
      expect(ethereumBeaconTime.getTimestampFromEpochNumber(epoch10000000)).toBe(
        TEST_DATA.ethereum.slots[10000000],
      );
      expect(ethereumBeaconTime.getTimestampFromEpochNumber(281250)).toBe(
        TEST_DATA.ethereum.epochs[281250].timestamp,
      );
      expect(ethereumBeaconTime.getTimestampFromEpochNumber(312500)).toBe(
        TEST_DATA.ethereum.epochs[312500].timestamp,
      );
    });

    test('should convert timestamp to epoch correctly', () => {
      const epoch9000000 = Math.floor(9000000 / 32); // 281250
      const epoch10000000 = Math.floor(10000000 / 32); // 312500

      expect(
        ethereumBeaconTime.getEpochNumberFromTimestamp(TEST_DATA.ethereum.slots[9000000]),
      ).toBe(epoch9000000);
      expect(
        ethereumBeaconTime.getEpochNumberFromTimestamp(TEST_DATA.ethereum.slots[10000000]),
      ).toBe(epoch10000000);
    });

    test('should handle specific epoch slot ranges', () => {
      // Test epoch 281250 slot range
      const epoch281250Slots = ethereumBeaconTime.getEpochSlots(281250);
      expect(epoch281250Slots.startSlot).toBe(TEST_DATA.ethereum.epochs[281250].startSlot);
      expect(epoch281250Slots.endSlot).toBe(TEST_DATA.ethereum.epochs[281250].endSlot);

      // Test epoch 312500 slot range
      const epoch312500Slots = ethereumBeaconTime.getEpochSlots(312500);
      expect(epoch312500Slots.startSlot).toBe(TEST_DATA.ethereum.epochs[312500].startSlot);
      expect(epoch312500Slots.endSlot).toBe(TEST_DATA.ethereum.epochs[312500].endSlot);

      // Test epoch 390000 slot range
      const epoch390000Slots = ethereumBeaconTime.getEpochSlots(390000);
      expect(epoch390000Slots.startSlot).toBe(TEST_DATA.ethereum.epochs[390000].startSlot);
      expect(epoch390000Slots.endSlot).toBe(TEST_DATA.ethereum.epochs[390000].endSlot);
    });

    test('should convert specific epochs to timestamps', () => {
      // Test specific epoch numbers
      expect(ethereumBeaconTime.getTimestampFromEpochNumber(281250)).toBe(
        TEST_DATA.ethereum.epochs[281250].timestamp,
      );
      expect(ethereumBeaconTime.getTimestampFromEpochNumber(312500)).toBe(
        TEST_DATA.ethereum.epochs[312500].timestamp,
      );
    });
  });

  describe('Gnosis Chain', () => {
    const gnosisBeaconTime = new BeaconTime({
      genesisTimestamp: gnosisConfig.beacon.genesisTimestamp,
      slotDurationMs: gnosisConfig.beacon.slotDuration,
      slotsPerEpoch: gnosisConfig.beacon.slotsPerEpoch,
      epochsPerSyncCommitteePeriod: gnosisConfig.beacon.epochsPerSyncCommitteePeriod,
      slotStartIndexing: 32,
    });

    test('should convert slot to timestamp correctly', () => {
      // Timestamps from actual node
      expect(gnosisBeaconTime.getTimestampFromSlotNumber(18000000)).toBe(
        TEST_DATA.gnosis.slots[18000000],
      );
      expect(gnosisBeaconTime.getTimestampFromSlotNumber(19000000)).toBe(
        TEST_DATA.gnosis.slots[19000000],
      );
      expect(gnosisBeaconTime.getTimestampFromSlotNumber(18880000)).toBe(
        TEST_DATA.gnosis.slots[18880000],
      );
      expect(gnosisBeaconTime.getTimestampFromSlotNumber(18880015)).toBe(
        TEST_DATA.gnosis.slots[18880015],
      );
    });

    test('should convert timestamp to slot correctly', () => {
      // Timestamps from actual node
      expect(gnosisBeaconTime.getSlotNumberFromTimestamp(TEST_DATA.gnosis.slots[18000000])).toBe(
        18000000,
      );
      expect(gnosisBeaconTime.getSlotNumberFromTimestamp(TEST_DATA.gnosis.slots[19000000])).toBe(
        19000000,
      );
      expect(gnosisBeaconTime.getSlotNumberFromTimestamp(TEST_DATA.gnosis.slots[18880000])).toBe(
        18880000,
      );
      expect(gnosisBeaconTime.getSlotNumberFromTimestamp(TEST_DATA.gnosis.slots[18880015])).toBe(
        18880015,
      );
    });

    test('should convert epoch to timestamp correctly', () => {
      const epoch18000000 = Math.floor(18000000 / 16); // 1125000 (using 16 slots per epoch for Gnosis)
      const epoch19000000 = Math.floor(19000000 / 16); // 1187500

      expect(gnosisBeaconTime.getTimestampFromEpochNumber(epoch18000000)).toBe(
        TEST_DATA.gnosis.slots[18000000],
      );
      expect(gnosisBeaconTime.getTimestampFromEpochNumber(epoch19000000)).toBe(
        TEST_DATA.gnosis.slots[19000000],
      );
      expect(gnosisBeaconTime.getTimestampFromEpochNumber(1125000)).toBe(
        TEST_DATA.gnosis.epochs[1125000].timestamp,
      );
      expect(gnosisBeaconTime.getTimestampFromEpochNumber(1187500)).toBe(
        TEST_DATA.gnosis.epochs[1187500].timestamp,
      );
    });

    test('should convert timestamp to epoch correctly', () => {
      const epoch18000000 = Math.floor(18000000 / 16); // 1125000 (using 16 slots per epoch for Gnosis)
      const epoch19000000 = Math.floor(19000000 / 16); // 1187500

      expect(gnosisBeaconTime.getEpochNumberFromTimestamp(TEST_DATA.gnosis.slots[18000000])).toBe(
        epoch18000000,
      );
      expect(gnosisBeaconTime.getEpochNumberFromTimestamp(TEST_DATA.gnosis.slots[19000000])).toBe(
        epoch19000000,
      );
    });

    test('should handle specific epoch slot ranges', () => {
      // Test epoch 1125000 slot range
      const epoch1125000Slots = gnosisBeaconTime.getEpochSlots(1125000);
      expect(epoch1125000Slots.startSlot).toBe(TEST_DATA.gnosis.epochs[1125000].startSlot);
      expect(epoch1125000Slots.endSlot).toBe(TEST_DATA.gnosis.epochs[1125000].endSlot);

      // Test epoch 1187500 slot range
      const epoch1187500Slots = gnosisBeaconTime.getEpochSlots(1187500);
      expect(epoch1187500Slots.startSlot).toBe(TEST_DATA.gnosis.epochs[1187500].startSlot);
      expect(epoch1187500Slots.endSlot).toBe(TEST_DATA.gnosis.epochs[1187500].endSlot);

      // Test epoch 1180000 slot range
      const epoch1180000Slots = gnosisBeaconTime.getEpochSlots(1180000);
      expect(epoch1180000Slots.startSlot).toBe(TEST_DATA.gnosis.epochs[1180000].startSlot);
      expect(epoch1180000Slots.endSlot).toBe(TEST_DATA.gnosis.epochs[1180000].endSlot);
    });

    test('should convert specific epochs to timestamps', () => {
      // Test specific epoch numbers
      expect(gnosisBeaconTime.getTimestampFromEpochNumber(1125000)).toBe(
        TEST_DATA.gnosis.epochs[1125000].timestamp,
      );
      expect(gnosisBeaconTime.getTimestampFromEpochNumber(1187500)).toBe(
        TEST_DATA.gnosis.epochs[1187500].timestamp,
      );
    });
  });

  describe('Edge cases', () => {
    const beaconTime = new BeaconTime({
      genesisTimestamp: 1606824000000,
      slotDurationMs: 12000,
      slotsPerEpoch: 32,
      epochsPerSyncCommitteePeriod: 256,
      slotStartIndexing: 32,
    });

    test('should handle genesis timestamp', () => {
      expect(beaconTime.getSlotNumberFromTimestamp(1606824000000)).toBe(0);
      expect(beaconTime.getTimestampFromSlotNumber(0)).toBe(1606824000000);
    });

    test('should handle epoch calculations', () => {
      expect(beaconTime.getEpochNumberFromTimestamp(1606824000000)).toBe(0);
      expect(beaconTime.getTimestampFromEpochNumber(0)).toBe(1606824000000);
    });

    test('should handle sync committee period calculations', () => {
      expect(beaconTime.getSyncCommitteePeriodStartEpoch(0)).toBe(0);
      expect(beaconTime.getSyncCommitteePeriodStartEpoch(255)).toBe(0);
      expect(beaconTime.getSyncCommitteePeriodStartEpoch(256)).toBe(256);
      expect(beaconTime.getSyncCommitteePeriodStartEpoch(511)).toBe(256);
    });

    test('should handle epoch slots calculation', () => {
      const epoch0 = beaconTime.getEpochSlots(0);
      expect(epoch0.startSlot).toBe(0);
      expect(epoch0.endSlot).toBe(31);

      const epoch1 = beaconTime.getEpochSlots(1);
      expect(epoch1.startSlot).toBe(32);
      expect(epoch1.endSlot).toBe(63);
    });

    test('should handle slot range calculation', () => {
      const startTime = new Date(1606824000000);
      const endTime = new Date(1606824000000 + 12000 * 10); // 10 slots later

      const range = beaconTime.calculateSlotRange(startTime, endTime);
      expect(range.startSlot).toBe(0);
      expect(range.endSlot).toBe(10);
    });
  });
});

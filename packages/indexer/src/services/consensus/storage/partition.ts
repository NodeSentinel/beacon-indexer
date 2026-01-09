import { PrismaClient } from '@beacon-indexer/db';

/**
 * PartitionStorage - Database persistence layer for partition-related operations
 *
 * Handles all database operations for partitions, following the principle
 * that storage classes should only contain persistence logic, not business logic.
 */
export class PartitionStorage {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Query PostgreSQL catalog to discover existing partitions for a table
   * @param tableName - Name of the partitioned table (e.g., committee, epoch_rewards)
   * @returns Array of partition names
   */
  async discoverPartitions(tableName: string): Promise<string[]> {
    const result = await this.prisma.$queryRaw<Array<{ relname: string }>>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class p ON i.inhparent = p.oid
      WHERE p.relname = ${tableName}
      ORDER BY c.relname
    `;

    return result.map((row) => row.relname);
  }

  /**
   * Check if a specific partition exists
   * @param partitionName - Name of the partition to check
   */
  async partitionExists(partitionName: string): Promise<boolean> {
    const result = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_class
        WHERE relname = ${partitionName}
      ) as exists
    `;

    return result[0]?.exists ?? false;
  }

  /**
   * Create a partition for a table with numeric range (slot/epoch based)
   * This method only handles database operations, all business logic should be in the controller.
   *
   * @param tableName - Name of the partitioned table
   * @param partitionName - Name for the new partition
   * @param rangeStart - Start of the range (inclusive)
   * @param rangeEnd - End of the range (exclusive for PostgreSQL)
   */
  async createPartition(
    tableName: string,
    partitionName: string,
    rangeStart: number,
    rangeEnd: number,
  ): Promise<void> {
    // PostgreSQL partition ranges use FROM (inclusive) TO (exclusive)
    // Note: FOR VALUES FROM/TO must use literal values, not parameters
    // Using $executeRawUnsafe because partition range values must be literals
    await this.prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "${tableName}" FOR VALUES FROM (${rangeStart}) TO (${rangeEnd})`,
    );
  }

  /**
   * Create a partition for a table with timestamp range (UTC hour based)
   * Used for tables partitioned by TIMESTAMP like validator_hourly_archive.
   *
   * @param tableName - Name of the partitioned table
   * @param partitionName - Name for the new partition
   * @param rangeStart - Start timestamp (inclusive) as ISO string
   * @param rangeEnd - End timestamp (exclusive) as ISO string
   */
  async createTimestampPartition(
    tableName: string,
    partitionName: string,
    rangeStart: string,
    rangeEnd: string,
  ): Promise<void> {
    // PostgreSQL partition ranges use FROM (inclusive) TO (exclusive)
    // Timestamp values must be quoted as literals
    await this.prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "${tableName}" FOR VALUES FROM ('${rangeStart}') TO ('${rangeEnd}')`,
    );
  }

  /**
   * Drop a partition (for maintenance/cleanup)
   * @param partitionName - Name of the partition to drop
   */
  async dropPartition(partitionName: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partitionName}"`);
  }
}

import { PrismaClient, Validator } from '@prisma/client';
import chunk from 'lodash/chunk.js';
import ms from 'ms';

export class ValidatorsStorage {
  constructor(private readonly prisma: PrismaClient) {}

  async getValidatorsCount() {
    return this.prisma.validator.count();
  }

  async saveValidators(validators: Validator[]) {
    const batches = chunk(validators, 10000);

    for (const batch of batches) {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.validator.createMany({
            data: batch,
          });
        },
        {
          timeout: ms('2m'),
        },
      );
    }
  }

  async getValidatorById(id: number) {
    return this.prisma.validator.findUnique({
      where: { id },
    });
  }
}

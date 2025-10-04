-- CreateTable
CREATE TABLE "public"."Epoch" (
    "epoch" INTEGER NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "validatorsBalancesFetched" BOOLEAN NOT NULL DEFAULT false,
    "validatorsActivationFetched" BOOLEAN NOT NULL DEFAULT false,
    "rewardsFetched" BOOLEAN NOT NULL DEFAULT false,
    "committeesFetched" BOOLEAN NOT NULL DEFAULT false,
    "slotsFetched" BOOLEAN NOT NULL DEFAULT false,
    "syncCommitteesFetched" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Epoch_pkey" PRIMARY KEY ("epoch")
);

-- CreateTable
CREATE TABLE "public"."Slot" (
    "slot" INTEGER NOT NULL,
    "blockNumber" INTEGER,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "attestationsProcessed" BOOLEAN NOT NULL DEFAULT false,
    "committeeValidatorCounts" JSONB,
    "blockAndSyncRewardsProcessed" BOOLEAN NOT NULL DEFAULT false,
    "executionRewardsProcessed" BOOLEAN NOT NULL DEFAULT false,
    "beaconBlockProcessed" BOOLEAN NOT NULL DEFAULT false,
    "withdrawalsRewards" JSONB,
    "clDeposits" JSONB,
    "clVoluntaryExits" JSONB,
    "elDeposits" JSONB,
    "elWithdrawals" JSONB,
    "elConsolidations" JSONB,

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("slot")
);

-- CreateTable
CREATE TABLE "public"."SyncCommittee" (
    "fromEpoch" INTEGER NOT NULL,
    "toEpoch" INTEGER NOT NULL,
    "validators" JSONB NOT NULL,
    "validatorAggregates" JSONB NOT NULL,

    CONSTRAINT "SyncCommittee_pkey" PRIMARY KEY ("fromEpoch","toEpoch")
);

-- CreateTable
CREATE TABLE "public"."Committee" (
    "slot" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "aggregationBitsIndex" INTEGER NOT NULL,
    "validatorIndex" INTEGER NOT NULL,
    "attestationDelay" INTEGER,

    CONSTRAINT "Committee_pkey" PRIMARY KEY ("slot","index","aggregationBitsIndex")
);

-- CreateTable
CREATE TABLE "public"."Validator" (
    "id" INTEGER NOT NULL,
    "status" INTEGER,
    "balance" DECIMAL(78,0) NOT NULL,
    "effectiveBalance" DECIMAL(78,0),
    "withdrawalAddress" TEXT,

    CONSTRAINT "Validator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExecutionRewards" (
    "address" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "blockNumber" INTEGER NOT NULL,

    CONSTRAINT "ExecutionRewards_pkey" PRIMARY KEY ("blockNumber")
);

-- CreateTable
CREATE TABLE "public"."HourlyValidatorStats" (
    "validatorIndex" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "head" BIGINT,
    "target" BIGINT,
    "source" BIGINT,
    "inactivity" BIGINT,
    "missedHead" BIGINT,
    "missedTarget" BIGINT,
    "missedSource" BIGINT,
    "missedInactivity" BIGINT,
    "attestationsMissed" INTEGER,

    CONSTRAINT "HourlyValidatorStats_pkey" PRIMARY KEY ("validatorIndex","date","hour")
);

-- CreateTable
CREATE TABLE "public"."HourlyBlockAndSyncRewards" (
    "validatorIndex" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "blockReward" BIGINT,
    "syncCommittee" BIGINT,

    CONSTRAINT "HourlyBlockAndSyncRewards_pkey" PRIMARY KEY ("validatorIndex","date","hour")
);

-- CreateTable
CREATE TABLE "public"."EpochRewardsTemp" (
    "validatorIndex" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "head" BIGINT,
    "target" BIGINT,
    "source" BIGINT,
    "inactivity" BIGINT,
    "missedHead" BIGINT,
    "missedTarget" BIGINT,
    "missedSource" BIGINT,
    "missedInactivity" BIGINT,

    CONSTRAINT "EpochRewardsTemp_pkey" PRIMARY KEY ("validatorIndex","date","hour")
);

-- CreateTable
CREATE TABLE "public"."DailyValidatorStats" (
    "validatorIndex" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "head" BIGINT,
    "target" BIGINT,
    "source" BIGINT,
    "inactivity" BIGINT,
    "syncCommittee" BIGINT,
    "blockReward" BIGINT,
    "missedHead" BIGINT,
    "missedTarget" BIGINT,
    "missedSource" BIGINT,
    "missedInactivity" BIGINT,
    "attestationsMissed" INTEGER,

    CONSTRAINT "DailyValidatorStats_pkey" PRIMARY KEY ("validatorIndex","date")
);

-- CreateTable
CREATE TABLE "public"."LastSummaryUpdate" (
    "id" SERIAL NOT NULL,
    "hourlyValidatorStats" TIMESTAMP(3),
    "dailyValidatorStats" DATE,
    "weeklyValidatorStats" TIMESTAMP(3),
    "monthlyValidatorStats" TIMESTAMP(3),
    "yearlyValidatorStats" TIMESTAMP(3),

    CONSTRAINT "LastSummaryUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" BIGINT NOT NULL,
    "loginId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "username" TEXT NOT NULL,
    "messageId" BIGINT,
    "lastClaimed" TIMESTAMP(3),
    "hasBlockedBot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performanceNotif" TIMESTAMP(3),
    "performanceThreshold" INTEGER NOT NULL DEFAULT 90,
    "inactiveNotif" TIMESTAMP(3),
    "inactiveOnMissedAttestations" INTEGER NOT NULL DEFAULT 3,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WithdrawalAddress" (
    "address" TEXT NOT NULL,

    CONSTRAINT "WithdrawalAddress_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "public"."FeeRewardAddress" (
    "address" TEXT NOT NULL,

    CONSTRAINT "FeeRewardAddress_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "public"."ValidatorsStats" (
    "validatorId" INTEGER NOT NULL,
    "validatorStatus" INTEGER,
    "oneHourMissed" INTEGER,
    "lastMissed" INTEGER[],
    "dailyCLRewards" BIGINT,
    "dailyELRewards" BIGINT,
    "weeklyCLRewards" BIGINT,
    "weeklyELRewards" BIGINT,
    "monthlyCLRewards" BIGINT,
    "monthlyELRewards" BIGINT,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidatorsStats_pkey" PRIMARY KEY ("validatorId")
);

-- CreateTable
CREATE TABLE "public"."_UserToValidator" (
    "A" BIGINT NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_UserToValidator_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_UserToWithdrawalAddress" (
    "A" BIGINT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserToWithdrawalAddress_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_FeeRewardAddressToUser" (
    "A" TEXT NOT NULL,
    "B" BIGINT NOT NULL,

    CONSTRAINT "_FeeRewardAddressToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Slot_processed_slot_idx" ON "public"."Slot"("processed", "slot");

-- CreateIndex
CREATE INDEX "SyncCommittee_fromEpoch_idx" ON "public"."SyncCommittee"("fromEpoch");

-- CreateIndex
CREATE INDEX "SyncCommittee_toEpoch_idx" ON "public"."SyncCommittee"("toEpoch");

-- CreateIndex
CREATE INDEX "Committee_slot_validatorIndex_idx" ON "public"."Committee"("slot", "validatorIndex");

-- CreateIndex
CREATE INDEX "Committee_slot_attestationDelay_idx" ON "public"."Committee"("slot", "attestationDelay");

-- CreateIndex
CREATE INDEX "Committee_validatorIndex_slot_idx" ON "public"."Committee"("validatorIndex", "slot");

-- CreateIndex
CREATE INDEX "Validator_withdrawalAddress_idx" ON "public"."Validator"("withdrawalAddress");

-- CreateIndex
CREATE INDEX "Validator_status_idx" ON "public"."Validator"("status");

-- CreateIndex
CREATE INDEX "ExecutionRewards_timestamp_address_idx" ON "public"."ExecutionRewards"("timestamp", "address");

-- CreateIndex
CREATE INDEX "HourlyValidatorStats_date_hour_idx" ON "public"."HourlyValidatorStats"("date", "hour");

-- CreateIndex
CREATE INDEX "HourlyBlockAndSyncRewards_date_hour_idx" ON "public"."HourlyBlockAndSyncRewards"("date", "hour");

-- CreateIndex
CREATE INDEX "DailyValidatorStats_date_idx" ON "public"."DailyValidatorStats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "User_loginId_key" ON "public"."User"("loginId");

-- CreateIndex
CREATE UNIQUE INDEX "User_userId_key" ON "public"."User"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_chatId_key" ON "public"."User"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "public"."User"("username");

-- CreateIndex
CREATE INDEX "_UserToValidator_B_index" ON "public"."_UserToValidator"("B");

-- CreateIndex
CREATE INDEX "_UserToWithdrawalAddress_B_index" ON "public"."_UserToWithdrawalAddress"("B");

-- CreateIndex
CREATE INDEX "_FeeRewardAddressToUser_B_index" ON "public"."_FeeRewardAddressToUser"("B");

-- AddForeignKey
ALTER TABLE "public"."Committee" ADD CONSTRAINT "Committee_slot_fkey" FOREIGN KEY ("slot") REFERENCES "public"."Slot"("slot") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_UserToValidator" ADD CONSTRAINT "_UserToValidator_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_UserToValidator" ADD CONSTRAINT "_UserToValidator_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Validator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_UserToWithdrawalAddress" ADD CONSTRAINT "_UserToWithdrawalAddress_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_UserToWithdrawalAddress" ADD CONSTRAINT "_UserToWithdrawalAddress_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."WithdrawalAddress"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_FeeRewardAddressToUser" ADD CONSTRAINT "_FeeRewardAddressToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."FeeRewardAddress"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_FeeRewardAddressToUser" ADD CONSTRAINT "_FeeRewardAddressToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

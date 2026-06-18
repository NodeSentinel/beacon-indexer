-- Store only the withdrawal_credentials prefix because withdrawal_address
-- already stores the execution address projection used by address queries.
ALTER TABLE "public"."validator"
ADD COLUMN "withdrawal_credentials_prefix" CHAR(4);

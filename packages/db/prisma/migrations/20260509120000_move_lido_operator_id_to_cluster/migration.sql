ALTER TABLE "public"."cluster" ADD COLUMN "lido_operator_id" TEXT;

ALTER TABLE "public"."user" DROP COLUMN "lido_operator_id";

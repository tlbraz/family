ALTER TABLE "events" DROP CONSTRAINT "events_driver_id_members_id_fk";
--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "driver_id";
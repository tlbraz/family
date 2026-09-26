CREATE TABLE "member_photos" (
	"member_id" integer PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "photo_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_photos" ADD CONSTRAINT "member_photos_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
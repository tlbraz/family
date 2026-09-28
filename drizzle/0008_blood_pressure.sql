CREATE TABLE "bp_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"systolic" integer NOT NULL,
	"diastolic" integer NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"source" text DEFAULT 'app' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bp_settings" (
	"member_id" integer PRIMARY KEY NOT NULL,
	"telegram_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bp_readings" ADD CONSTRAINT "bp_readings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bp_settings" ADD CONSTRAINT "bp_settings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bp_readings_member_at_idx" ON "bp_readings" USING btree ("member_id","at");
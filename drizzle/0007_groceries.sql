CREATE TABLE "groceries" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"section" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"cleared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "groceries_cleared_idx" ON "groceries" USING btree ("cleared_at");
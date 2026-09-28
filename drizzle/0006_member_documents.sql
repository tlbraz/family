CREATE TABLE "member_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"number" text DEFAULT '' NOT NULL,
	"expires" date,
	"link" text,
	"note" text,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_documents" ADD CONSTRAINT "member_documents_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_documents_member_idx" ON "member_documents" USING btree ("member_id");
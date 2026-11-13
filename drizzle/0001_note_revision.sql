CREATE TABLE "note_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "note_revision_reason_check" CHECK ("note_revision"."reason" in ('autosave', 'rename', 'restore', 'import'))
);
--> statement-breakpoint
ALTER TABLE "note_revision" ADD CONSTRAINT "note_revision_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revision" ADD CONSTRAINT "note_revision_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_revision_note_created_idx" ON "note_revision" USING btree ("note_id","created_at" DESC NULLS FIRST);
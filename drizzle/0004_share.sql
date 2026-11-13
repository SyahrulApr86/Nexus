CREATE TABLE "share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"expires_at" timestamp,
	CONSTRAINT "share_token_hash_check" CHECK ("share"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "share" ADD CONSTRAINT "share_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share" ADD CONSTRAINT "share_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "share_token_hash_uq" ON "share" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_note_idx" ON "share" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "share_vault_idx" ON "share" USING btree ("vault_id");
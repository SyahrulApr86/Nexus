CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_size_check" CHECK ("attachment"."size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_vault_path_uq" ON "attachment" USING btree ("vault_id","path");--> statement-breakpoint
CREATE INDEX "attachment_vault_sha_idx" ON "attachment" USING btree ("vault_id","sha256");
CREATE TABLE "note_ydoc" (
	"note_id" uuid PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_ydoc" ADD CONSTRAINT "note_ydoc_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-written (drizzle-kit does not model triggers): tells the collab service which note changed,
-- so a REST write (PATCH, rename link rewrite, restore, import) is merged into a live document.
-- The payload is only the note id; the listener reads the content itself (NOTIFY payloads are capped at 8000 bytes).
CREATE OR REPLACE FUNCTION "nexus_notify_note_content"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('nexus_note_content', OLD.id::text);
  ELSE
    PERFORM pg_notify('nexus_note_content', NEW.id::text);
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "note_content_notify" AFTER UPDATE OF "content" ON "note"
  FOR EACH ROW WHEN (OLD."content" IS DISTINCT FROM NEW."content")
  EXECUTE FUNCTION "nexus_notify_note_content"();--> statement-breakpoint
CREATE TRIGGER "note_delete_notify" AFTER DELETE ON "note"
  FOR EACH ROW EXECUTE FUNCTION "nexus_notify_note_content"();

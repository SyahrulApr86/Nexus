-- Preserves the pre-trash location so restore can detect a purged original
-- folder (US12-S7); no FK on purpose — it references possibly-deleted rows.
ALTER TABLE "Note" ADD COLUMN "originalFolderId" uuid;

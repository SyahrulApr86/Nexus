-- Fuzzy title matching index (FR-013). Content is encrypted (FR-026) and
-- searched via decrypt-in-SQL; only plaintext title metadata is indexed.
CREATE INDEX IF NOT EXISTS "Note_title_trgm_idx" ON "Note" USING gin (title gin_trgm_ops);

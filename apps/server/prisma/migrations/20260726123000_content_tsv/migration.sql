-- SC-003 fallback: decrypt-in-SQL full scan measured 2.7s @5k notes (>1s budget).
-- contentTsv stores a 'simple'-config lexeme index derived from plaintext at
-- write time. Tradeoff (documented): index leaks content vocabulary, not the
-- full text; content column itself stays pgp-encrypted (FR-026).
ALTER TABLE "Note" ADD COLUMN "contentTsv" tsvector;
CREATE INDEX "Note_contentTsv_idx" ON "Note" USING gin ("contentTsv");
-- Backfill existing rows would require the app key; dev/test DBs are young —
-- rows are re-indexed on next content update.

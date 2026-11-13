import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Better Auth core tables                                             */
/* ------------------------------------------------------------------ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* ------------------------------------------------------------------ */
/* Vault domain                                                        */
/* ------------------------------------------------------------------ */

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** A vault = one Obsidian-style folder of notes. A user may own many. */
export const vault = pgTable(
  "vault",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("vault_owner_idx").on(t.ownerId)],
);

/** Explicit folders, so empty folders survive (like a real filesystem). */
export const folder = pgTable(
  "folder",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vault.id, { onDelete: "cascade" }),
    path: text("path").notNull(), // "Projects/Nexus"
  },
  (t) => [uniqueIndex("folder_vault_path_uq").on(t.vaultId, t.path)],
);

/**
 * A note is a markdown file. `path` is the vault-relative path WITHOUT
 * the .md extension, e.g. "Projects/Nexus/Roadmap". `name` is the last
 * segment and is what [[wikilinks]] resolve against.
 */
export const note = pgTable(
  "note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vault.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    name: text("name").notNull(),
    content: text("content").notNull().default(""),
    frontmatter: jsonb("frontmatter").$type<Record<string, unknown>>(),
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("content", ''))`,
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("note_vault_path_uq").on(t.vaultId, t.path),
    index("note_vault_name_idx").on(t.vaultId, sql`lower(${t.name})`),
    index("note_search_idx").using("gin", t.search),
  ],
);

/** Outgoing [[wikilinks]]. `target` is the normalized link text (lowercased, no alias/heading). */
export const link = pgTable(
  "link",
  {
    sourceId: uuid("source_id")
      .notNull()
      .references(() => note.id, { onDelete: "cascade" }),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vault.id, { onDelete: "cascade" }),
    target: text("target").notNull(),
    embed: boolean("embed").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.sourceId, t.target, t.embed] }),
    index("link_vault_target_idx").on(t.vaultId, t.target),
  ],
);

export const tag = pgTable(
  "tag",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => note.id, { onDelete: "cascade" }),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vault.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.tag] }),
    index("tag_vault_tag_idx").on(t.vaultId, t.tag),
  ],
);

/** Why a revision was taken: the write that was about to overwrite the note. */
export const revisionReasons = ["autosave", "rename", "restore", "import"] as const;
export type RevisionReason = (typeof revisionReasons)[number];

/**
 * File recovery: earlier contents of a note, written just before the note
 * was overwritten. Policy and retention live in src/lib/history.ts.
 */
export const noteRevision = pgTable(
  "note_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => note.id, { onDelete: "cascade" }),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vault.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    reason: text("reason", { enum: revisionReasons }).notNull(),
  },
  (t) => [
    // nullsFirst: drizzle defaults to NULLS LAST, which plain `ORDER BY created_at DESC` cannot use.
    index("note_revision_note_created_idx").on(t.noteId, t.createdAt.desc().nullsFirst()),
    // ON DELETE CASCADE from vault (and user, through vault) needs this to avoid a full scan.
    index("note_revision_vault_idx").on(t.vaultId),
    check(
      "note_revision_reason_check",
      sql`${t.reason} in (${sql.raw(revisionReasons.map((r) => `'${r}'`).join(", "))})`,
    ),
  ],
);

/** Bookmarked notes (Obsidian's Bookmarks core plugin, notes only for now), ordered by `position`. */
export const bookmark = pgTable(
  "bookmark",
  {
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vault.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => note.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.vaultId, t.noteId] }),
    // The primary key leads with vault_id; deleting a note cascades by note_id.
    index("bookmark_note_idx").on(t.noteId),
  ],
);

/**
 * A file stored next to the notes (image, PDF, audio, video). `path` is the vault-relative path
 * WITH its extension ("Assets/photo.png"). The bytes live on disk, content-addressed by `sha256`
 * under NEXUS_DATA_DIR (src/lib/attachments/storage.ts), so identical files in one vault share a blob.
 */
export const attachment = pgTable(
  "attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vault.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("attachment_vault_path_uq").on(t.vaultId, t.path),
    // Blob reference counting (dedup and garbage collection) looks rows up by content.
    index("attachment_vault_sha_idx").on(t.vaultId, t.sha256),
    check("attachment_size_check", sql`${t.size} >= 0`),
  ],
);

export const vaultRelations = relations(vault, ({ many }) => ({
  notes: many(note),
  folders: many(folder),
  attachments: many(attachment),
}));

export const noteRelations = relations(note, ({ one, many }) => ({
  vault: one(vault, { fields: [note.vaultId], references: [vault.id] }),
  links: many(link),
  tags: many(tag),
}));

export const linkRelations = relations(link, ({ one }) => ({
  source: one(note, { fields: [link.sourceId], references: [note.id] }),
}));

export const tagRelations = relations(tag, ({ one }) => ({
  note: one(note, { fields: [tag.noteId], references: [note.id] }),
}));

/* ------------------------------------------------------------------ */
/* Sharing (vaults-sharing track). Self-contained: only this block.    */
/* ------------------------------------------------------------------ */

/**
 * A public, read-only link to one note. Only sha256(token) is stored, as 64 hex characters: the
 * token itself is shown once, when the link is made. A link stops working when it is revoked, when
 * it expires, or when its note is deleted (cascade). Policy lives in src/lib/shares.ts.
 */
export const share = pgTable(
  "share",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vault.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => note.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [
    uniqueIndex("share_token_hash_uq").on(t.tokenHash),
    index("share_note_idx").on(t.noteId),
    // ON DELETE CASCADE from vault needs this to avoid a full scan.
    index("share_vault_idx").on(t.vaultId),
    check("share_token_hash_check", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/* ------------------------------------------------------------------ */
/* Real-time collaboration (collab/ service) — collab-server track     */
/* ------------------------------------------------------------------ */

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

/**
 * The Yjs document of a note (an encoded update holding its whole state), kept so a client that
 * reconnects with its own copy syncs incrementally instead of merging a fresh, unrelated history.
 * `note.content` stays the source of truth: the collab service reconciles the two on load.
 * The migration also adds a trigger that NOTIFYs `nexus_note_content` with the note id whenever
 * note.content changes or a note is deleted, so REST writes reach a live document.
 */
export const noteYdoc = pgTable("note_ydoc", {
  noteId: uuid("note_id")
    .primaryKey()
    .references(() => note.id, { onDelete: "cascade" }),
  state: bytea("state").notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

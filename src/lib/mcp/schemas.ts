import { z } from "zod";
import { NoteContent, NotePath } from "@/lib/notes";
import { MAX_QUERY_LENGTH } from "@/lib/search";
import { MCP_LIMITS } from "./format";

/*
 * Input schemas of the MCP tools (input validation). Every string is bounded, every number is an
 * integer in a range, and unknown keys are refused, so a tool never sees an argument it did not
 * declare. Paths go through the app's own NotePath/NoteContent rules and are normalised and checked
 * again by src/lib/notes.ts.
 */

const NoteId = z.uuid().describe("The note's id, as returned by other tools.");
const NoteRefPath = NotePath.describe('Vault path of the note, without ".md", e.g. "Projects/Nexus/Roadmap". A bare note name also works when it is unique.');

/** A note named by exactly one of `path` or `id`. */
export const NoteRef = z
  .object({ path: NoteRefPath.optional(), id: NoteId.optional() })
  .strict()
  .refine((r) => (r.path === undefined) !== (r.id === undefined), "Give either path or id, not both");

const iso = z.iso
  .datetime({ offset: true })
  .describe("The note's updatedAt exactly as read_note returned it (ISO 8601).");

export const SearchNotesInput = z
  .object({
    query: z
      .string()
      .max(MAX_QUERY_LENGTH)
      .describe(
        'Search query. Words match as prefixes and must all appear. Operators: "exact phrase", -exclude, a OR b, ( ) grouping, tag:#name (or #name), path:Folder/Sub, file:name, line:(words on one line).',
      ),
    limit: z.number().int().min(1).max(MCP_LIMITS.maxSearchResults).optional().describe("Most results to return (default 20, at most 50)."),
  })
  .strict();

export const ReadNoteInput = z
  .object({
    path: NoteRefPath.optional(),
    id: NoteId.optional(),
    offset: z.number().int().min(0).optional().describe("Character offset to start reading at, for long notes (default 0)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MCP_LIMITS.maxReadChars)
      .optional()
      .describe(`Most characters to return (default ${MCP_LIMITS.readChars}).`),
  })
  .strict()
  .refine((r) => (r.path === undefined) !== (r.id === undefined), "Give either path or id, not both");

export const ListNotesInput = z
  .object({
    folder: NotePath.optional().describe('Only notes inside this folder (any depth), e.g. "Projects". Omit for the whole vault.'),
    cursor: NotePath.optional().describe("nextCursor from the previous page."),
    limit: z.number().int().min(1).max(MCP_LIMITS.maxListPage).optional().describe(`Page size (default ${MCP_LIMITS.listPage}).`),
  })
  .strict();

export const ListTagsInput = z
  .object({
    tag: z
      .string()
      .max(200)
      .optional()
      .describe("A tag (with or without #). When given, lists the notes that carry it or a nested tag (tag/sub) instead of all tags."),
  })
  .strict();

export const RecentNotesInput = z
  .object({
    limit: z.number().int().min(1).max(MCP_LIMITS.maxRecent).optional().describe(`How many (default ${MCP_LIMITS.recent}).`),
  })
  .strict();

export const CreateNoteInput = z
  .object({
    path: NotePath.describe('Where to create the note, without ".md", e.g. "Inbox/Meeting notes". Missing folders are created.'),
    content: NoteContent.optional().describe("Markdown content. [[Wikilinks]], #tags and YAML frontmatter work as in the app."),
    template: NotePath.optional().describe(
      'Path of a template note, e.g. "Templates/Meeting". Its {{title}}, {{date}} and {{time}} are filled in; content, if given, goes after it.',
    ),
  })
  .strict();

export const UpdateNoteInput = z
  .object({
    path: NoteRefPath.optional(),
    id: NoteId.optional(),
    content: NoteContent.describe("The note's complete new markdown. It replaces the whole note."),
    baseUpdatedAt: iso,
  })
  .strict()
  .refine((r) => (r.path === undefined) !== (r.id === undefined), "Give either path or id, not both");

export const AppendToNoteInput = z
  .object({
    path: NoteRefPath.optional(),
    id: NoteId.optional(),
    content: NoteContent.refine((s) => s.length > 0, "Nothing to append").describe("Markdown to add at the end of the note, on a new line."),
  })
  .strict()
  .refine((r) => (r.path === undefined) !== (r.id === undefined), "Give either path or id, not both");

export const MoveNoteInput = z
  .object({
    path: NoteRefPath.optional(),
    id: NoteId.optional(),
    newPath: NotePath.describe('The new vault path, without ".md". Links to the note in other notes are updated.'),
    baseUpdatedAt: iso.optional(),
  })
  .strict()
  .refine((r) => (r.path === undefined) !== (r.id === undefined), "Give either path or id, not both");

import "server-only";
import { and, asc, eq, inArray, not, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { note, tag } from "@/db/schema";
import { taskOffsets } from "@/lib/markdown/tasks";
import { HttpError } from "@/lib/session";
import { matchesTask, parseQuery, splitTaskWhere } from "./parse";
import {
  QUERY_LIMITS,
  QuerySyntaxError,
  type Cell,
  type Condition,
  type Field,
  type Query,
  type QueryResponse,
  type QueryResult,
  type QueryTask,
  type Source,
  type Value,
} from "./types";

/*
 * Runs a parsed ```query block against one vault, in SQL. Every value from the query is a bound
 * parameter of Drizzle's sql`` template (property names included, as `->> $n::text`); the only
 * SQL text is fixed in this file. Frontmatter values are stored as text (parse.ts reads a YAML
 * subset), so numbers and dates are cast in SQL, guarded by pg_input_is_valid so an odd value is
 * simply not a match instead of an error. A statement timeout bounds the work and LIMIT bounds
 * the rows; TASK queries read note text, bounded by QUERY_LIMITS.taskNotes and taskChars.
 */

const TIMEOUT = "3s";

/* ------------------------------------------------------------------ */
/* SQL for fields and conditions                                       */
/* ------------------------------------------------------------------ */

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const folderOf = sql`coalesce(substring(${note.path} from '^(.*)/[^/]*$'), '')`;
const propJson = (name: string) => sql`(${note.frontmatter} -> ${name}::text)`;
const propText = (name: string) => sql`(${note.frontmatter} ->> ${name}::text)`;
const asNumber = (x: SQL) => sql`(case when pg_input_is_valid(${x}, 'numeric') then (${x})::numeric end)`;
// The leading date pattern keeps words Postgres would read as dates ("today", "epoch") out.
const asTime = (x: SQL) =>
  sql`(case when ${x} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' and pg_input_is_valid(${x}, 'timestamptz') then (${x})::timestamptz end)`;

/** A comparison operator as fixed SQL text (never from the query). */
function opSql(op: "=" | "<" | ">" | "<=" | ">="): SQL {
  return sql.raw(op);
}

/** SQL that is true or false, never null, so NOT behaves ("not status = done" includes notes without a status). */
const definite = (x: SQL) => sql`coalesce(${x}, false)`;

function hasTag(value: string): SQL {
  const key = value.replace(/^#/, "").replace(/\/+$/, "").toLowerCase();
  return sql`exists (select 1 from ${tag} where ${tag.noteId} = ${note.id} and (${tag.tag} = ${key} or ${tag.tag} like ${`${likeEscape(key)}/%`}))`;
}

function compareTime(column: SQL, op: string, v: Value & { type: "date" }): SQL {
  if (op === "!=") return not(compareTime(column, "=", v));
  const o = opSql(op as "=");
  return v.day
    ? definite(sql`((${column}) at time zone 'UTC')::date ${o} ${v.value}::date`)
    : definite(sql`${column} ${o} ${v.value}::timestamptz`);
}

function compareText(column: SQL, op: string, value: string): SQL {
  if (op === "!=") return not(compareText(column, "=", value));
  if (op === "contains") return definite(sql`strpos(lower(${column}), lower(${value}::text)) > 0`);
  return definite(sql`lower(${column}) ${opSql(op as "=")} lower(${value}::text)`);
}

function compareProp(name: string, op: string, v: Value): SQL {
  if (op === "!=") return not(compareProp(name, "=", v));
  const text = propText(name);
  const json = propJson(name);
  if (v.type === "number") return definite(sql`${asNumber(text)} ${opSql(op as "=")} ${v.value}::numeric`);
  if (v.type === "date") {
    const o = opSql(op as "=");
    return v.day
      ? definite(sql`(${asTime(text)} at time zone 'UTC')::date ${o} ${v.value}::date`)
      : definite(sql`${asTime(text)} ${o} ${v.value}::timestamptz`);
  }
  const value = v.type === "boolean" ? String(v.value) : v.value;
  // A list property (tags: [a, b]) matches when one of its items does.
  const anyItem = (cond: SQL) =>
    sql`exists (select 1 from jsonb_array_elements_text(${json}) as item(v) where ${cond})`;
  if (op === "=" || op === "contains") {
    const itemEq = anyItem(sql`lower(item.v) = lower(${value}::text)`);
    const scalar =
      op === "=" ? sql`lower(${text}) = lower(${value}::text)` : sql`strpos(lower(${text}), lower(${value}::text)) > 0`;
    return definite(sql`(case jsonb_typeof(${json}) when 'array' then ${itemEq} else ${scalar} end)`);
  }
  return definite(
    sql`(case jsonb_typeof(${json}) when 'array' then false else lower(${text}) ${opSql(op as "<")} lower(${value}::text) end)`,
  );
}

function fileColumn(name: "name" | "path" | "folder"): SQL {
  return name === "name" ? sql`${note.name}` : name === "path" ? sql`${note.path}` : folderOf;
}

function conditionSql(c: Condition): SQL {
  switch (c.type) {
    case "and":
      return and(...c.children.map(conditionSql))!;
    case "or":
      return or(...c.children.map(conditionSql))!;
    case "not":
      return not(conditionSql(c.child));
    case "exists": {
      const f = c.field;
      if (f.kind === "prop") {
        const j = propJson(f.name);
        return definite(sql`${j} is not null and ${j} not in ('""'::jsonb, '[]'::jsonb, 'null'::jsonb)`);
      }
      if (f.kind === "file" && f.name === "tags") return sql`exists (select 1 from ${tag} where ${tag.noteId} = ${note.id})`;
      return sql`true`;
    }
    case "compare": {
      const f = c.field;
      if (f.kind === "task") throw new Error("task fields are checked per task");
      if (f.kind === "prop") return compareProp(f.name, c.op, c.value);
      if (f.name === "tags") {
        const has = hasTag(String(c.value.value));
        return c.op === "!=" ? not(has) : has;
      }
      if (f.name === "mtime" || f.name === "ctime")
        return compareTime(sql`${f.name === "mtime" ? note.updatedAt : note.createdAt}`, c.op, c.value as Value & { type: "date" });
      return compareText(fileColumn(f.name), c.op, String(c.value.value));
    }
  }
}

function sourceSql(s: Source): SQL {
  switch (s.type) {
    case "tag":
      return hasTag(s.tag);
    case "folder":
      if (!s.folder) return sql`true`;
      return sql`(lower(${note.path}) = lower(${s.folder}::text) or lower(${note.path}) like lower(${`${likeEscape(s.folder)}/%`}::text))`;
    case "and":
      return and(...s.children.map(sourceSql))!;
    case "or":
      return or(...s.children.map(sourceSql))!;
    case "not":
      return not(sourceSql(s.child));
  }
}

/** ORDER BY terms for one sort key: typed first (numbers, then dates), then as text. */
function sortSql(field: Field, descending: boolean): SQL[] {
  const dir = (x: SQL) => (descending ? sql`${x} desc nulls last` : sql`${x} asc nulls last`);
  if (field.kind === "file") {
    if (field.name === "mtime") return [dir(sql`${note.updatedAt}`)];
    if (field.name === "ctime") return [dir(sql`${note.createdAt}`)];
    return [dir(sql`lower(${fileColumn(field.name as "name")})`)];
  }
  const text = propText(field.name);
  return [dir(asNumber(text)), dir(asTime(text)), dir(sql`lower(${text})`)];
}

/* ------------------------------------------------------------------ */
/* Running                                                             */
/* ------------------------------------------------------------------ */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function cellOf(field: Field, row: { name: string; path: string; frontmatter: Record<string, unknown> | null; createdAt: Date; updatedAt: Date; tags: string[] | null }): Cell {
  if (field.kind === "file") {
    switch (field.name) {
      case "name":
        return row.name;
      case "path":
        return row.path;
      case "folder":
        return row.path.includes("/") ? row.path.slice(0, row.path.lastIndexOf("/")) : "";
      case "mtime":
        return new Date(row.updatedAt).toISOString();
      case "ctime":
        return new Date(row.createdAt).toISOString();
      case "tags":
        return row.tags ?? [];
    }
  }
  const v = row.frontmatter?.[field.name];
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map((x) => String(x)).slice(0, 50);
  if (typeof v === "number") return v;
  return String(v).slice(0, 500);
}

/** The task's text after its box: "- [ ] Call Ana" -> "Call Ana". */
function taskText(content: string, offset: number): string {
  const end = content.indexOf("\n", offset);
  return content.slice(offset + 2, end === -1 ? undefined : end).trim().slice(0, 500);
}

async function execute(tx: Tx, vaultId: string, q: Query): Promise<QueryResult> {
  const { note: noteWhere, task: taskWhere } = q.mode === "task" ? splitTaskWhere(q.where) : { note: q.where, task: null };
  const filters: SQL[] = [eq(note.vaultId, vaultId)];
  // Canvas files are JSON, not notes with properties or tasks.
  filters.push(sql`${note.path} not ilike '%.canvas'`);
  if (q.from) filters.push(sourceSql(q.from));
  if (noteWhere) filters.push(conditionSql(noteWhere));
  const order = [...q.sort.flatMap((k) => sortSql(k.field, k.desc)), asc(sql`lower(${note.name})`), asc(note.path)];
  const needsTags = q.mode === "table" && q.columns.some((c) => c.field.kind === "file" && c.field.name === "tags");

  if (q.mode === "task") {
    // Only notes that can hold a task, most relevant first, within the read budget.
    filters.push(sql`${note.content} ~ '\\[[ xX]\\]'`);
    const rows = await tx
      .select({ id: note.id, path: note.path, name: note.name, size: sql<number>`length(${note.content})`.mapWith(Number) })
      .from(note)
      .where(and(...filters))
      .orderBy(...order)
      .limit(QUERY_LIMITS.taskNotes + 1);
    let truncated = rows.length > QUERY_LIMITS.taskNotes;
    const picked: typeof rows = [];
    let budget = QUERY_LIMITS.taskChars;
    for (const r of rows.slice(0, QUERY_LIMITS.taskNotes)) {
      if (r.size > budget) {
        truncated = true;
        continue;
      }
      budget -= r.size;
      picked.push(r);
    }
    const contents = new Map<string, string>();
    if (picked.length) {
      const texts = await tx
        .select({ id: note.id, content: note.content })
        .from(note)
        .where(and(eq(note.vaultId, vaultId), inArray(note.id, picked.map((r) => r.id))));
      for (const t of texts) contents.set(t.id, t.content);
    }
    const max = q.limit ?? QUERY_LIMITS.tasks;
    const groups: { note: { id: string; path: string; name: string }; tasks: QueryTask[] }[] = [];
    let count = 0;
    for (const r of picked) {
      const content = contents.get(r.id);
      if (content === undefined) continue;
      const tasks: QueryTask[] = [];
      for (const offset of taskOffsets(content)) {
        const t = { offset, completed: content[offset] !== " ", text: taskText(content, offset) };
        if (taskWhere && !matchesTask(taskWhere, t)) continue;
        if (count >= max) {
          truncated = truncated || q.limit === null;
          break;
        }
        tasks.push(t);
        count++;
      }
      if (tasks.length) groups.push({ note: { id: r.id, path: r.path, name: r.name }, tasks });
      if (count >= max) break;
    }
    return { kind: "task", groups, truncated };
  }

  const max = q.limit ?? QUERY_LIMITS.rows;
  const rows = await tx
    .select({
      id: note.id,
      path: note.path,
      name: note.name,
      frontmatter: note.frontmatter,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      tags: needsTags
        ? sql<string[]>`(select coalesce(array_agg(${tag.tag} order by ${tag.tag}), '{}') from ${tag} where ${tag.noteId} = ${note.id})`
        : sql<null>`null`,
    })
    .from(note)
    .where(and(...filters))
    .orderBy(...order)
    .limit(max + 1);
  const truncated = q.limit === null && rows.length > max;
  const kept = rows.slice(0, max);
  if (q.mode === "list") return { kind: "list", rows: kept.map(({ id, path, name }) => ({ id, path, name })), truncated };
  return {
    kind: "table",
    columns: q.columns.map((c) => c.label),
    rows: kept.map((r) => ({ id: r.id, path: r.path, name: r.name, cells: q.columns.map((c) => cellOf(c.field, r)) })),
    truncated,
  };
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

/**
 * A cheap fingerprint of the vault's notes: count, newest edit and total path length. Any save,
 * create, delete, rename or move changes it (links and tags change only through saves), so a cached
 * result with the same stamp is still right.
 */
async function vaultStamp(vaultId: string): Promise<string> {
  const [row] = await db
    .select({
      n: sql<number>`count(*)`.mapWith(Number),
      at: sql<string | null>`max(${note.updatedAt})::text`,
      len: sql<number>`coalesce(sum(length(${note.path})), 0)`.mapWith(Number),
    })
    .from(note)
    .where(eq(note.vaultId, vaultId));
  return `${row?.n ?? 0}.${row?.len ?? 0}.${row?.at ?? ""}`;
}

const CACHE_SIZE = 300;
const cache = new Map<string, QueryResult>();

function remember(key: string, result: QueryResult) {
  cache.delete(key);
  cache.set(key, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** Drops every cached result (tests). */
export function clearQueryCache() {
  cache.clear();
}

function position(err: QuerySyntaxError) {
  return { message: err.message, line: err.position.line, column: err.position.column };
}

/**
 * Runs a query block's source in a vault. Syntax and range errors come back as { ok: false } with
 * the line and column; a timeout is a 503. `since`: the stamp of the result the caller already
 * has; when nothing changed the answer is { unchanged: true }.
 */
export async function runQuery(vaultId: string, source: string, since?: string, now = new Date()): Promise<QueryResponse> {
  let q: Query;
  try {
    q = parseQuery(source, { now });
    if (q.mode === "task") splitTaskWhere(q.where);
  } catch (err) {
    if (err instanceof QuerySyntaxError) return { ok: false, error: position(err) };
    throw err;
  }
  const stamp = `${await vaultStamp(vaultId)}.${now.toISOString().slice(0, 10)}`;
  // Queries that mention `now` change by the minute, not with the vault alone.
  const live = /\bnow\b/i.test(source) ? `.${Math.floor(now.getTime() / 60_000)}` : "";
  const fullStamp = stamp + live;
  if (since && since === fullStamp) return { ok: true, stamp: fullStamp, unchanged: true };
  const key = `${vaultId}\u0000${fullStamp}\u0000${source}`;
  const hit = cache.get(key);
  if (hit) {
    remember(key, hit);
    return { ok: true, stamp: fullStamp, result: hit };
  }
  let result: QueryResult;
  try {
    result = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local statement_timeout = '${TIMEOUT}'`));
      return execute(tx, vaultId, q);
    });
  } catch (err) {
    const e = err as { code?: unknown; cause?: { code?: unknown } };
    if ((e.cause?.code ?? e.code) === "57014")
      throw new HttpError(503, "This query took too long. Narrow it with FROM, WHERE or LIMIT.");
    throw err;
  }
  remember(key, result);
  return { ok: true, stamp: fullStamp, result };
}

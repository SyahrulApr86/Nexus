import { z } from "zod";
import { KiB, handle, rateLimit, readJson, requireVault } from "@/lib/session";
import { ShareOptions, createShare, listShares, shareUrl } from "@/lib/shares";

type Ctx = { params: Promise<{ id: string }> };

const Id = z.uuid();

/** GET: the note's live public links, newest first: { id, noteId, createdAt, expiresAt }[] (never a token or URL). */
export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { vaultId } = await requireVault();
    const id = Id.parse((await params).id);
    return listShares(vaultId, id);
  });
}

/**
 * POST { expiresInDays?: 1..365 | null }: make a public read-only link to the note. 201 with
 * { id, noteId, createdAt, expiresAt, url }. The URL is returned this once: only its hash is stored.
 */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { user, vaultId } = await requireVault();
    rateLimit(`share-create:${user.id}`, 30, 60_000);
    const id = Id.parse((await params).id);
    const opts = ShareOptions.parse(await readJson(req, 1 * KiB));
    const { token, ...link } = await createShare(vaultId, id, opts);
    return Response.json({ ...link, url: shareUrl(token, req.url) }, { status: 201 });
  });
}

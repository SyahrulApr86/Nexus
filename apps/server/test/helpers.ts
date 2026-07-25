import { prisma } from "../src/db.js";
import { redis } from "../src/redis.js";
import { buildApp } from "../src/app.js";

export const app = buildApp().app;

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "User", "Vault", "Folder", "Note", "NoteVersion", "WikilinkRef", "PasswordResetToken" CASCADE',
  );
  await redis.flushdb();
}

export async function api(
  path: string,
  init: RequestInit & { cookie?: string } = {},
) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (init.cookie) headers.set("cookie", init.cookie);
  return app.request(`/api${path}`, { ...init, headers });
}

export function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no set-cookie header");
  const match = setCookie.match(/nexus_session=[^;]+/);
  if (!match) throw new Error(`no nexus_session in: ${setCookie}`);
  return match[0];
}

export const GOOD_PW = "Sup3r$ecret";

/** Register + login a user, returning their session cookie and user id. */
export async function registerAndLogin(email = "user@example.com") {
  const reg = await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password: GOOD_PW }),
  });
  if (reg.status !== 201) {
    throw new Error(`register failed: ${reg.status} ${await reg.text()}`);
  }
  const body = (await reg.json()) as { user: { id: string } };
  return { cookie: sessionCookie(reg), userId: body.user.id };
}

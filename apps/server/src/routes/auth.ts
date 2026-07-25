import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { hash, verify } from "@node-rs/argon2";
import {
  loginSchema,
  registerSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  updatePreferencesSchema,
  type UserDto,
} from "@nexus/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { sendMail } from "../lib/mail.js";
import { clearFailures, isLocked, recordFailure } from "../lib/lockout.js";
import { createSession, destroySession } from "../lib/session.js";
import { requireAuth, SESSION_COOKIE } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 60 min (FR-002a)

function toUserDto(user: {
  id: string;
  email: string;
  displayName: string | null;
  theme: string;
  idleTimeoutMinutes: number;
}): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    theme: user.theme as UserDto["theme"],
    idleTimeoutMinutes: user.idleTimeoutMinutes,
  };
}

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "Lax",
    path: "/",
  });
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const authRoutes = new Hono()
  .use(
    "/register",
    rateLimit({ name: "register", limit: 20, windowSeconds: 60 }),
  )
  .use("/login", rateLimit({ name: "login", limit: 30, windowSeconds: 60 }))
  .use(
    "/request-password-reset",
    rateLimit({ name: "reset", limit: 10, windowSeconds: 60 }),
  )
  .post("/register", zValidator("json", registerSchema), async (c) => {
    const { email, password, displayName } = c.req.valid("json");
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return c.json(
        { error: "This email is already registered. Try logging in instead." },
        409,
      );
    }
    const passwordHash = await hash(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: displayName ?? null,
        vault: { create: {} },
      },
      include: { vault: true },
    });
    const token = await createSession(
      { userId: user.id, vaultId: user.vault!.id },
      user.idleTimeoutMinutes,
    );
    setSessionCookie(c, token);
    return c.json({ user: toUserDto(user) }, 201);
  })

  .post("/login", zValidator("json", loginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    if (await isLocked(email)) {
      return c.json(
        {
          error:
            "Account temporarily locked after too many failed attempts. Try again in 15 minutes or reset your password.",
          code: "LOCKED",
        },
        423,
      );
    }
    const user = await prisma.user.findUnique({
      where: { email },
      include: { vault: true },
    });
    const valid =
      user !== null && (await verify(user.passwordHash, password));
    if (!user || !valid) {
      const nowLocked = await recordFailure(email);
      if (nowLocked) {
        return c.json(
          {
            error:
              "Account temporarily locked after too many failed attempts. Try again in 15 minutes or reset your password.",
            code: "LOCKED",
          },
          423,
        );
      }
      // Generic error — identical for unknown email and wrong password (US1-S4)
      return c.json({ error: "Invalid email or password" }, 401);
    }
    await clearFailures(email);
    const token = await createSession(
      { userId: user.id, vaultId: user.vault!.id },
      user.idleTimeoutMinutes,
    );
    setSessionCookie(c, token);
    return c.json({ user: toUserDto(user) });
  })

  .post("/logout", requireAuth, async (c) => {
    await destroySession(c.get("sessionToken"));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  })

  .get("/me", requireAuth, async (c) => {
    const user = await prisma.user.findUnique({
      where: { id: c.get("userId") },
    });
    if (!user) return c.json({ error: "Not found" }, 404);
    return c.json({ user: toUserDto(user) });
  })

  .patch(
    "/preferences",
    requireAuth,
    zValidator("json", updatePreferencesSchema),
    async (c) => {
      const updates = c.req.valid("json");
      const user = await prisma.user.update({
        where: { id: c.get("userId") },
        data: updates,
      });
      return c.json({ user: toUserDto(user) });
    },
  )

  .post(
    "/request-password-reset",
    zValidator("json", requestPasswordResetSchema),
    async (c) => {
      const { email } = c.req.valid("json");
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        const raw = randomBytes(32).toString("base64url");
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: sha256(raw),
            expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          },
        });
        await sendMail({
          to: email,
          subject: "Reset your Nexus password",
          text: `Reset your password (valid for 60 minutes):\n\n${env.APP_ORIGIN}/reset-password?token=${raw}\n\nIf you didn't request this, ignore this email.`,
        });
      }
      // Identical acknowledgement regardless of registration status (US1b-S1)
      return c.json({
        message:
          "If that email is registered, a reset link has been sent. Check your inbox.",
      });
    },
  )

  .post(
    "/reset-password",
    zValidator("json", resetPasswordSchema),
    async (c) => {
      const { token, password } = c.req.valid("json");
      const record = await prisma.passwordResetToken.findUnique({
        where: { tokenHash: sha256(token) },
        include: { user: true },
      });
      if (!record || record.usedAt || record.expiresAt < new Date()) {
        return c.json(
          {
            error:
              "This reset link is invalid or has expired. Please request a new one.",
          },
          400,
        );
      }
      const passwordHash = await hash(password);
      await prisma.$transaction([
        prisma.user.update({
          where: { id: record.userId },
          data: { passwordHash },
        }),
        prisma.passwordResetToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        }),
      ]);
      // PRD edge case: reset immediately clears an active lockout
      await clearFailures(record.user.email);
      return c.json({ message: "Password updated. You can now log in." });
    },
  );

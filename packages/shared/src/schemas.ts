import { z } from "zod";

/**
 * FR-001: password policy with specific, field-level feedback.
 * Returns an empty array when the password conforms.
 */
export function validatePassword(password: string): string[] {
  const failures: string[] = [];
  if (password.length < 8)
    failures.push("Password must be at least 8 characters");
  if (!/[A-Z]/.test(password))
    failures.push("Password must include at least one uppercase letter");
  if (!/[a-z]/.test(password))
    failures.push("Password must include at least one lowercase letter");
  if (!/[0-9]/.test(password))
    failures.push("Password must include at least one digit");
  if (!/[^A-Za-z0-9]/.test(password))
    failures.push("Password must include at least one special character");
  return failures;
}

export const passwordSchema = z.string().superRefine((pw, ctx) => {
  for (const message of validatePassword(pw)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }
});

export const emailSchema = z.string().trim().toLowerCase().email();

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(100).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string(),
});

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const updatePreferencesSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  idleTimeoutMinutes: z.number().int().min(5).max(120).optional(),
});

export const createNoteSchema = z.object({
  title: z.string().trim().max(500).default(""),
  content: z.string().max(5_000_000).default(""),
  folderId: z.string().uuid().nullable().default(null),
});

export const updateNoteSchema = z.object({
  title: z.string().trim().max(500).optional(),
  content: z.string().max(5_000_000).optional(),
  // Optimistic-concurrency check (US2-S5): client sends the updatedAt it
  // last saw; server reports conflict if newer.
  baseUpdatedAt: z.string().datetime().optional(),
});

export const moveNoteSchema = z.object({
  folderId: z.string().uuid().nullable(),
});

export const reorderSchema = z.object({
  position: z.number().int().min(0),
});

export const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parentId: z.string().uuid().nullable().default(null),
});

export const renameFolderSchema = z.object({
  name: z.string().trim().min(1).max(255),
});

export const moveFolderSchema = z.object({
  parentId: z.string().uuid().nullable(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

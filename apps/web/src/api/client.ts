export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public issues?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    let issues: unknown;
    try {
      const body = await res.json();
      // zod-validator error shape: { success:false, error:{ issues:[...] } }
      if (body.error?.issues) {
        issues = body.error.issues;
        message = body.error.issues
          .map((i: { message: string }) => i.message)
          .join("\n");
      } else {
        message = body.error ?? message;
        code = body.code;
      }
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, message, code, issues);
  }
  return res.json() as Promise<T>;
}

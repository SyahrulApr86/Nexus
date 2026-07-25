import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { UserDto } from "@nexus/shared";
import { api, ApiError } from "./api/client.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage.js";
import { ResetPasswordPage } from "./pages/ResetPasswordPage.js";
import { WorkspaceHome, WorkspacePage } from "./pages/WorkspacePage.js";
import { NoteEditorScreen } from "./pages/NotePage.js";
import { TrashPage } from "./pages/TrashPage.js";
import { TagPage } from "./pages/TagPage.js";
import { GraphPage } from "./pages/GraphPage.js";
import { applyTheme, type Theme } from "./theme.js";

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
});

/** Fetch current user once per navigation into the authed tree. */
async function ensureUser(queryClient: QueryClient): Promise<UserDto | null> {
  return queryClient.ensureQueryData({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const { user } = await api<{ user: UserDto }>("/auth/me");
        return user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          if (e.code === "SESSION_EXPIRED") {
            throw redirect({ to: "/login", search: { expired: true } });
          }
          return null;
        }
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "workspace",
  beforeLoad: async ({ context }) => {
    const user = await ensureUser(context.queryClient);
    if (!user) throw redirect({ to: "/login" });
    applyTheme(user.theme as Theme);
    return { user };
  },
  component: WorkspacePage,
});

export const workspaceHomeRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/",
  component: WorkspaceHome,
});

function NoteRouteComponent() {
  const { noteId } = noteRoute.useParams();
  return <NoteEditorScreen key={noteId} noteId={noteId} />;
}

export const noteRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/notes/$noteId",
  component: NoteRouteComponent,
});

export const trashRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/trash",
  component: TrashPage,
});

function TagRouteComponent() {
  const { tagName } = tagRoute.useParams();
  return <TagPage key={tagName} tagName={tagName} />;
}

export const tagRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/tags/$tagName",
  component: TagRouteComponent,
});

export const graphRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/graph",
  component: GraphPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (
    s: Record<string, unknown>,
  ): { expired?: boolean; reset?: boolean } => ({
    ...(s.expired === true || s.expired === "true" ? { expired: true } : {}),
    ...(s.reset === true || s.reset === "true" ? { reset: true } : {}),
  }),
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  component: RegisterPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPasswordPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  validateSearch: (s: Record<string, unknown>): { token?: string } => ({
    ...(typeof s.token === "string" ? { token: s.token } : {}),
  }),
  component: ResetPasswordPage,
});

const routeTree = rootRoute.addChildren([
  workspaceRoute.addChildren([
    workspaceHomeRoute,
    noteRoute,
    trashRoute,
    tagRoute,
    graphRoute,
  ]),
  loginRoute,
  registerRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
]);

export function buildRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof buildRouter>;
  }
}

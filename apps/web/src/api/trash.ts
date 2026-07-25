import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { TrashedItemDto } from "@nexus/shared";
import { api } from "./client.js";

export function useTrash() {
  return useQuery({
    queryKey: ["trash"],
    queryFn: () =>
      api<{ items: TrashedItemDto[] }>("/trash").then((r) => r.items),
  });
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["trash"] });
    qc.invalidateQueries({ queryKey: ["notes"] });
    qc.invalidateQueries({ queryKey: ["folders"] });
  };
}

export function useRestore() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ type, id }: { type: "note" | "folder"; id: string }) =>
      api<{ ok: true; restoredToRoot: boolean }>(`/trash/${type}/${id}/restore`, {
        method: "POST",
      }),
    onSuccess: invalidate,
  });
}

export function usePermanentDelete() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ type, id }: { type: "note" | "folder"; id: string }) =>
      api(`/trash/${type}/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useTrashedVersions(noteId: string | null) {
  return useQuery({
    queryKey: ["trash-versions", noteId],
    enabled: noteId !== null,
    queryFn: () =>
      api<{
        versions: { id: string; createdAt: string }[];
      }>(`/trash/note/${noteId}/versions`).then((r) => r.versions),
  });
}

export function useVersionContent(noteId: string | null, versionId: string | null) {
  return useQuery({
    queryKey: ["trash-version-content", noteId, versionId],
    enabled: noteId !== null && versionId !== null,
    queryFn: () =>
      api<{ content: string; createdAt: string }>(
        `/trash/note/${noteId}/versions/${versionId}`,
      ),
  });
}

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { FolderDto } from "@nexus/shared";
import { api } from "./client.js";

export function useFolderTree() {
  return useQuery({
    queryKey: ["folders"],
    queryFn: () => api<{ tree: FolderDto[] }>("/folders/tree").then((r) => r.tree),
  });
}

function useInvalidateVault() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["folders"] });
    qc.invalidateQueries({ queryKey: ["notes"] });
  };
}

export function useCreateFolder() {
  const invalidate = useInvalidateVault();
  return useMutation({
    mutationFn: (input: { name: string; parentId?: string | null }) =>
      api<{ folder: { id: string } }>("/folders", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useRenameFolder() {
  const invalidate = useInvalidateVault();
  return useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      api(`/folders/${folderId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: invalidate,
  });
}

export function useMoveFolder() {
  const invalidate = useInvalidateVault();
  return useMutation({
    mutationFn: ({
      folderId,
      parentId,
    }: {
      folderId: string;
      parentId: string | null;
    }) =>
      api(`/folders/${folderId}/move`, {
        method: "POST",
        body: JSON.stringify({ parentId }),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteFolder() {
  const invalidate = useInvalidateVault();
  return useMutation({
    mutationFn: (folderId: string) =>
      api(`/folders/${folderId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useMoveNote() {
  const invalidate = useInvalidateVault();
  return useMutation({
    mutationFn: ({
      noteId,
      folderId,
    }: {
      noteId: string;
      folderId: string | null;
    }) =>
      api(`/notes/${noteId}/move`, {
        method: "POST",
        body: JSON.stringify({ folderId }),
      }),
    onSuccess: invalidate,
  });
}

export function useReorderNote() {
  const invalidate = useInvalidateVault();
  return useMutation({
    mutationFn: ({ noteId, position }: { noteId: string; position: number }) =>
      api(`/notes/${noteId}/reorder`, {
        method: "POST",
        body: JSON.stringify({ position }),
      }),
    onSuccess: invalidate,
  });
}

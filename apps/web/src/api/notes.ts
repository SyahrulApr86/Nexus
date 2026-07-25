import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { NoteDto, NoteSummaryDto, NoteVersionDto } from "@nexus/shared";
import { api } from "./client.js";

export function useNotes(folderId?: string | null) {
  return useQuery({
    queryKey: ["notes", { folderId: folderId ?? null }],
    queryFn: () =>
      api<{ notes: NoteSummaryDto[] }>(
        folderId ? `/notes?folderId=${folderId}` : "/notes",
      ).then((r) => r.notes),
  });
}

export interface NoteLinkDto {
  targetTitle: string;
  targetNoteId: string | null;
}

export function useNote(noteId: string | null) {
  return useQuery({
    queryKey: ["note", noteId],
    enabled: noteId !== null,
    queryFn: () =>
      api<{
        note: NoteDto;
        versions: NoteVersionDto[];
        links: NoteLinkDto[];
      }>(`/notes/${noteId}`),
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; folderId?: string | null }) =>
      api<{ note: NoteDto }>("/notes", {
        method: "POST",
        body: JSON.stringify(input),
      }).then((r) => r.note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export interface UpdateNoteInput {
  noteId: string;
  title?: string;
  content?: string;
  baseUpdatedAt?: string;
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, ...body }: UpdateNoteInput) =>
      api<{ note: NoteDto; links: NoteLinkDto[] }>(`/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: ({ note, links }) => {
      // Patch the cache in place. Refetching here would re-download and
      // re-decrypt the whole note after every autosave — brutal on long notes.
      qc.setQueryData(
        ["note", note.id],
        (
          old:
            | { note: NoteDto; versions: NoteVersionDto[]; links: NoteLinkDto[] }
            | undefined,
        ) => (old ? { ...old, note, links } : old),
      );
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) =>
      api(`/notes/${noteId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["trash"] });
    },
  });
}

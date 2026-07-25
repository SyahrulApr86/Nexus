import { useQuery } from "@tanstack/react-query";
import type { NoteSummaryDto, TagDto } from "@nexus/shared";
import { api } from "./client.js";

export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: () => api<{ tags: TagDto[] }>("/tags").then((r) => r.tags),
  });
}

export function useTagNotes(name: string | null) {
  return useQuery({
    queryKey: ["tag-notes", name],
    enabled: name !== null,
    queryFn: () =>
      api<{ notes: NoteSummaryDto[] }>(
        `/tags/${encodeURIComponent(name!)}/notes`,
      ).then((r) => r.notes),
  });
}

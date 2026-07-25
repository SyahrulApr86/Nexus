import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "./Toast.js";
import { Icon } from "./Icon.js";

async function uploadForm(path: string, form: FormData) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Import failed");
  }
  return res.json() as Promise<{ imported: number; skipped?: number }>;
}

/** FR-024/033..036: export download + file/ZIP import entry points. */
export function ImportExport() {
  const filesRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notes"] });
    qc.invalidateQueries({ queryKey: ["folders"] });
    qc.invalidateQueries({ queryKey: ["tags"] });
    qc.invalidateQueries({ queryKey: ["graph"] });
  };

  const importFiles = useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      return uploadForm("/import/files", form);
    },
    onSuccess: ({ imported }) => {
      invalidate();
      toast(`Imported ${imported} note${imported === 1 ? "" : "s"}.`);
    },
    onError: (e) => toast(e.message, "warning"),
  });

  const importZip = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return uploadForm("/import/zip", form);
    },
    onSuccess: ({ imported, skipped }) => {
      invalidate();
      toast(
        `Imported ${imported} note${imported === 1 ? "" : "s"}${
          skipped ? `, skipped ${skipped} non-Markdown file(s)` : ""
        }.`,
      );
    },
    onError: (e) => toast(e.message, "warning"),
  });

  const linkClass =
    "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[13px] text-ink hover:bg-card";

  return (
    <div className="border-t border-border px-2 py-2">
      <a href="/api/export" download className={linkClass}>
        <Icon name="download" className="text-muted" /> Export vault (.zip)
      </a>
      <button
        type="button"
        className={linkClass}
        onClick={() => filesRef.current?.click()}
      >
        <Icon name="upload" className="text-muted" /> Import Markdown files
      </button>
      <button
        type="button"
        className={linkClass}
        onClick={() => zipRef.current?.click()}
      >
        <Icon name="upload" className="text-muted" /> Import ZIP archive
      </button>
      <input
        ref={filesRef}
        type="file"
        accept=".md,.markdown"
        multiple
        hidden
        aria-label="Markdown files to import"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) importFiles.mutate(files);
          e.target.value = "";
        }}
      />
      <input
        ref={zipRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        aria-label="ZIP archive to import"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importZip.mutate(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

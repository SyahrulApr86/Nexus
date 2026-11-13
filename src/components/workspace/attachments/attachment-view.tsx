"use client";

import { useState } from "react";
import { attachmentUrl, kindOf } from "@/lib/markdown/attachments";
import { useAttachments } from "./context";
import { Lightbox } from "./lightbox";
import { baseName, embedLink, folderOf, formatSize, kindLabel } from "./model";

const BUTTON =
  "inline-flex h-9 items-center rounded-lg border border-control px-3 text-[13px] font-medium transition-colors hover:bg-sheet-hover pointer-coarse:h-11";

/** A tab showing one attachment: the image, PDF, audio or video, with what can be done to it. */
export function AttachmentView({ path, onClose }: { path: string; onClose: () => void }) {
  const att = useAttachments();
  const [zoom, setZoom] = useState(false);
  const name = baseName(path);
  const item = att?.items.find((x) => x.path === path);

  if (!att || (!item && att.status === "loading")) {
    return (
      <div className="att-view" role="status" aria-busy="true">
        <span className="sr-only">Loading {name}…</span>
      </div>
    );
  }
  if (!item) {
    return (
      <div className="att-view">
        <h1 className="att-view-title" translate="no">
          {name}
        </h1>
        <p className="text-muted">
          {att.status === "error"
            ? "Couldn’t load your attachments. Try again in a moment."
            : "This file no longer exists. It was deleted, maybe on another device."}
        </p>
        <button
          type="button"
          className="mt-3 font-medium text-accent-ink hover:underline"
          onClick={att.status === "error" ? () => void att.refresh() : onClose}
        >
          {att.status === "error" ? "Try again" : "Close tab"}
        </button>
      </div>
    );
  }

  const url = attachmentUrl(item);
  const kind = kindOf(item.mime);
  const folder = folderOf(item.path);
  return (
    <div className="att-view">
      <h1 className="att-view-title" translate="no">
        {name}
      </h1>
      <p className="att-view-meta">
        {kindLabel(item.mime)} · {formatSize(item.size)}
        {folder ? (
          <>
            {" · in "}
            <span translate="no">{folder}</span>
          </>
        ) : (
          " · in the vault root"
        )}
      </p>
      <div className="att-view-actions">
        <button type="button" className={BUTTON} onClick={() => att.copyEmbed(item.path)}>
          Copy embed link
        </button>
        <a className={BUTTON} href={url} download={name}>
          Download
        </a>
        <button type="button" className={`${BUTTON} att-danger`} onClick={() => void att.remove(item.path).then((gone) => gone && onClose())}>
          Delete file
        </button>
      </div>
      <div className="att-view-body">
        {kind === "image" && (
          <button type="button" className="att-view-zoom" aria-haspopup="dialog" aria-label={`View ${name} full size`} onClick={() => setZoom(true)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a vault file served by our own route */}
            <img src={url} alt="" />
          </button>
        )}
        {kind === "video" && (
          <video controls preload="metadata" playsInline src={url} aria-label={name}>
            <a href={url} download={name}>
              Download {name}
            </a>
          </video>
        )}
        {kind === "audio" && (
          <audio controls preload="metadata" src={url} aria-label={name}>
            <a href={url} download={name}>
              Download {name}
            </a>
          </audio>
        )}
        {(kind === "pdf" || kind === "file") && (
          // The CSP forbids framing, so a PDF opens in the browser's own viewer in a new tab.
          <a className="att-view-card" href={url} target="_blank" rel="noopener">
            <span className="att-view-card-name" translate="no">
              {name}
            </span>
            <span className="att-view-card-meta">{kind === "pdf" ? "PDF, opens in a new tab" : "File, opens in a new tab"}</span>
          </a>
        )}
      </div>
      <p className="att-view-hint">
        Embed it in a note with <code translate="no">{embedLink(item.path)}</code>
      </p>
      {zoom && <Lightbox image={{ src: url, alt: name }} onClose={() => setZoom(false)} />}
    </div>
  );
}

"use client";

import { X } from "lucide-react";
import { IconButton, Modal } from "../ui";

export type LightboxImage = { src: string; alt: string };

/** One image at full size over a scrim. Escape, the close button or a click outside closes it. */
export function Lightbox({ image, onClose }: { image: LightboxImage; onClose: () => void }) {
  const label = image.alt ? `Image: ${image.alt}` : "Image";
  return (
    <Modal label={label} onClose={onClose} className="att-lightbox max-w-none">
      <div className="att-lightbox-frame" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a vault file served by our own route, at its own size */}
        <img src={image.src} alt={image.alt} className="att-lightbox-img" />
        <IconButton label="Close image" data-autofocus className="att-lightbox-close size-11" onClick={onClose}>
          <X />
        </IconButton>
      </div>
    </Modal>
  );
}

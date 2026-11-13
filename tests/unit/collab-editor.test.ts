import { describe, expect, it } from "vitest";
import {
  applySplices,
  backoff,
  closeAction,
  collabUrl,
  initials,
  needsRestSave,
  presenceColors,
  presenceLabel,
  presenceSlot,
  safeColor,
  seedSplices,
} from "../../src/components/workspace/collab/mode";
import { collabConnectSource, contentSecurityPolicy } from "../../next.config";

/** The shared text after seeding, as the session applies it. */
const seeded = (server: string | undefined, doc: string, editor: string) => applySplices(doc, seedSplices(server, doc, editor));

describe("collab mode: service URL", () => {
  const https = { protocol: "https:", host: "notes.example.test" };
  const http = { protocol: "http:", host: "localhost:3000" };

  it("uses the same origin at /collab when nothing is configured", () => {
    expect(collabUrl(undefined, https)).toBe("wss://notes.example.test/collab");
    expect(collabUrl("", http)).toBe("ws://localhost:3000/collab");
  });

  it("takes NEXT_PUBLIC_COLLAB_URL with or without the /collab path", () => {
    expect(collabUrl("ws://localhost:3001", http)).toBe("ws://localhost:3001/collab");
    expect(collabUrl("wss://live.example.test/collab/", https)).toBe("wss://live.example.test/collab");
    expect(collabUrl("https://live.example.test", https)).toBe("wss://live.example.test/collab");
  });

  it("turns live mode off for anything that is not a websocket URL", () => {
    expect(collabUrl("ftp://x.test", https)).toBeNull();
    expect(collabUrl("not a url", https)).toBeNull();
    expect(collabUrl(undefined, { protocol: "https:", host: "" })).toBeNull();
  });
});

describe("collab mode: close codes", () => {
  it("follows the table in collab/README.md", () => {
    expect(closeAction(4401)).toBe("signed-out");
    expect(closeAction(4404)).toBe("deleted");
    expect(closeAction(4413)).toBe("too-large");
    expect(closeAction(1009)).toBe("too-large");
    for (const code of [1001, 1006, 4408, 1003, 1000]) expect(closeAction(code)).toBe("reconnect");
  });

  it("backs off from 1 s to at most 30 s (plus jitter)", () => {
    expect(backoff(1, () => 0)).toBe(1000);
    expect(backoff(3, () => 0)).toBe(4000);
    expect(backoff(20, () => 0)).toBe(30_000);
    expect(backoff(20, () => 1)).toBe(36_000);
  });
});

describe("collab mode: REST to live never loses text", () => {
  it("takes the shared text when this device has nothing unsaved", () => {
    expect(seeded("a b", "a b c", "a b")).toBe("a b c");
  });

  it("puts unsaved local edits into an unchanged document", () => {
    expect(seeded("hello", "hello", "hello world")).toBe("hello world");
  });

  it("keeps both when the local edit and the document's change are apart", () => {
    const server = "# Title\n\nfirst\n\nlast\n";
    const doc = "# Title\n\nfirst\n\nlast\nremote line\n";
    const editor = "# Title edited\n\nfirst\n\nlast\n";
    expect(seeded(server, doc, editor)).toBe("# Title edited\n\nfirst\n\nlast\nremote line\n");
    // And the other way round: the local edit after the document's change.
    expect(seeded(server, "# Title remote\n\nfirst\n\nlast\n", "# Title\n\nfirst\n\nlast\nmine\n")).toBe(
      "# Title remote\n\nfirst\n\nlast\nmine\n",
    );
  });

  it("lets the local text win where both changed the same place", () => {
    expect(seeded("one two three", "one 2 three", "one TWO three")).toBe("one TWO three");
  });

  it("keeps the local text when the base is unknown", () => {
    expect(seeded(undefined, "server copy", "my copy")).toBe("my copy");
  });

  it("does nothing when editor and document already agree", () => {
    expect(seedSplices("x", "same", "same")).toEqual([]);
  });

  it("handles astral characters without splitting them", () => {
    expect(seeded("note 🙂", "note 🙂", "note 🙂🙂")).toBe("note 🙂🙂");
  });
});

describe("collab mode: live to REST", () => {
  it("saves over REST unless the server already has the text", () => {
    expect(needsRestSave("abc", "abc")).toBe(false);
    expect(needsRestSave("abcd", "abc")).toBe(true);
    // The server copy could not be fetched (offline): save, the outbox and conflict flow take it from there.
    expect(needsRestSave("abc", undefined)).toBe(true);
  });
});

describe("collab presence", () => {
  it("says how many people are on the note", () => {
    expect(presenceLabel(1)).toBe("Only you here");
    expect(presenceLabel(2)).toBe("2 people here");
  });

  it("gives one person one colour slot, from the palette tokens only", () => {
    expect(presenceSlot("Dina Pratama")).toBe(presenceSlot("Dina Pratama"));
    for (const name of ["", "a", "Budi", "Sari Wulandari", "x".repeat(200)]) {
      const slot = presenceSlot(name);
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThanOrEqual(6);
    }
    expect(presenceColors(3)).toEqual({ color: "var(--collab-3)", colorLight: "var(--collab-3-soft)" });
  });

  it("never renders a colour another client made up", () => {
    expect(safeColor("var(--collab-4)")).toBe("var(--collab-4)");
    expect(safeColor("red; background: url(https://x.test)")).toBe("var(--collab-1)");
    expect(safeColor(42)).toBe("var(--collab-1)");
  });

  it("makes initials", () => {
    expect(initials("Dina Pratama")).toBe("DP");
    expect(initials("budi")).toBe("B");
    expect(initials("  ")).toBe("?");
  });
});

describe("collab CSP", () => {
  it("adds only a wss origin in production, and ws only in development", () => {
    expect(collabConnectSource("wss://live.example.test/collab", false)).toBe(" wss://live.example.test");
    expect(collabConnectSource("ws://127.0.0.1:3001", false)).toBe("");
    expect(collabConnectSource("ws://127.0.0.1:3001", true)).toBe(" ws://127.0.0.1:3001");
    expect(collabConnectSource("javascript:alert(1)", false)).toBe("");
    expect(collabConnectSource(undefined, false)).toBe("");
  });

  it("keeps the production policy same-origin when no separate service is configured", () => {
    const prev = process.env.NEXT_PUBLIC_COLLAB_URL;
    delete process.env.NEXT_PUBLIC_COLLAB_URL;
    try {
      expect(contentSecurityPolicy(false)).toContain("connect-src 'self';");
    } finally {
      if (prev !== undefined) process.env.NEXT_PUBLIC_COLLAB_URL = prev;
    }
  });
});

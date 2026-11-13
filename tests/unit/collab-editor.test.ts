import { describe, expect, it } from "vitest";
import {
  applySplices,
  backoff,
  closeAction,
  collabUrl,
  initials,
  ownAck,
  presenceColors,
  presenceLabel,
  presenceSlot,
  rejoinText,
  safeColor,
  seedSplices,
} from "../../src/components/workspace/collab/mode";
import { collabConnectSource, contentSecurityPolicy } from "../../next.config";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";

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

describe("collab mode: a dropped socket never overwrites edits it missed", () => {
  const confirmed = "# Plan\n\nintro\n\nmiddle\n\nend\n";

  it("takes the server copy when a stale client typed nothing after the stall", () => {
    // A stopped receiving; B typed and the service saved it. A must not PATCH its stale text back.
    const server = confirmed.replace("middle", "middle B edit A never received");
    expect(rejoinText(confirmed, confirmed, server)).toBe(server);
  });

  it("merges the stale client's own edit with the one it missed", () => {
    const server = confirmed.replace("end", "end, from B");
    const mine = confirmed.replace("intro", "intro, from A");
    expect(rejoinText(confirmed, mine, server)).toBe("# Plan\n\nintro, from A\n\nmiddle\n\nend, from B\n");
  });

  it("keeps this device's text when the server has nothing new", () => {
    const mine = confirmed + "typed during the outage\n";
    expect(rejoinText(confirmed, mine, confirmed)).toBe(mine);
  });

  it("does not guess that the server copy already holds an unacknowledged local edit", () => {
    // A's edit may or may not have reached the service; the texts alone cannot tell. Conflict, not a guess.
    const mine = confirmed.replace("intro", "intro, from A");
    const server = mine.replace("end", "end, from B");
    expect(rejoinText(confirmed, mine, server)).toBeNull();
    expect(rejoinText(confirmed, mine, mine)).toBe(mine);
    // Once the service acknowledged A's edit, `confirmed` holds it and B's edit merges cleanly.
    expect(rejoinText(mine, mine, server)).toBe(server);
  });

  it("never loses a local deletion next to a remote one", () => {
    // A deleted the second line, B the first. The old rule took the server copy and lost A's deletion.
    expect(rejoinText("todo: x\ntodo: y\n", "todo: x\n", "todo: y\n")).toBeNull();
  });

  it("keeps an unacknowledged local insert when the server moved on without it", () => {
    // A typed, its frames never reached the service, while B's edits kept arriving. `confirmed` stayed at the
    // last acknowledged text, so A's words are a local change: merged or a conflict, never dropped.
    const mine = confirmed.replace("intro", "intro, typed by A");
    const server = confirmed.replace("end", "end, from B");
    expect(rejoinText(confirmed, mine, server)).toBe("# Plan\n\nintro, typed by A\n\nmiddle\n\nend, from B\n");
    const touching = confirmed.replace("intro", "intro from B");
    expect(rejoinText(confirmed, mine, touching)).toBeNull();
  });

  it("leaves overlapping edits to the conflict flow", () => {
    const mine = confirmed.replace("middle", "middle by A");
    const server = confirmed.replace("middle", "middle by B");
    expect(rejoinText(confirmed, mine, server)).toBeNull();
  });

  it("fuzz: the result is null or holds both the local and the remote change", () => {
    let seed = 0x2f6b;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
    const pick = (n: number) => Math.floor(rnd() * n);
    const alphabet = "ab\n";
    const str = (n: number) => Array.from({ length: n }, () => alphabet[pick(alphabet.length)]).join("");
    /** Every single splice that turns `from` into `to`: a text change is ambiguous, any of them is "the" change. */
    const splices = (from: string, to: string) => {
      const out: { index: number; remove: number; insert: string }[] = [];
      for (let index = 0; index <= from.length; index++)
        for (let remove = 0; index + remove <= from.length; remove++) {
          const kept = from.length - remove;
          if (to.length < kept || !to.startsWith(from.slice(0, index)) || !to.endsWith(from.slice(index + remove))) continue;
          out.push({ index, remove, insert: to.slice(index, to.length - (from.length - index - remove)) });
        }
      return out;
    };
    /** Both changes applied: some reading of each, strictly apart, applied to the base gives `result`. */
    const holdsBoth = (base: string, mine: string, server: string, result: string) => {
      if (mine === base) return result === server;
      if (server === base) return result === mine;
      if (mine === server) return result === server;
      for (const l of splices(base, mine))
        for (const r of splices(base, server)) {
          const [x, y] = l.index + l.remove < r.index ? [l, r] : r.index + r.remove < l.index ? [r, l] : [null, null];
          if (!x || !y) continue;
          const merged = base.slice(0, x.index) + x.insert + base.slice(x.index + x.remove, y.index) + y.insert + base.slice(y.index + y.remove);
          if (merged === result) return true;
        }
      return false;
    };
    let merged = 0;
    for (let i = 0; i < 4000; i++) {
      const base = str(pick(10));
      const edit = (t: string) => {
        const index = pick(t.length + 1);
        const remove = pick(t.length - index + 1);
        return t.slice(0, index) + str(pick(3)) + t.slice(index + remove);
      };
      const mine = edit(base);
      const server = edit(base);
      const result = rejoinText(base, mine, server);
      if (result === null) continue;
      merged++;
      if (!holdsBoth(base, mine, server, result)) throw new Error(`lost a change: ${JSON.stringify({ base, mine, server, result })}`);
    }
    // The property is not vacuous: plenty of cases merge.
    expect(merged).toBeGreaterThan(1000);
  });

  it("reads this client's acknowledgement number back from an awareness update", () => {
    const doc = new Y.Doc();
    const other = new Y.Doc();
    const mineAw = new awarenessProtocol.Awareness(doc);
    const otherAw = new awarenessProtocol.Awareness(other);
    mineAw.setLocalState({ user: { name: "A" }, ack: 7 });
    otherAw.setLocalState({ user: { name: "B" }, ack: 99 });
    const both = new awarenessProtocol.Awareness(new Y.Doc());
    awarenessProtocol.applyAwarenessUpdate(both, awarenessProtocol.encodeAwarenessUpdate(mineAw, [doc.clientID]), null);
    awarenessProtocol.applyAwarenessUpdate(both, awarenessProtocol.encodeAwarenessUpdate(otherAw, [other.clientID]), null);
    const update = awarenessProtocol.encodeAwarenessUpdate(both, [other.clientID, doc.clientID]);
    expect(ownAck(update, doc.clientID)).toBe(7);
    expect(ownAck(awarenessProtocol.encodeAwarenessUpdate(otherAw, [other.clientID]), doc.clientID)).toBeNull();
    mineAw.setLocalState({ user: { name: "A" } });
    expect(ownAck(awarenessProtocol.encodeAwarenessUpdate(mineAw, [doc.clientID]), doc.clientID)).toBeNull();
    expect(ownAck(new Uint8Array([5, 1]), doc.clientID)).toBeNull();
  });

  it("without a confirmed base only an identical copy counts as saved", () => {
    expect(rejoinText(undefined, "same", "same")).toBe("same");
    expect(rejoinText(undefined, "mine", "theirs")).toBeNull();
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

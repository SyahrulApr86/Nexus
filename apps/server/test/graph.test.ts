import { beforeEach, describe, expect, it } from "vitest";
import { api, registerAndLogin, resetDb } from "./helpers.js";
import type { GraphDataDto } from "@nexus/shared";

beforeEach(resetDb);

async function createNote(cookie: string, body: Record<string, unknown>) {
  const res = await api("/notes", {
    method: "POST",
    cookie,
    body: JSON.stringify(body),
  });
  return (await res.json() as any).note as { id: string };
}

async function getGraph(cookie: string): Promise<GraphDataDto> {
  const res = await api("/graph", { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as GraphDataDto;
}

describe("FR-015 graph data", () => {
  it("returns notes as nodes and resolved wikilinks as edges (US6-S1)", async () => {
    const { cookie } = await registerAndLogin();
    const a = await createNote(cookie, { title: "A", content: "[[B]] [[C]]" });
    const b = await createNote(cookie, { title: "B", content: "[[C]]" });
    const c = await createNote(cookie, { title: "C", content: "" });

    const graph = await getGraph(cookie);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(3);
    const ids = (x: { sourceId: string; targetId: string }) =>
      `${x.sourceId}->${x.targetId}`;
    expect(graph.edges.map(ids).sort()).toEqual(
      [
        `${a.id}->${b.id}`,
        `${a.id}->${c.id}`,
        `${b.id}->${c.id}`,
      ].sort(),
    );
    const nodeA = graph.nodes.find((n) => n.id === a.id);
    expect(nodeA!.linkCount).toBe(2);
  });

  it("includes zero-link notes as isolated nodes and counts orphans (US6-S5)", async () => {
    const { cookie } = await registerAndLogin();
    await createNote(cookie, { title: "Lonely", content: "no links" });
    const graph = await getGraph(cookie);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graph.orphanCount).toBe(1);
  });

  it("excludes broken links and trashed notes", async () => {
    const { cookie } = await registerAndLogin();
    const a = await createNote(cookie, {
      title: "A",
      content: "[[Missing]] [[B]]",
    });
    const b = await createNote(cookie, { title: "B", content: "" });
    await api(`/notes/${b.id}`, { method: "DELETE", cookie });

    const graph = await getGraph(cookie);
    expect(graph.nodes.map((n) => n.id)).toEqual([a.id]);
    expect(graph.edges).toHaveLength(0);
  });

  it("is vault-scoped (FR-025)", async () => {
    const alice = await registerAndLogin("alice@example.com");
    const bob = await registerAndLogin("bob@example.com");
    await createNote(alice.cookie, { title: "A1", content: "[[A2]]" });
    await createNote(alice.cookie, { title: "A2", content: "" });
    const graph = await getGraph(bob.cookie);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});

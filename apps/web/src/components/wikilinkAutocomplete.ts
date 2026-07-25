import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { isInCodeRegion } from "@nexus/shared";
import { api } from "../api/client.js";

/**
 * FR-010: autocomplete on `[[` trigger, filtered by the typed fragment.
 * Suppressed inside code blocks/inline code (US4-S6) via the shared parser.
 */
async function wikilinkSource(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const match = context.matchBefore(/\[\[([^\][]*)$/);
  if (!match) return null;
  if (isInCodeRegion(context.state.doc.toString(), match.from)) return null;

  const fragment = match.text.slice(2);
  const { suggestions } = await api<{
    suggestions: { id: string; title: string }[];
  }>(`/notes/suggestions?q=${encodeURIComponent(fragment)}`);

  return {
    from: match.from + 2,
    options: suggestions.map((s) => ({
      label: s.title,
      type: "text",
      apply: `${s.title}]]`,
    })),
    // Keep filtering client-side as the user types more characters
    validFor: /^[^\][]*$/,
  };
}

export function wikilinkAutocomplete() {
  return autocompletion({
    override: [wikilinkSource],
    activateOnTyping: true,
    icons: false,
  });
}

import type { Draft, ElementRef, MessagePart } from "../shared/types";

/**
 * Turns a draft into the text that is copied: the message as written, with each element chip
 * replaced by a number, followed by what each number stands for. Plain Markdown, so it reads the
 * same pasted into a chat that renders it and into a terminal that does not.
 */

/** Numbers references in reading order. An element mentioned twice keeps its first number. */
export function numberRefs(parts: readonly MessagePart[], refs: Readonly<Record<string, ElementRef>>): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const part of parts) {
    if (part.type === "ref" && refs[part.id] && !numbers.has(part.id)) numbers.set(part.id, numbers.size + 1);
  }
  return numbers;
}

/** True when there is nothing worth copying: no element and no text but whitespace. */
export function isEmptyDraft(draft: Draft): boolean {
  return !draft.parts.some((part) => (part.type === "ref" ? Boolean(draft.refs[part.id]) : part.text.trim() !== ""));
}

/** A Markdown code span that survives backticks inside the value. */
function code(value: string): string {
  const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestRun + 1);
  const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}

function size({ width, height }: { width: number; height: number }): string {
  return `${width}×${height}`;
}

function pageLine(ref: ElementRef): string {
  const where = ref.title ? `${ref.title} — ${ref.url}` : ref.url;
  return `${where} (viewport ${size(ref.viewport)})`;
}

function body(draft: Draft, numbers: Map<string, number>): string {
  return draft.parts
    .map((part) => {
      if (part.type === "text") return part.text;
      const number = numbers.get(part.id);
      return number ? `[${number}]` : "";
    })
    .join("")
    // A contenteditable pads with non-breaking spaces; nobody means them.
    .replaceAll(" ", " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatMessage(draft: Draft): string {
  const numbers = numberRefs(draft.parts, draft.refs);
  const text = body(draft, numbers);
  if (numbers.size === 0) return text;

  const used = Array.from(numbers, ([id, number]) => ({ number, ref: draft.refs[id]! }));
  // The page is said once when every element is on it, and per element when they are not.
  const first = used[0]!.ref;
  const onePage = used.every(({ ref }) => pageLine(ref) === pageLine(first));

  const lines: string[] = [];
  // The blank line matters: text directly above `---` would be read as a heading.
  if (text) lines.push(text, "");
  lines.push("---");
  if (onePage) lines.push(`Page: ${pageLine(first)}`);

  for (const { number, ref } of used) {
    const facts = [code(ref.label), `${size(ref.rect)} at (${ref.rect.x}, ${ref.rect.y})`];
    if (ref.text) facts.push(`“${ref.text}”`);
    lines.push("", `[${number}] ${facts.join(" — ")}`);
    if (!onePage) lines.push(`- page: ${pageLine(ref)}`);
    lines.push(`- selector: ${code(ref.selector)}`, `- html: ${code(ref.html)}`);
  }
  return lines.join("\n");
}

import { describe, expect, test } from "bun:test";

import { formatMessage, isEmptyDraft, numberRefs } from "../src/panel/format";
import type { Draft, ElementRef } from "../src/shared/types";

function ref(id: string, overrides: Partial<ElementRef> = {}): ElementRef {
  return {
    id,
    label: "article.post-card",
    selector: "main > article.post-card:nth-of-type(2)",
    html: '<article class="post-card featured">',
    text: "How we built the new editor",
    rect: { x: 120, y: 480, width: 640, height: 320 },
    viewport: { width: 1440, height: 900 },
    url: "https://example.com/blog",
    title: "Blog · Example",
    ...overrides,
  };
}

describe("formatMessage", () => {
  test("a message without elements is just its text", () => {
    const draft: Draft = { parts: [{ type: "text", text: "  Make the header sticky.\n\n" }], refs: {} };
    expect(formatMessage(draft)).toBe("Make the header sticky.");
  });

  test("elements become numbers in the text and are explained below it", () => {
    const draft: Draft = {
      parts: [
        { type: "text", text: "Could you make " },
        { type: "ref", id: "a" },
        { type: "text", text: " smaller? Also keep " },
        { type: "ref", id: "b" },
        { type: "text", text: " centred." },
      ],
      refs: {
        a: ref("a"),
        b: ref("b", { label: "div.container", selector: "div.container", html: '<div class="container">', text: undefined, rect: { x: 0, y: 0, width: 1200, height: 2400 } }),
      },
    };
    expect(formatMessage(draft)).toBe(
      [
        "Could you make [1] smaller? Also keep [2] centred.",
        "",
        "---",
        "Page: Blog · Example — https://example.com/blog (viewport 1440×900)",
        "",
        "[1] `article.post-card` — 640×320 at (120, 480) — “How we built the new editor”",
        "- selector: `main > article.post-card:nth-of-type(2)`",
        '- html: `<article class="post-card featured">`',
        "",
        "[2] `div.container` — 1200×2400 at (0, 0)",
        "- selector: `div.container`",
        '- html: `<div class="container">`',
      ].join("\n"),
    );
  });

  test("an element mentioned twice keeps one number and is explained once", () => {
    const draft: Draft = {
      parts: [{ type: "ref", id: "a" }, { type: "text", text: " and again " }, { type: "ref", id: "a" }],
      refs: { a: ref("a") },
    };
    const message = formatMessage(draft);
    expect(message.startsWith("[1] and again [1]\n")).toBe(true);
    expect(message.match(/^\[1\] `/gm)).toHaveLength(1);
  });

  test("elements from different pages each say where they are", () => {
    const draft: Draft = {
      parts: [{ type: "ref", id: "a" }, { type: "text", text: " like " }, { type: "ref", id: "b" }],
      refs: { a: ref("a"), b: ref("b", { url: "https://example.com/about", title: "" }) },
    };
    const message = formatMessage(draft);
    expect(message).not.toContain("\nPage: ");
    expect(message).toContain("- page: Blog · Example — https://example.com/blog (viewport 1440×900)");
    expect(message).toContain("- page: https://example.com/about (viewport 1440×900)");
  });

  test("the same page at another viewport size is not the same view of it", () => {
    const draft: Draft = {
      parts: [{ type: "ref", id: "a" }, { type: "ref", id: "b" }],
      refs: { a: ref("a"), b: ref("b", { viewport: { width: 390, height: 844 } }) },
    };
    expect(formatMessage(draft)).toContain("- page: Blog · Example — https://example.com/blog (viewport 390×844)");
  });

  test("a chip whose element is unknown is dropped rather than numbered", () => {
    const draft: Draft = {
      parts: [{ type: "text", text: "Fix " }, { type: "ref", id: "gone" }, { type: "ref", id: "a" }],
      refs: { a: ref("a") },
    };
    expect(formatMessage(draft).split("\n")[0]).toBe("Fix [1]");
  });

  test("only elements: the separator still stands apart from a heading", () => {
    const draft: Draft = { parts: [{ type: "ref", id: "a" }], refs: { a: ref("a") } };
    expect(formatMessage(draft).split("\n").slice(0, 3)).toEqual(["[1]", "", "---"]);
  });

  test("backticks in a value cannot break out of its code span", () => {
    const draft: Draft = {
      parts: [{ type: "ref", id: "a" }],
      refs: { a: ref("a", { html: '<code title="use `x` here">', selector: "`odd`" }) },
    };
    const message = formatMessage(draft);
    expect(message).toContain('- html: ``<code title="use `x` here">``');
    expect(message).toContain("- selector: `` `odd` ``");
  });

  test("editor whitespace is tidied: non-breaking spaces, trailing spaces, runs of blank lines", () => {
    const draft: Draft = { parts: [{ type: "text", text: "One two  \n\n\n\nthree \n" }], refs: {} };
    expect(formatMessage(draft)).toBe("One two\n\nthree");
  });
});

describe("draft helpers", () => {
  test("numberRefs counts in reading order and skips unknown references", () => {
    const numbers = numberRefs(
      [{ type: "ref", id: "b" }, { type: "ref", id: "x" }, { type: "ref", id: "a" }, { type: "ref", id: "b" }],
      { a: ref("a"), b: ref("b") },
    );
    expect([...numbers]).toEqual([["b", 1], ["a", 2]]);
  });

  test("isEmptyDraft: whitespace and dangling chips are nothing to copy", () => {
    expect(isEmptyDraft({ parts: [], refs: {} })).toBe(true);
    expect(isEmptyDraft({ parts: [{ type: "text", text: " \n" }, { type: "ref", id: "gone" }], refs: {} })).toBe(true);
    expect(isEmptyDraft({ parts: [{ type: "ref", id: "a" }], refs: { a: ref("a") } })).toBe(false);
    expect(isEmptyDraft({ parts: [{ type: "text", text: "hi" }], refs: {} })).toBe(false);
  });
});

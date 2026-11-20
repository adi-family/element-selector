import { describe, expect, test } from "bun:test";

import { isUtilityClass } from "../src/content/utility-class";

describe("isUtilityClass", () => {
  test.each([
    "flex", "hidden", "relative", "truncate", "group",
    "mt-4", "-mt-2", "px-3", "w-full", "h-screen", "size-4", "z-10", "inset-0", "gap-x-4", "min-w-0",
    "max-w-screen-lg", "flex-1", "flex-col", "inline-flex", "grid-cols-3", "col-span-2", "shrink-0",
    "items-center", "justify-between", "place-items-center", "text-sm", "text-2xl", "text-center",
    "font-medium", "font-mono", "leading-tight", "tracking-wide", "bg-white", "bg-blue-500",
    "text-muted-foreground", "border-border", "rounded-t-lg", "shadow-lg", "ring-offset-2",
    "outline-none", "opacity-50", "overflow-x-auto", "cursor-pointer", "select-none",
    "pointer-events-none", "transition-colors", "duration-200", "ease-in-out", "animate-spin",
    "object-cover", "aspect-square", "line-clamp-2", "whitespace-nowrap", "break-words", "sr-only",
    "not-sr-only", "divide-y", "space-y-2", "backdrop-blur", "col-md-6",
  ])("%s styles", (name) => {
    expect(isUtilityClass(name)).toBe(true);
  });

  test.each([
    "container", "row", "col", "card", "post-card", "top-bar", "site-header", "sidebar", "btn-primary",
    "text-editor", "content-wrapper", "list-item", "grid-container", "flex-container", "bg-hero",
    "table-of-contents", "to-do", "start-page", "MuiButton-root", "chakra-button", "featured",
  ])("%s names", (name) => {
    expect(isUtilityClass(name)).toBe(false);
  });
});

/**
 * Tells single-purpose utility classes (Tailwind and its relatives) from names a developer gave
 * to a thing. `mt-4`, `items-center` and `text-muted-foreground` describe styling and are shared
 * by dozens of unrelated elements; `post-card` and `top-bar` say what the element is. A selector
 * is built from the second kind only.
 *
 * A class counts as a utility when its first segment is a known utility prefix and everything
 * after it is a utility value: a number, a size, a colour, a keyword. That keeps `text-editor`,
 * `content-wrapper` and `list-item` — a utility prefix followed by an ordinary word — as names.
 */

/** Utilities that are a word on their own. */
const WHOLE = new Set(
  (
    "flex grid block inline hidden contents relative absolute fixed sticky static truncate italic " +
    "uppercase lowercase capitalize underline overline grow shrink border rounded shadow ring outline " +
    "transition visible invisible collapse isolate antialiased transform filter group peer"
  ).split(" "),
);

const PREFIXES = new Set(
  (
    "m mx my mt mr mb ml ms me p px py pt pr pb pl ps pe w h size min max gap space inset top right " +
    "bottom left start end z order col row grid flex basis grow shrink justify items content self " +
    "place text font leading tracking bg border rounded ring outline shadow opacity overflow " +
    "overscroll cursor select pointer transition duration ease delay animate scale rotate translate " +
    "skew origin object aspect fill stroke line whitespace break align float clear list decoration " +
    "underline divide from via to blur backdrop sr not scroll snap touch will columns table accent " +
    "caret indent inline"
  ).split(" "),
);

/** Words a utility's value is made of, besides numbers. */
const VALUES = new Set(
  (
    // axes and corners
    "x y t r b l s e tl tr bl br w h " +
    // sizes
    "xs sm md lg xl full screen auto px min max fit none " +
    // alignment and layout
    "center left right justify start end between around evenly stretch baseline top bottom middle " +
    "wrap nowrap reverse row col cols rows span first last both items content self flex grid block " +
    "inline table cell group hidden visible scroll clip ellipsis " +
    // type
    "thin light normal medium semibold bold extrabold black tight snug relaxed loose tighter wide " +
    "wider widest sans serif mono words all keep nums tabular " +
    // colour: keywords, the palette, and the design-token names shadcn-style themes use
    "white transparent current inherit slate gray zinc neutral stone red orange amber yellow lime " +
    "green emerald teal cyan sky blue indigo violet purple fuchsia pink rose primary secondary muted " +
    "accent destructive foreground background card popover border input ring canvas success warning " +
    // effects, motion and interaction
    "solid dashed dotted double colors opacity transform shadow in out linear spin ping pulse bounce " +
    "cover contain fill square video pointer default wait text move grab events offset clamp smooth " +
    "change only sr inset blur disc decimal"
  ).split(" "),
);

function isValue(segment: string): boolean {
  // `4`, `2xl`, `500`, `0`.
  return /^\d/.test(segment) || VALUES.has(segment);
}

export function isUtilityClass(name: string): boolean {
  // A leading dash is Tailwind's negative: `-mt-2`.
  const segments = name.replace(/^-/, "").split("-");
  const [prefix, ...rest] = segments;
  if (rest.length === 0) return WHOLE.has(prefix!);
  return PREFIXES.has(prefix!) && rest.every(isValue);
}

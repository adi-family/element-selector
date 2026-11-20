/**
 * Puts text on the clipboard. The Clipboard API is tried first; the panel is a cross-origin frame
 * inside somebody else's page, and that page's Permissions-Policy can deny it, so a
 * selection-based copy stands behind it. Answers whether the copy happened.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to the selection-based copy.
  }
  const previous = document.activeElement;
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.setAttribute("aria-hidden", "true");
  document.body.append(input);
  input.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    input.remove();
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
  }
}

import { Button } from "@design-system/ui";
import { Check, Copy, SquareDashedMousePointer, Trash2, Undo2, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { PICK_KEYS, type PickKey, type RefTarget } from "../shared/protocol";
import type { Draft, ElementRef } from "../shared/types";
import { AdiMark } from "./AdiMark";
import { Composer } from "./composer";
import { copyText } from "./copy-text";
import { loadDraft, saveDraft, watchDraft } from "./draft-store";
import { formatMessage, isEmptyDraft } from "./format";
import { connectToPage, type LinkStatus, type PageLink } from "./page-link";

/** The editor grows with the message up to this height, then scrolls. */
const EDITOR_MAX_HEIGHT = 280;

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_LABEL = isMac ? "⌘" : "Ctrl+";

function toTarget(ref: ElementRef, number: number): RefTarget {
  return { id: ref.id, selector: ref.selector, url: ref.url, ...(number ? { number } : {}) };
}

export function App() {
  const [status, setStatus] = useState<"connecting" | LinkStatus>("connecting");
  const [link, setLink] = useState<PageLink | null>(null);

  useEffect(() => {
    const opened = connectToPage(setStatus);
    setLink(opened);
    return () => opened.close();
  }, []);

  // Nothing is shown — least of all the draft — until the page's content script has answered.
  // A page that frames this file on its own gets an inert note, not a composer to click-jack.
  if (status === "lost") {
    return (
      <p data-slot="selector-detached" className="p-4 text-sm text-muted-foreground">
        Open the selector from the ADI Element Selector toolbar button.
      </p>
    );
  }
  if (status === "connecting" || !link) return null;
  return <Panel link={link} />;
}

function Panel({ link }: { link: PageLink }) {
  const headerRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const composerRef = useRef<Composer | null>(null);
  const [picking, setPickingState] = useState(false);
  /** The same fact for event handlers, which must not wait for a render to learn it. */
  const pickingRef = useRef(false);
  const setPicking = (value: boolean) => {
    pickingRef.current = value;
    setPickingState(value);
  };
  const [empty, setEmpty] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  /** What Clear removed, offered back until the next message is started. */
  const [cleared, setCleared] = useState<Draft | null>(null);

  // The editor, its draft, and the page's side of the conversation.
  useEffect(() => {
    const composer = new Composer(editorRef.current!, {
      onChange(draft) {
        setEmpty(isEmptyDraft(draft));
        setCopyState("idle");
        saveDraft(draft);
      },
      onRefHover(ref, number) {
        link.post({ type: "highlight", target: ref && toTarget(ref, number) });
      },
      onRefClick(ref, number) {
        link.post({ type: "reveal", target: toTarget(ref, number) });
      },
    });
    composerRef.current = composer;

    const show = (draft: Draft) => {
      composer.setDraft(draft);
      setEmpty(isEmptyDraft(draft));
    };
    let current = true;
    loadDraft()
      .then((draft) => {
        if (!current) return;
        show(draft);
        composer.focus();
      })
      .catch(() => composer.focus());
    const unwatch = watchDraft(show);
    // When the browser window is activated, Chrome can hand the frame its focus back with
    // nothing focused inside it. The caret belongs in the editor then, not nowhere.
    const onWindowFocus = () => {
      if (!document.activeElement || document.activeElement === document.body) composer.focus();
    };
    window.addEventListener("focus", onWindowFocus);
    const unsubscribe = link.subscribe((message) => {
      if (message.type === "shown") composer.focus();
      else if (message.type === "pick:state") setPicking(message.picking);
      else if (message.type === "picked") composer.insertRef(message.ref);
    });

    return () => {
      current = false;
      window.removeEventListener("focus", onWindowFocus);
      unwatch();
      unsubscribe();
      composer.destroy();
      composerRef.current = null;
    };
  }, [link]);

  // The frame on the page is as tall as the panel wants to be, and is dragged by the header —
  // all of it but the Close button. Tell the page whenever either changes.
  useEffect(() => {
    const header = headerRef.current!;
    const editor = editorRef.current!;
    const footer = footerRef.current!;
    const report = () => {
      const close = header.querySelector("button")!.getBoundingClientRect();
      link.post({
        type: "layout",
        height: header.offsetHeight + footer.offsetHeight + Math.min(editor.offsetHeight, EDITOR_MAX_HEIGHT),
        grip: { left: 0, top: 0, width: Math.max(0, Math.floor(close.left) - 4), height: header.offsetHeight },
      });
    };
    const observer = new ResizeObserver(report);
    observer.observe(header);
    observer.observe(editor);
    observer.observe(footer);
    report();
    return () => observer.disconnect();
  }, [link]);

  // While picking, the keyboard may still be here rather than on the page; pass the keys along.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!pickingRef.current) return;
      if (event.metaKey || event.ctrlKey || event.altKey || !PICK_KEYS.includes(event.key as PickKey)) return;
      event.preventDefault();
      event.stopPropagation();
      link.post({ type: "pick:key", key: event.key as PickKey });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [link]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  const togglePick = () => {
    const start = !pickingRef.current;
    // Assumed at once, so a key pressed right after is already treated as a picking key; the
    // page answers with the real state either way.
    setPicking(start);
    link.post({ type: start ? "pick:start" : "pick:cancel" });
  };

  const copy = async () => {
    const composer = composerRef.current;
    if (!composer) return;
    const draft = composer.getDraft();
    if (isEmptyDraft(draft)) return;
    setCopyState((await copyText(formatMessage(draft))) ? "copied" : "failed");
  };

  const clear = () => {
    const composer = composerRef.current;
    if (!composer) return;
    setCleared(composer.getDraft());
    composer.clear();
  };

  const undoClear = () => {
    const composer = composerRef.current;
    if (!composer || !cleared) return;
    composer.setDraft(cleared);
    composer.focus();
    setEmpty(isEmptyDraft(cleared));
    saveDraft(cleared);
    setCleared(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (!mod || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() === "e") {
      event.preventDefault();
      togglePick();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void copy();
    }
  };

  return (
    <div data-slot="selector-panel" className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <header
        ref={headerRef}
        data-slot="selector-header"
        className="flex h-10 shrink-0 items-center gap-2 border-b pr-1.5 pl-3 select-none"
      >
        <AdiMark />
        <h1 className="text-sm font-medium">Element selector</h1>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          aria-label="Close"
          title="Close"
          onClick={() => link.post({ type: "close" })}
        >
          <X className="size-4" />
        </Button>
      </header>

      <div
        className="min-h-0 flex-1 cursor-text overflow-y-auto"
        onClick={(event) => {
          // The space below the last line belongs to the editor too.
          if (event.target === event.currentTarget) composerRef.current?.focus();
        }}
      >
        <div
          ref={editorRef}
          data-slot="selector-editor"
          role="textbox"
          aria-multiline="true"
          aria-label="Message"
          data-placeholder="Describe the change. Point at parts of the page with Select element."
          contentEditable="plaintext-only"
          spellCheck
          className="min-h-22 px-3 py-2.5 text-sm leading-6 outline-none"
        />
      </div>

      <footer ref={footerRef} data-slot="selector-footer" className="flex shrink-0 items-center gap-1.5 border-t p-2">
        <Button
          data-action="pick"
          variant={picking ? "secondary" : "outline"}
          size="sm"
          aria-pressed={picking}
          onClick={togglePick}
        >
          <SquareDashedMousePointer className="size-4" />
          {picking ? "Cancel" : "Select element"}
          <kbd className="font-sans text-xs font-normal text-muted-foreground">{picking ? "Esc" : `${MOD_LABEL}E`}</kbd>
        </Button>
        <span className="flex-1" />
        {empty && cleared ? (
          <Button data-action="undo-clear" variant="ghost" size="sm" onClick={undoClear}>
            <Undo2 className="size-4" />
            Undo clear
          </Button>
        ) : !empty ? (
          <Button data-action="clear" variant="ghost" size="sm" onClick={clear}>
            <Trash2 className="size-4" />
            Clear
          </Button>
        ) : null}
        <Button
          data-action="copy"
          size="sm"
          onClick={() => void copy()}
          disabled={empty}
          disabledReason="Write a message or select an element first."
          disabledHelpPosition="left"
        >
          {copyState === "copied" ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
        </Button>
      </footer>
    </div>
  );
}

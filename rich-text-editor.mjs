// GATE 2B-RT-EDITOR — interactive contenteditable RichText V1 editor + trusted export API.
//
// Architecture: contenteditable root + a fully controlled DOM model (rich-text-editor-serializer.mjs
// owns the canonical block/run DOM shape) + a strict serializer as the trust boundary. This module
// deliberately avoids `document.execCommand` (deprecated, browser-inconsistent, and gives no control
// over the exact DOM shape the contract needs) and avoids any large editor framework — every
// requirement in the GATE 2B-RT-EDITOR spec (deterministic multi-run/multi-paragraph formatting,
// IME-safe composition, plain-text-only paste, no silent truncation) is achievable with direct
// Selection/Range + DOM APIs at classroom scale, and no concrete blocker requiring a framework was
// found while implementing this.
//
// The editable DOM is NOT trusted storage: nothing here ever reads `.innerHTML`, ever trusts a
// stored attribute value without re-validating it through rich-text-contract.mjs, or ever assumes
// the DOM matches what this module last wrote (browser extensions, other scripts, or plain browser
// editing quirks could have changed it). Every export goes through
// rich-text-editor-serializer.mjs#serializeToRichText, which re-derives a RichText V1 document from
// scratch and validates it before handing it back.
//
// NOT wired into index.html or any Firestore field in this gate — standalone, isolated module only.

import { validateRichTextV1, richTextToPlainText, DEFAULT_SIZE } from "./rich-text-contract.mjs";
import {
  DATA_BLOCK_ATTR,
  DATA_RUN_ATTR,
  createRunSpan,
  richTextToDom,
  legacyPlainTextToDom,
  createEmptyDocumentDom,
  emptyRichTextDocument,
  serializeToRichText,
  splitRunAtOffset,
  readRunFromMarkedSpan,
  computeFormatState,
  normalizePastedPlainText,
  pastedTextToParagraphLines
} from "./rich-text-editor-serializer.mjs";

const DEFAULT_RUN_FORMAT = Object.freeze({ bold: false, italic: false, font: "default", size: DEFAULT_SIZE, color: "default" });

function isBlockEl(node) {
  return !!node && node.nodeType === 1 && node.tagName === "DIV" && node.getAttribute(DATA_BLOCK_ATTR) === "paragraph";
}
function isRunSpan(node) {
  return !!node && node.nodeType === 1 && node.tagName === "SPAN" && node.getAttribute(DATA_RUN_ATTR) === "1";
}
function isBr(node) {
  return !!node && node.nodeType === 1 && node.tagName === "BR";
}

export class RichTextEditor {
  constructor(options) {
    const opts = options || {};
    this.doc = opts.doc || document;
    this.win = opts.win || (typeof window !== "undefined" ? window : undefined);
    this.mountEl = opts.container;
    if (!this.mountEl) throw new TypeError("RichTextEditor: options.container is required");
    this.ariaLabel = opts.ariaLabel || "Rich text content";
    this.onLimitExceeded = typeof opts.onLimitExceeded === "function" ? opts.onLimitExceeded : () => {};
    this.onChange = typeof opts.onChange === "function" ? opts.onChange : () => {};

    this._pendingFormat = { ...DEFAULT_RUN_FORMAT };
    this._isComposing = false;
    this._destroyed = false;

    this._buildDom();
    this._wireEvents();
    this.setPlainText("");
  }

  // ---------------- DOM construction ----------------

  _buildDom() {
    const doc = this.doc;
    this.rootEl = doc.createElement("div");
    this.rootEl.setAttribute("data-rt-editor-root", "1");

    this.toolbarEl = doc.createElement("div");
    this.toolbarEl.setAttribute("data-rt-toolbar", "1");
    this.toolbarEl.setAttribute("role", "toolbar");
    this.toolbarEl.setAttribute("aria-label", "Text formatting");

    this.boldBtn = doc.createElement("button");
    this.boldBtn.type = "button";
    this.boldBtn.setAttribute("data-rt-action", "bold");
    this.boldBtn.setAttribute("aria-label", "Bold");
    this.boldBtn.setAttribute("aria-pressed", "false");
    this.boldBtn.textContent = "B";

    this.italicBtn = doc.createElement("button");
    this.italicBtn.type = "button";
    this.italicBtn.setAttribute("data-rt-action", "italic");
    this.italicBtn.setAttribute("aria-label", "Italic");
    this.italicBtn.setAttribute("aria-pressed", "false");
    this.italicBtn.textContent = "I";

    this.fontSelect = doc.createElement("select");
    this.fontSelect.setAttribute("data-rt-action", "font");
    this.fontSelect.setAttribute("aria-label", "Font");
    for (const [value, label] of [["default", "Default"], ["arial", "Arial"], ["times", "Times New Roman"], ["roboto", "Roboto"]]) {
      const opt = doc.createElement("option");
      opt.value = value;
      opt.textContent = label;
      this.fontSelect.appendChild(opt);
    }

    this.sizeSelect = doc.createElement("select");
    this.sizeSelect.setAttribute("data-rt-action", "size");
    this.sizeSelect.setAttribute("aria-label", "Font size");
    for (const size of [14, 16, 18, 20, 24]) {
      const opt = doc.createElement("option");
      opt.value = String(size);
      opt.textContent = String(size);
      this.sizeSelect.appendChild(opt);
    }

    this.colorSelect = doc.createElement("select");
    this.colorSelect.setAttribute("data-rt-action", "color");
    this.colorSelect.setAttribute("aria-label", "Text color");
    for (const [value, label] of [["default", "Default"], ["red", "Red"], ["blue", "Blue"], ["green", "Green"], ["orange", "Orange"], ["purple", "Purple"]]) {
      const opt = doc.createElement("option");
      opt.value = value;
      opt.textContent = label;
      this.colorSelect.appendChild(opt);
    }

    this.toolbarEl.appendChild(this.boldBtn);
    this.toolbarEl.appendChild(this.italicBtn);
    this.toolbarEl.appendChild(this.fontSelect);
    this.toolbarEl.appendChild(this.sizeSelect);
    this.toolbarEl.appendChild(this.colorSelect);

    this.editableEl = doc.createElement("div");
    this.editableEl.setAttribute("data-rt-editable", "1");
    this.editableEl.setAttribute("contenteditable", "true");
    this.editableEl.setAttribute("role", "textbox");
    this.editableEl.setAttribute("aria-multiline", "true");
    this.editableEl.setAttribute("aria-label", this.ariaLabel);

    this.rootEl.appendChild(this.toolbarEl);
    this.rootEl.appendChild(this.editableEl);
    this.mountEl.appendChild(this.rootEl);
  }

  _wireEvents() {
    this._onBeforeInput = (e) => {
      // Native text insertion/deletion is allowed to proceed (required for correct IME behavior);
      // we only actively intervene for Enter, which is handled in keydown instead (beforeinput's
      // "insertParagraph" inputType fires for Enter in some browsers before keydown's
      // preventDefault would take effect in others, so keydown is the single source of truth here
      // to avoid a double-handling race).
      void e;
    };
    this._onKeyDown = (e) => this._handleKeyDown(e);
    this._onInput = (e) => this._handleInput(e);
    this._onCompositionStart = () => { this._isComposing = true; };
    this._onCompositionEnd = () => { this._isComposing = false; this._normalizeAllBlocks(); this._refreshToolbarFromSelection(); this.onChange(); };
    this._onPaste = (e) => this._handlePaste(e);
    this._onSelectionChange = () => this._handleSelectionChange();

    this.editableEl.addEventListener("beforeinput", this._onBeforeInput);
    this.editableEl.addEventListener("keydown", this._onKeyDown);
    this.editableEl.addEventListener("input", this._onInput);
    this.editableEl.addEventListener("compositionstart", this._onCompositionStart);
    this.editableEl.addEventListener("compositionend", this._onCompositionEnd);
    this.editableEl.addEventListener("paste", this._onPaste);
    if (this.doc.addEventListener) this.doc.addEventListener("selectionchange", this._onSelectionChange);

    // Toolbar buttons: mousedown normally moves focus (and collapses the Selection) to the button
    // BEFORE the click handler runs, which would make every Bold/Italic click a no-op against an
    // already-empty selection. preventDefault on mousedown keeps focus (and the Selection) in the
    // editable region right through the click.
    this._onToolbarButtonMouseDown = (e) => e.preventDefault();
    this.boldBtn.addEventListener("mousedown", this._onToolbarButtonMouseDown);
    this.italicBtn.addEventListener("mousedown", this._onToolbarButtonMouseDown);

    // <select> controls cannot have their own mousedown prevented (that would block the dropdown
    // from opening at all), so instead we snapshot whatever Selection Range was live in the editor
    // right before the browser moves focus to the select, and restore it in the `change` handler
    // before applying the format.
    this._onSelectMouseDown = () => {
      const sel = this._getSelection();
      this._savedRange = sel && this._selectionIsInsideEditor(sel) && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    };
    this.fontSelect.addEventListener("mousedown", this._onSelectMouseDown);
    this.sizeSelect.addEventListener("mousedown", this._onSelectMouseDown);
    this.colorSelect.addEventListener("mousedown", this._onSelectMouseDown);

    this._onBoldClick = () => this._toggleBooleanFormat("bold");
    this._onItalicClick = () => this._toggleBooleanFormat("italic");
    this._onFontChange = () => this._applyExplicitFormat("font", this.fontSelect.value);
    this._onSizeChange = () => this._applyExplicitFormat("size", Number(this.sizeSelect.value));
    this._onColorChange = () => this._applyExplicitFormat("color", this.colorSelect.value);

    this.boldBtn.addEventListener("click", this._onBoldClick);
    this.italicBtn.addEventListener("click", this._onItalicClick);
    this.fontSelect.addEventListener("change", this._onFontChange);
    this.sizeSelect.addEventListener("change", this._onSizeChange);
    this.colorSelect.addEventListener("change", this._onColorChange);
  }

  // Returns the Selection object with a live Range restored into the editable region, using a
  // mousedown-time snapshot (see _onSelectMouseDown above) when the browser has since moved focus
  // (and collapsed the Selection) elsewhere — e.g. onto a <select> the user just changed.
  _restoreActiveSelection() {
    const sel = this._getSelection();
    if (!sel) return null;
    if (this._selectionIsInsideEditor(sel) && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed && sel.getRangeAt(0).toString().length > 0) return sel;
    if (this._savedRange) {
      sel.removeAllRanges();
      sel.addRange(this._savedRange);
      return sel;
    }
    return this._selectionIsInsideEditor(sel) ? sel : null;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.editableEl.removeEventListener("beforeinput", this._onBeforeInput);
    this.editableEl.removeEventListener("keydown", this._onKeyDown);
    this.editableEl.removeEventListener("input", this._onInput);
    this.editableEl.removeEventListener("compositionstart", this._onCompositionStart);
    this.editableEl.removeEventListener("compositionend", this._onCompositionEnd);
    this.editableEl.removeEventListener("paste", this._onPaste);
    if (this.doc.removeEventListener) this.doc.removeEventListener("selectionchange", this._onSelectionChange);
    this.boldBtn.removeEventListener("click", this._onBoldClick);
    this.italicBtn.removeEventListener("click", this._onItalicClick);
    this.boldBtn.removeEventListener("mousedown", this._onToolbarButtonMouseDown);
    this.italicBtn.removeEventListener("mousedown", this._onToolbarButtonMouseDown);
    this.fontSelect.removeEventListener("change", this._onFontChange);
    this.sizeSelect.removeEventListener("change", this._onSizeChange);
    this.colorSelect.removeEventListener("change", this._onColorChange);
    this.fontSelect.removeEventListener("mousedown", this._onSelectMouseDown);
    this.sizeSelect.removeEventListener("mousedown", this._onSelectMouseDown);
    this.colorSelect.removeEventListener("mousedown", this._onSelectMouseDown);
    if (this.rootEl.parentNode) this.rootEl.parentNode.removeChild(this.rootEl);
  }

  focus() {
    this.editableEl.focus();
  }

  // ---------------- Trusted export / load API ----------------

  getRichText() {
    return serializeToRichText(this.editableEl);
  }

  // Derived from richTextToPlainText() only — never independently scraped from the DOM. When the
  // current content does not validate (over a limit), richTextToPlainText's own documented
  // behavior for invalid input ("") is what this returns too, since there is no other
  // contract-compliant plain-text mirror for a document that is not currently valid.
  getPlainText() {
    const result = this.getRichText();
    if (!result.ok) return "";
    return richTextToPlainText(result.value);
  }

  setRichText(value) {
    if (!validateRichTextV1(value)) return { ok: false, reason: "invalid_value" };
    this._clearEditable();
    this.editableEl.appendChild(richTextToDom(this.doc, value));
    this._pendingFormat = { ...DEFAULT_RUN_FORMAT };
    this._refreshToolbarFromSelection();
    this.onChange();
    return { ok: true };
  }

  setPlainText(text) {
    this._clearEditable();
    if (text === "" || text === null || text === undefined) {
      this.editableEl.appendChild(createEmptyDocumentDom(this.doc));
    } else {
      this.editableEl.appendChild(legacyPlainTextToDom(this.doc, text));
    }
    this._pendingFormat = { ...DEFAULT_RUN_FORMAT };
    this._refreshToolbarFromSelection();
    this.onChange();
    return { ok: true };
  }

  _clearEditable() {
    while (this.editableEl.firstChild) this.editableEl.removeChild(this.editableEl.firstChild);
  }

  // ---------------- Selection helpers ----------------

  _getSelection() {
    if (this.win && this.win.getSelection) return this.win.getSelection();
    if (typeof window !== "undefined") return window.getSelection();
    return null;
  }

  _selectionIsInsideEditor(sel) {
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    return this.editableEl.contains(range.commonAncestorContainer);
  }

  _allRunSpansInOrder() {
    return Array.from(this.editableEl.querySelectorAll(`span[${DATA_RUN_ATTR}="1"]`));
  }

  // Resolves a Range boundary (container, offset) to { span, offset } where `span` is the run span
  // the boundary falls within (character offset into its text), or null when the boundary sits at
  // a position with no run to anchor to (an empty paragraph, or exactly at the very edge of the
  // editor). Handles both Range boundary conventions: a Text-node container (offset = character
  // offset within that text node, and by construction every run span's only child is one Text
  // node) and an Element container (offset = child index).
  _resolveBoundary(container, offset) {
    if (container.nodeType === 3) {
      const span = container.parentNode;
      if (isRunSpan(span)) return { span, offset };
      return { span: null, offset: 0 };
    }
    if (container.nodeType === 1) {
      const children = container.childNodes;
      if (isRunSpan(container)) {
        // Rare: boundary given directly on the span element itself.
        const text = container.textContent || "";
        return { span: container, offset: offset >= 1 ? text.length : 0 };
      }
      if (offset < children.length) {
        const child = children[offset];
        if (isRunSpan(child)) return { span: child, offset: 0 };
        // Child is a BR, another block, or something else — no run to anchor at this exact index.
        return { span: null, offset: 0, before: child };
      }
      // Offset is at (or past) the end of container's children — anchor to the LAST run span in
      // this container, at its end, if one exists.
      for (let i = children.length - 1; i >= 0; i--) {
        if (isRunSpan(children[i])) {
          const text = children[i].textContent || "";
          return { span: children[i], offset: text.length };
        }
      }
      return { span: null, offset: 0 };
    }
    return { span: null, offset: 0 };
  }

  // Read-only boundary resolution shared by both the mutating (_getExactRunSpansForRange, used
  // when actually applying a format change) and non-mutating (_getTouchedSpansReadOnly, used only
  // to reflect toolbar state) paths. Performs NO DOM writes. Returns null when the range touches no
  // run at all (e.g. entirely within empty paragraphs); otherwise
  // { startSpan, startOffset, endSpan, endOffset, spans } where `spans` is the flat, UNSPLIT list
  // of original run spans the range's boundaries fall within/across (inclusive).
  _resolveTouchedSpanRange(range) {
    const allSpans = this._allRunSpansInOrder();
    if (allSpans.length === 0) return null;

    let start = this._resolveBoundary(range.startContainer, range.startOffset);
    let end = this._resolveBoundary(range.endContainer, range.endOffset);

    // A null anchor means the boundary sits at an empty paragraph / no adjacent run. Fall back to
    // the nearest run in the intuitively correct direction: the start boundary looks FORWARD for
    // the next run, the end boundary looks BACKWARD for the previous run. If that still yields
    // nothing, there is no text anywhere in the touched range to format.
    if (!start.span) {
      const candidate = allSpans.find((s) => {
        const r = this.doc.createRange();
        r.selectNode(s);
        return r.compareBoundaryPoints(Range.START_TO_START, range) >= 0;
      });
      if (!candidate) return null;
      start = { span: candidate, offset: 0 };
    }
    if (!end.span) {
      let candidate = null;
      for (let i = allSpans.length - 1; i >= 0; i--) {
        const s = allSpans[i];
        const r = this.doc.createRange();
        r.selectNode(s);
        if (r.compareBoundaryPoints(Range.END_TO_END, range) <= 0) { candidate = s; break; }
      }
      if (!candidate) return null;
      end = { span: candidate, offset: (candidate.textContent || "").length };
    }

    const startIdx = allSpans.indexOf(start.span);
    const endIdx = allSpans.indexOf(end.span);
    if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return null;

    return {
      startSpan: start.span, startOffset: start.offset,
      endSpan: end.span, endOffset: end.offset,
      spans: allSpans.slice(startIdx, endIdx + 1)
    };
  }

  // Non-mutating: the exact run spans (original, unsplit) a Range's boundaries fall within/across.
  // Used only to read/reflect toolbar state — never performs a DOM write, so simply moving the
  // caret or selection around can never fragment run spans as a side effect.
  _getTouchedSpansReadOnly(range) {
    const resolved = this._resolveTouchedSpanRange(range);
    return resolved ? resolved.spans : [];
  }

  // Returns the ordered list of concrete run spans (already split so the list's first/last entries
  // exactly match the selection's boundaries) that a Range touches, spanning across run and
  // paragraph boundaries alike. Returns [] when the range touches no run at all. MUTATES the DOM
  // (splits boundary spans) — use only when actually about to apply a format change, never for
  // read-only toolbar-state reflection (see _getTouchedSpansReadOnly for that).
  _getExactRunSpansForRange(range) {
    const resolved = this._resolveTouchedSpanRange(range);
    if (!resolved) return [];
    let { startSpan, startOffset, endSpan, endOffset } = resolved;

    if (startSpan === endSpan) {
      const text = startSpan.textContent || "";
      if (endOffset < text.length) {
        const [left] = splitRunAtOffset(this.doc, startSpan, endOffset);
        startSpan = left;
      }
      const leftText = startSpan.textContent || "";
      if (startOffset > 0 && startOffset <= leftText.length) {
        const [, right] = splitRunAtOffset(this.doc, startSpan, startOffset);
        startSpan = right;
      }
      endSpan = startSpan;
    } else {
      const endText = endSpan.textContent || "";
      if (endOffset < endText.length) {
        const [left] = splitRunAtOffset(this.doc, endSpan, endOffset);
        endSpan = left;
      }
      const startText = startSpan.textContent || "";
      if (startOffset > 0 && startOffset <= startText.length) {
        const [, right] = splitRunAtOffset(this.doc, startSpan, startOffset);
        startSpan = right;
      }
    }

    const refreshed = this._allRunSpansInOrder();
    const startIdx = refreshed.indexOf(startSpan);
    const endIdx = refreshed.indexOf(endSpan);
    if (startIdx === -1 || endIdx === -1) return [];
    return refreshed.slice(startIdx, endIdx + 1);
  }

  // ---------------- Formatting application ----------------

  _toggleBooleanFormat(prop) {
    const sel = this._restoreActiveSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      this._pendingFormat = { ...this._pendingFormat, [prop]: !this._pendingFormat[prop] };
      this._refreshToolbarFromSelection();
      return;
    }
    const spans = this._getExactRunSpansForRange(range);
    if (spans.length === 0) return;
    const infos = spans.map((s) => this._runInfoFromSpan(s));
    const allOn = infos.every((info) => info[prop] === true);
    const target = !allOn;
    this._replaceSpansWithFormat(spans, { [prop]: target }, range);
  }

  _applyExplicitFormat(prop, value) {
    const sel = this._restoreActiveSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      this._pendingFormat = { ...this._pendingFormat, [prop]: value };
      this._refreshToolbarFromSelection();
      return;
    }
    const spans = this._getExactRunSpansForRange(range);
    if (spans.length === 0) return;
    this._replaceSpansWithFormat(spans, { [prop]: value }, range);
  }

  _runInfoFromSpan(span) {
    const run = readRunFromMarkedSpan(span);
    return {
      bold: run.bold === true,
      italic: run.italic === true,
      font: typeof run.font === "string" ? run.font : "default",
      size: typeof run.size === "number" ? run.size : DEFAULT_SIZE,
      color: typeof run.color === "string" ? run.color : "default"
    };
  }

  _replaceSpansWithFormat(spans, patch, originalRange) {
    const startText = spans[0].textContent || "";
    const endText = spans[spans.length - 1].textContent || "";
    const newSpans = spans.map((span) => {
      const run = readRunFromMarkedSpan(span);
      const merged = { ...this._runInfoFromSpan(span), ...patch, text: run.text };
      const cleaned = { text: merged.text };
      if (merged.bold) cleaned.bold = true;
      if (merged.italic) cleaned.italic = true;
      if (merged.font !== "default") cleaned.font = merged.font;
      if (merged.size !== DEFAULT_SIZE) cleaned.size = merged.size;
      if (merged.color !== "default") cleaned.color = merged.color;
      const fresh = createRunSpan(this.doc, cleaned);
      span.parentNode.replaceChild(fresh, span);
      return fresh;
    });

    // Restore a selection spanning exactly the reformatted text.
    try {
      const sel = this._getSelection();
      const r = this.doc.createRange();
      const firstNew = newSpans[0];
      const lastNew = newSpans[newSpans.length - 1];
      r.setStart(firstNew.firstChild || firstNew, 0);
      r.setEnd(lastNew.firstChild || lastNew, (lastNew.textContent || "").length);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch { /* best-effort selection restore */ }
    void originalRange; void startText; void endText;

    this._mergeAdjacentRunsEverywhere();
    this._refreshToolbarFromSelection();
    this.onChange();
  }

  _mergeAdjacentRunsEverywhere() {
    const blocks = Array.from(this.editableEl.children).filter(isBlockEl);
    for (const block of blocks) this._mergeAdjacentRunsInBlock(block);
  }

  _mergeAdjacentRunsInBlock(block) {
    let child = block.firstChild;
    while (child && child.nextSibling) {
      const next = child.nextSibling;
      if (isRunSpan(child) && isRunSpan(next)) {
        const a = this._runInfoFromSpan(child);
        const b = this._runInfoFromSpan(next);
        const sameFormat = a.bold === b.bold && a.italic === b.italic && a.font === b.font && a.size === b.size && a.color === b.color;
        if (sameFormat) {
          child.textContent = (child.textContent || "") + (next.textContent || "");
          block.removeChild(next);
          continue; // re-check child against its new nextSibling
        }
      }
      child = child.nextSibling;
    }
  }

  // ---------------- Toolbar reflection ----------------

  _refreshToolbarFromSelection() {
    const sel = this._getSelection();
    let infos;
    if (!sel || !this._selectionIsInsideEditor(sel) || sel.rangeCount === 0) {
      infos = [this._pendingFormat];
    } else {
      const range = sel.getRangeAt(0);
      if (range.collapsed) {
        infos = [this._pendingFormat];
      } else {
        const spans = this._getTouchedSpansReadOnly(range);
        infos = spans.length > 0 ? spans.map((s) => this._runInfoFromSpan(s)) : [this._pendingFormat];
      }
    }
    const state = computeFormatState(infos);
    this.boldBtn.setAttribute("aria-pressed", state.mixed.bold ? "mixed" : String(state.bold));
    this.italicBtn.setAttribute("aria-pressed", state.mixed.italic ? "mixed" : String(state.italic));
    this.fontSelect.value = state.mixed.font ? "" : state.font;
    this.sizeSelect.value = state.mixed.size ? "" : String(state.size);
    this.colorSelect.value = state.mixed.color ? "" : state.color;
  }

  _handleSelectionChange() {
    const sel = this._getSelection();
    if (!sel || !this._selectionIsInsideEditor(sel)) return;
    if (sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed && sel.getRangeAt(0).toString().length > 0) {
      // Continuously remember the most recent non-collapsed, non-empty in-editor selection. A
      // toolbar interaction (clicking a button, opening a <select>) can collapse/relocate the live
      // Selection — sometimes to a structurally "non-collapsed" but textless range (different
      // boundary points bracketing no characters) — before our own handler for that interaction
      // runs. The `.toString().length > 0` check specifically excludes that textless case, so it
      // never overwrites a genuine prior selection with nothing. This is the fallback
      // `_restoreActiveSelection()` uses to recover the user's actual intended selection rather
      // than silently no-op'ing the format command.
      this._savedRange = sel.getRangeAt(0).cloneRange();
    }
    if (sel.rangeCount > 0 && sel.getRangeAt(0).collapsed) {
      const range = sel.getRangeAt(0);
      if (this._savedRange && this._collapsedAtSavedRangeBoundary(range)) {
        // The collapse lands exactly at one edge of our last known good selection — this is a
        // toolbar-interaction side effect (e.g. a button/select momentarily taking focus), not the
        // user deliberately moving the caret elsewhere. Keep _savedRange alive for
        // _restoreActiveSelection() to recover, and do not treat this as a real caret move.
        this._refreshToolbarFromSelection();
        return;
      }
      // A genuine caret move: forget any stale saved selection and re-sync typing-state to
      // wherever the caret landed (unless it sits in an empty paragraph, in which case there is no
      // run to inherit from — keep the existing pendingFormat, matching "toolbar selection becomes
      // typing state" for a fresh empty line).
      this._savedRange = null;
      const resolved = this._resolveBoundary(range.startContainer, range.startOffset);
      if (resolved.span) {
        this._pendingFormat = this._runInfoFromSpan(resolved.span);
      }
    }
    this._refreshToolbarFromSelection();
  }

  _collapsedAtSavedRangeBoundary(collapsedRange) {
    const saved = this._savedRange;
    const point = collapsedRange.startContainer;
    const offset = collapsedRange.startOffset;
    const atStart = point === saved.startContainer && offset === saved.startOffset;
    const atEnd = point === saved.endContainer && offset === saved.endOffset;
    return atStart || atEnd;
  }

  // ---------------- Enter / paragraph splitting ----------------

  _handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      this._insertParagraphBreakAtCaret();
    }
  }

  _deleteSelectionContents(range) {
    const spans = this._getExactRunSpansForRange(range);
    for (const span of spans) {
      const parent = span.parentNode;
      parent.removeChild(span);
      this._ensureBlockHasContent(parent);
    }
  }

  _ensureBlockHasContent(block) {
    const hasRun = Array.from(block.childNodes).some(isRunSpan);
    const hasBr = Array.from(block.childNodes).some(isBr);
    if (!hasRun && !hasBr) block.appendChild(this.doc.createElement("br"));
    if (hasRun && hasBr) {
      for (const child of Array.from(block.childNodes)) if (isBr(child)) block.removeChild(child);
    }
  }

  _insertParagraphBreakAtCaret() {
    const sel = this._getSelection();
    if (!sel || !this._selectionIsInsideEditor(sel) || sel.rangeCount === 0) return;
    let range = sel.getRangeAt(0);
    if (!range.collapsed) {
      this._deleteSelectionContents(range);
      sel.removeAllRanges();
      range = this.doc.createRange();
      // After deletion the selection API state is invalidated in this simplified model; place a
      // fresh collapsed range at the start of the editable element's current selection anchor
      // block as a safe fallback point.
      const anchorBlock = this._currentBlock() || this.editableEl.firstChild;
      range.setStart(anchorBlock, 0);
      range.collapse(true);
      sel.addRange(range);
    }

    const resolved = this._resolveBoundary(range.startContainer, range.startOffset);
    const currentBlock = this._blockAncestor(range.startContainer) || this._currentBlock();
    if (!currentBlock) return;

    let anchorSpan = resolved.span;
    if (anchorSpan && resolved.offset > 0 && resolved.offset < (anchorSpan.textContent || "").length) {
      const [left, right] = splitRunAtOffset(this.doc, anchorSpan, resolved.offset);
      anchorSpan = left;
      void right;
    }

    const newBlock = this.doc.createElement("div");
    newBlock.setAttribute(DATA_BLOCK_ATTR, "paragraph");

    // Move every sibling AFTER the split point into the new block.
    let moveStart;
    if (anchorSpan) {
      moveStart = anchorSpan.nextSibling;
    } else {
      // Caret was at a position with no run to its left (start of block, or empty block) — the
      // whole block's content (if any) moves to the new block, leaving the original empty.
      moveStart = currentBlock.firstChild;
    }
    while (moveStart) {
      const next = moveStart.nextSibling;
      newBlock.appendChild(moveStart);
      moveStart = next;
    }

    this._ensureBlockHasContent(currentBlock);
    this._ensureBlockHasContent(newBlock);

    currentBlock.parentNode.insertBefore(newBlock, currentBlock.nextSibling);

    // Place the caret at the very start of the new block.
    const newRange = this.doc.createRange();
    const firstRunInNew = Array.from(newBlock.childNodes).find(isRunSpan);
    if (firstRunInNew) {
      newRange.setStart(firstRunInNew.firstChild || firstRunInNew, 0);
    } else {
      newRange.setStart(newBlock, 0);
    }
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    this._handleSelectionChange();
    this.onChange();
  }

  _blockAncestor(node) {
    let n = node;
    while (n && n !== this.editableEl) {
      if (isBlockEl(n)) return n;
      n = n.parentNode;
    }
    return null;
  }

  _currentBlock() {
    const sel = this._getSelection();
    if (!sel || sel.rangeCount === 0) return this.editableEl.firstChild;
    return this._blockAncestor(sel.getRangeAt(0).startContainer) || this.editableEl.firstChild;
  }

  // ---------------- Input normalization (bare-text-node wrapping, IME-safe) ----------------

  _handleInput() {
    if (this._isComposing) return;
    this._normalizeAllBlocks();
    this._handleSelectionChange();
    this.onChange();
  }

  // Wraps any bare Text node the browser inserted directly under a block div into a proper run
  // span carrying the current typing-state format, removes/restores the empty-paragraph <br>
  // placeholder as needed, and merges adjacent same-format runs. Runs over the whole editor each
  // time — cheap at the classroom-scale content sizes this contract allows (<=20 blocks, <=20
  // runs/block).
  _normalizeAllBlocks() {
    const blocks = Array.from(this.editableEl.children).filter(isBlockEl);
    if (blocks.length === 0) {
      this.editableEl.appendChild(createEmptyDocumentDom(this.doc));
      return;
    }
    for (const block of blocks) this._normalizeBlock(block);
  }

  _normalizeBlock(block) {
    for (const child of Array.from(block.childNodes)) {
      if (child.nodeType === 3) {
        const text = child.textContent || "";
        if (text.length === 0) { block.removeChild(child); continue; }
        const fresh = createRunSpan(this.doc, this._runToWrite(this._pendingFormat, text));
        block.replaceChild(fresh, child);
      } else if (child.nodeType === 1 && !isRunSpan(child) && !isBr(child)) {
        // An unexpected element the browser (or something else) inserted mid-editing — reduce to
        // inert plain text immediately, same policy the serializer applies at export time, so the
        // live DOM never accumulates untrusted markup between edits either.
        const text = child.textContent || "";
        if (text.length > 0) {
          const fresh = createRunSpan(this.doc, this._runToWrite(this._pendingFormat, text));
          block.replaceChild(fresh, child);
        } else {
          block.removeChild(child);
        }
      }
    }
    this._ensureBlockHasContent(block);
    this._mergeAdjacentRunsInBlock(block);
  }

  _runToWrite(formatInfo, text) {
    const run = { text };
    if (formatInfo.bold) run.bold = true;
    if (formatInfo.italic) run.italic = true;
    if (formatInfo.font !== "default") run.font = formatInfo.font;
    if (formatInfo.size !== DEFAULT_SIZE) run.size = formatInfo.size;
    if (formatInfo.color !== "default") run.color = formatInfo.color;
    return run;
  }

  // ---------------- Paste (plain-text only) ----------------

  _handlePaste(e) {
    e.preventDefault();
    const clipboardData = e.clipboardData || (this.win && this.win.clipboardData);
    const raw = clipboardData ? clipboardData.getData("text/plain") : "";
    if (!raw) return;

    const snapshot = Array.from(this.editableEl.childNodes).map((n) => n.cloneNode(true));

    const sel = this._getSelection();
    if (!sel || !this._selectionIsInsideEditor(sel) || sel.rangeCount === 0) return;
    let range = sel.getRangeAt(0);
    if (!range.collapsed) {
      this._deleteSelectionContents(range);
      sel.removeAllRanges();
      const fallback = this.doc.createRange();
      const anchorBlock = this._currentBlock() || this.editableEl.firstChild;
      fallback.setStart(anchorBlock, 0);
      fallback.collapse(true);
      sel.addRange(fallback);
      range = fallback;
    }

    const lines = pastedTextToParagraphLines(raw);
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) this._insertParagraphBreakAtCaret();
      if (lines[i].length > 0) this._insertTextAtCaret(lines[i]);
    }

    this._normalizeAllBlocks();
    const dryRun = serializeToRichText(this.editableEl);
    if (!dryRun.ok) {
      while (this.editableEl.firstChild) this.editableEl.removeChild(this.editableEl.firstChild);
      for (const n of snapshot) this.editableEl.appendChild(n);
      this.onLimitExceeded({ operation: "paste", reason: dryRun.reason });
      return;
    }
    this._handleSelectionChange();
    this.onChange();
  }

  // Sums the textContent length of every child of `block` strictly before the one that owns
  // `container`, plus the in-container `offset` — a DOM-mutation-independent way to remember "how
  // far into this block's plain-text stream" a caret sits, so a block can be normalized (bare text
  // wrapped into run spans) in between resolving the caret and using it, without the caret position
  // being invalidated by that normalization's own node replacements.
  _blockCharOffset(block, container, offset) {
    const owner = container.parentNode === block ? container : container.parentNode;
    let sum = 0;
    for (const child of block.childNodes) {
      if (child === owner) return sum + offset;
      sum += (child.textContent || "").length;
    }
    return sum + offset;
  }

  // Inverse of _blockCharOffset, for an ALREADY-NORMALIZED block (every child is either the
  // empty-paragraph <br> or a run span with exactly one text-node child): finds the run span and
  // in-span offset `charOffset` characters into the block's concatenated run text, or null when
  // the block is the empty-placeholder (<br>-only) case.
  _locateBlockOffset(block, charOffset) {
    let remaining = charOffset;
    for (const child of block.childNodes) {
      if (!isRunSpan(child)) continue;
      const len = (child.textContent || "").length;
      if (remaining <= len) return { span: child, offset: remaining };
      remaining -= len;
    }
    return null;
  }

  _insertTextAtCaret(text) {
    const sel = this._getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const block = this._blockAncestor(range.startContainer) || this._currentBlock();
    if (!block) return;

    // Compute the caret's position as a block-relative character offset BEFORE normalizing, then
    // normalize (wrapping any bare/hostile content left over from a prior step of a multi-step
    // operation like paste into proper run spans), then re-resolve against the now-well-formed
    // block. This avoids ever having to special-case "caret sits in a bare text node at some
    // arbitrary offset" for insertion itself — by the time we insert, the block is guaranteed to be
    // either the empty-placeholder shape or entirely composed of run spans.
    const charOffset = this._blockCharOffset(block, range.startContainer, range.startOffset);
    this._normalizeBlock(block);

    const located = this._locateBlockOffset(block, charOffset);
    if (!located) {
      // Normalized block has no run spans at all (the empty-placeholder <br> case) — insert the
      // first run span for this paragraph.
      for (const child of Array.from(block.childNodes)) if (isBr(child)) block.removeChild(child);
      const fresh = createRunSpan(this.doc, this._runToWrite(this._pendingFormat, text));
      block.appendChild(fresh);
      const newRange = this.doc.createRange();
      newRange.setStart(fresh.firstChild || fresh, text.length);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
      return;
    }

    const { span, offset } = located;
    const before = (span.textContent || "").slice(0, offset);
    const after = (span.textContent || "").slice(offset);
    span.textContent = before + text + after;
    const newRange = this.doc.createRange();
    newRange.setStart(span.firstChild, (before + text).length);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
}

export function createRichTextEditor(options) {
  return new RichTextEditor(options);
}

export { emptyRichTextDocument };

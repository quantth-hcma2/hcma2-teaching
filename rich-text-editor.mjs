// GATE 2B-RT-EDITOR — interactive contenteditable RichText V1 editor + trusted export API.
//
// Architecture: contenteditable root + a fully controlled DOM model (rich-text-editor-serializer.mjs
// owns the canonical block/run DOM shape) + a strict serializer as the trust boundary. This module
// deliberately avoids `document.execCommand` for every actual EDITING operation (deprecated,
// browser-inconsistent, and gives no control over the exact DOM shape the contract needs) and
// avoids any large editor framework — every requirement in the GATE 2B-RT-EDITOR spec
// (deterministic multi-run/multi-paragraph formatting, IME-safe composition, plain-text-only
// paste, no silent truncation) is achievable with direct Selection/Range + DOM APIs at classroom
// scale, and no concrete blocker requiring a framework was found while implementing this.
// GATE RICHTEXT-V3-QA-R1 UNDO/REDO MODEL: the V3-R1 candidate's Undo/Redo buttons called
// document.execCommand("undo"/"redo") (native browser history) while leaving real Ctrl+Z/Ctrl+Y
// keystrokes to invoke that SAME native history directly, unintercepted. Owner manual QA found
// this unreliable in real use: native contenteditable history is opaque and inconsistent across
// browsers about which of this module's own DOM-level mutations (toolbar formatting, list/indent/
// alignment/spacing changes, which are direct DOM writes, not native typed input) it actually
// records, so pressing Undo often had no useful effect. This module now owns its OWN bounded,
// per-instance history instead — ONE coherent model, never two contradictory ones: Ctrl+Z/Ctrl+Y
// are now intercepted in _handleKeyDown (preventDefault) and call the exact same _undo()/_redo()
// the toolbar buttons call; document.execCommand is no longer called anywhere in this module.
// History stores RichText DOCUMENT SNAPSHOTS (via serializeToRichText), not raw DOM/HTML — see
// _commitHistorySnapshot/_restoreHistorySnapshot below for the full design (debounced coalescing
// of typing bursts, immediate per-click snapshots for discrete toolbar actions, a bounded ring
// via _historyMax, duplicate-state suppression, and redo-branch truncation on a new edit).
//
// The editable DOM is NOT trusted storage: nothing here ever reads `.innerHTML`, ever trusts a
// stored attribute value without re-validating it through rich-text-contract.mjs, or ever assumes
// the DOM matches what this module last wrote (browser extensions, other scripts, or plain browser
// editing quirks could have changed it). Every export goes through
// rich-text-editor-serializer.mjs#serializeToRichText, which re-derives a RichText V1 document from
// scratch and validates it before handing it back.
//
// NOT wired into index.html or any Firestore field in this gate — standalone, isolated module only.

import { validateRichText, richTextToPlainText, DEFAULT_SIZE, MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, MAX_INDENT_LEVEL } from "./rich-text-contract.mjs";
import {
  DATA_BLOCK_ATTR,
  DATA_RUN_ATTR,
  DATA_TEXT_REGION_ATTR,
  DATA_ALIGN_ATTR,
  DATA_LIST_ATTR,
  DATA_INDENT_ATTR,
  createRunSpan,
  richTextToDom,
  legacyPlainTextToDom,
  createEmptyDocumentDom,
  createEmptyParagraphElement,
  emptyRichTextDocument,
  serializeToRichText,
  splitRunAtOffset,
  readRunFromMarkedSpan,
  computeFormatState,
  setBlockAlign,
  effectiveBlockAlign,
  setBlockList,
  effectiveBlockList,
  setBlockIndent,
  effectiveBlockIndent,
  setBlockLineSpacing,
  effectiveBlockLineSpacing,
  setBlockSpacing,
  effectiveBlockSpacing,
  isListMarkerElement,
  renormalizeListMarkers,
  computeAlignState,
  computeUniformState,
  normalizePastedPlainText,
  pastedTextToParagraphLines
} from "./rich-text-editor-serializer.mjs";

const DEFAULT_RUN_FORMAT = Object.freeze({ bold: false, italic: false, underline: false, strike: false, font: "default", size: DEFAULT_SIZE, color: "default" });

function isBlockEl(node) {
  return !!node && node.nodeType === 1 && node.tagName === "DIV" &&
    (node.getAttribute(DATA_BLOCK_ATTR) === "paragraph" || node.getAttribute("data-rt-cell") === "1");
}
function isRunSpan(node) {
  return !!node && node.nodeType === 1 && node.tagName === "SPAN" && node.getAttribute(DATA_RUN_ATTR) === "1";
}
function isBr(node) {
  return !!node && node.nodeType === 1 && node.tagName === "BR";
}

// Structural deep-equal over plain JSON-safe values (RichText documents are exactly this: nested
// plain objects/arrays/strings/numbers/booleans) — used by the history stack to detect and skip a
// "meaningless duplicate" snapshot (e.g. a selection-only change that produced no actual content
// difference), rather than relying on JSON.stringify key-order assumptions.
function richTextDeepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => richTextDeepEqual(v, b[i]));
  }
  const keysA = Object.keys(a), keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && richTextDeepEqual(a[k], b[k]));
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
    this.onImageUpload = typeof opts.onImageUpload === "function" ? opts.onImageUpload : null;
    this.resolveImageUrl = typeof opts.resolveImageUrl === "function" ? opts.resolveImageUrl : null;

    this._pendingFormat = { ...DEFAULT_RUN_FORMAT };
    this._isComposing = false;
    this._destroyed = false;

    // Bounded, per-instance Undo/Redo history (RichText document snapshots) — see this module's
    // header comment and the _undo/_redo/_commitHistorySnapshot methods below for the full design.
    this._history = [];
    this._historyIndex = -1;
    this._historyDebounceTimer = null;
    this._historyDebounceMs = 500;
    this._historyMax = 100;
    this._isRestoringHistory = false;

    this._buildDom();
    this._wireEvents();
    this.setPlainText("");
  }

  // ---------------- DOM construction ----------------

  // GATE RICHTEXT-V3: toolbar controls are built in logical GROUPS (Undo/Redo; Font/Size;
  // B/I/U/Strike/Color; alignment; Bullet/Number; Outdent/Indent; Line/Paragraph spacing; Clear
  // formatting; Image/Table), each wrapped in a [data-rt-toolbar-group] <span> purely so CSS can
  // draw a thin separator between groups — no layout engine change, still the same flat
  // button/select toolbar this editor has always had. Every new control keeps a plain Vietnamese
  // text label (matching the existing "Chèn ảnh"/"Chèn bảng 3×3" convention — this toolbar has
  // never used an icon font) with the fuller Vietnamese phrase as aria-label/title.
  _buildDom() {
    const doc = this.doc;
    this.rootEl = doc.createElement("div");
    this.rootEl.setAttribute("data-rt-editor-root", "1");

    this.toolbarEl = doc.createElement("div");
    this.toolbarEl.setAttribute("data-rt-toolbar", "1");
    this.toolbarEl.setAttribute("role", "toolbar");
    this.toolbarEl.setAttribute("aria-label", "Text formatting");

    const group = () => { const g = doc.createElement("span"); g.setAttribute("data-rt-toolbar-group", "1"); return g; };
    const button = (action, label, title) => {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-rt-action", action);
      btn.setAttribute("aria-label", title);
      btn.title = title;
      btn.textContent = label;
      return btn;
    };
    const select = (action, title, options) => {
      const sel = doc.createElement("select");
      sel.setAttribute("data-rt-action", action);
      sel.setAttribute("aria-label", title);
      sel.title = title;
      for (const [value, label] of options) {
        const opt = doc.createElement("option");
        opt.value = value;
        opt.textContent = label;
        sel.appendChild(opt);
      }
      return sel;
    };

    // Undo / Redo
    const undoRedoGroup = group();
    this.undoBtn = button("undo", "↶ Hoàn tác", "Hoàn tác (Ctrl+Z)");
    this.redoBtn = button("redo", "↷ Làm lại", "Làm lại (Ctrl+Y)");
    undoRedoGroup.append(this.undoBtn, this.redoBtn);

    // Font / Size
    const fontGroup = group();
    this.fontSelect = select("font", "Font", [["default", "Default"], ["arial", "Arial"], ["times", "Times New Roman"], ["roboto", "Roboto"]]);
    this.sizeSelect = select("size", "Font size", [14, 16, 18, 20, 24].map((s) => [String(s), String(s)]));
    fontGroup.append(this.fontSelect, this.sizeSelect);

    // Bold / Italic / Underline / Strikethrough / Color
    const runFormatGroup = group();
    this.boldBtn = button("bold", "B", "Đậm (Ctrl+B)");
    this.boldBtn.setAttribute("aria-pressed", "false");
    this.italicBtn = button("italic", "I", "Nghiêng (Ctrl+I)");
    this.italicBtn.setAttribute("aria-pressed", "false");
    this.underlineBtn = button("underline", "U", "Gạch chân (Ctrl+U)");
    this.underlineBtn.setAttribute("aria-pressed", "false");
    this.underlineBtn.style.textDecoration = "underline";
    this.strikeBtn = button("strike", "S", "Gạch ngang");
    this.strikeBtn.setAttribute("aria-pressed", "false");
    this.strikeBtn.style.textDecoration = "line-through";
    this.colorSelect = select("color", "Text color", [["default", "Default"], ["red", "Red"], ["blue", "Blue"], ["green", "Green"], ["orange", "Orange"], ["purple", "Purple"]]);
    runFormatGroup.append(this.boldBtn, this.italicBtn, this.underlineBtn, this.strikeBtn, this.colorSelect);

    // Alignment
    const alignGroup = group();
    this.alignButtons = [];
    for (const [align, label, title] of [
      ["left", "Trái", "Căn trái"],
      ["center", "Giữa", "Căn giữa"],
      ["right", "Phải", "Căn phải"],
      ["justify", "Đều", "Căn đều hai bên"]
    ]) {
      const btn = button(`align-${align}`, label, title);
      btn.setAttribute("aria-pressed", String(align === "left"));
      this.alignButtons.push([align, btn]);
      alignGroup.appendChild(btn);
    }
    [this.alignLeftBtn, this.alignCenterBtn, this.alignRightBtn, this.alignJustifyBtn] = this.alignButtons.map(([, btn]) => btn);

    // Bullet / Numbered list
    const listGroup = group();
    this.bulletBtn = button("list-bullet", "• Gạch đầu dòng", "Danh sách gạch đầu dòng");
    this.bulletBtn.setAttribute("aria-pressed", "false");
    this.numberBtn = button("list-number", "1. Đánh số", "Danh sách đánh số");
    this.numberBtn.setAttribute("aria-pressed", "false");
    listGroup.append(this.bulletBtn, this.numberBtn);

    // Outdent / Indent
    const indentGroup = group();
    this.outdentBtn = button("outdent", "⇤ Giảm thụt lề", "Giảm thụt lề");
    this.indentBtn = button("indent", "⇥ Tăng thụt lề", "Tăng thụt lề");
    indentGroup.append(this.outdentBtn, this.indentBtn);

    // Line spacing / Paragraph spacing
    const spacingGroup = group();
    this.lineSpacingSelect = select("line-spacing", "Giãn dòng", [["1", "Giãn dòng 1.0"], ["1.15", "Giãn dòng 1.15"], ["1.5", "Giãn dòng 1.5"], ["2", "Giãn dòng 2.0"]]);
    this.spacingSelect = select("spacing", "Khoảng cách đoạn", [["compact", "Đoạn: Gọn"], ["normal", "Đoạn: Bình thường"], ["wide", "Đoạn: Rộng"]]);
    spacingGroup.append(this.lineSpacingSelect, this.spacingSelect);

    // Clear formatting
    const clearGroup = group();
    this.clearFormatBtn = button("clear-format", "Xóa định dạng", "Xóa định dạng (ký tự) đã chọn");
    clearGroup.appendChild(this.clearFormatBtn);

    // Image / Table (unchanged)
    const blockGroup = group();
    this.imageBtn = button("image", "Chèn ảnh", "Chèn ảnh");
    this.imageInput = doc.createElement("input"); this.imageInput.type = "file"; this.imageInput.accept = "image/jpeg,image/png,image/webp"; this.imageInput.hidden = true;
    this.tableBtn = button("table", "Chèn bảng 3×3", "Chèn bảng 3×3");
    blockGroup.append(this.imageBtn, this.tableBtn, this.imageInput);

    this.toolbarEl.append(undoRedoGroup, fontGroup, runFormatGroup, alignGroup, listGroup, indentGroup, spacingGroup, clearGroup, blockGroup);

    this.editableEl = doc.createElement("div");
    this.editableEl.setAttribute("data-rt-editable", "1");
    this.editableEl.setAttribute("contenteditable", "false");
    this.editableEl.setAttribute("role", "group");
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
    this._onCompositionEnd = () => {
      this._isComposing = false;
      // Same bare-text-node caret loss this fix addresses in _handleInput below can also happen
      // for IME composition landing in a previously-bare paragraph (see _captureCaretForNormalize).
      const restore = this._captureCaretForNormalize();
      this._normalizeAllBlocks();
      this._restoreCaretAfterNormalize(restore);
      this._queueHistorySnapshot();
      this._refreshToolbarFromSelection();
      this.onChange();
    };
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
    // editable region right through the click. (Undo/Redo are deliberately exempt: execCommand
    // operates on whatever the native history recorded, not on the live Selection, so losing focus
    // to the button does not matter for them.)
    this._onToolbarButtonMouseDown = (e) => e.preventDefault();
    for (const btn of [this.boldBtn, this.italicBtn, this.underlineBtn, this.strikeBtn, this.bulletBtn, this.numberBtn, this.outdentBtn, this.indentBtn, this.clearFormatBtn]) {
      btn.addEventListener("mousedown", this._onToolbarButtonMouseDown);
    }
    for (const [, btn] of this.alignButtons) btn.addEventListener("mousedown", this._onToolbarButtonMouseDown);

    // <select> controls cannot have their own mousedown prevented (that would block the dropdown
    // from opening at all), so instead we snapshot whatever Selection Range was live in the editor
    // right before the browser moves focus to the select, and restore it in the `change` handler
    // before applying the format.
    this._onSelectMouseDown = () => {
      const sel = this._getSelection();
      this._savedRange = sel && this._selectionIsInsideEditor(sel) && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    };
    for (const sel of [this.fontSelect, this.sizeSelect, this.colorSelect, this.lineSpacingSelect, this.spacingSelect]) {
      sel.addEventListener("mousedown", this._onSelectMouseDown);
    }

    this._onBoldClick = () => this._toggleBooleanFormat("bold");
    this._onItalicClick = () => this._toggleBooleanFormat("italic");
    this._onUnderlineClick = () => this._toggleBooleanFormat("underline");
    this._onStrikeClick = () => this._toggleBooleanFormat("strike");
    this._onFontChange = () => this._applyExplicitFormat("font", this.fontSelect.value);
    this._onSizeChange = () => this._applyExplicitFormat("size", Number(this.sizeSelect.value));
    this._onColorChange = () => this._applyExplicitFormat("color", this.colorSelect.value);
    this._onAlignClicks = this.alignButtons.map(([align, btn]) => {
      const handler = () => this._applyAlignment(align);
      btn.addEventListener("click", handler);
      return handler;
    });
    this._onBulletClick = () => this._applyListFormat("bullet");
    this._onNumberClick = () => this._applyListFormat("number");
    this._onOutdentClick = () => this._applyIndent(-1);
    this._onIndentClick = () => this._applyIndent(1);
    this._onLineSpacingChange = () => this._applyLineSpacing(this.lineSpacingSelect.value);
    this._onSpacingChange = () => this._applySpacing(this.spacingSelect.value);
    this._onClearFormatClick = () => this._clearFormatting();
    this._onUndoClick = () => this._undo();
    this._onRedoClick = () => this._redo();
    this._onImageClick = () => { if (this.onImageUpload) this.imageInput.click(); };
    this._onImageChange = async () => { const file=this.imageInput.files?.[0]; this.imageInput.value=""; if(!file||!this.onImageUpload)return; this.imageBtn.disabled=true; try { const block=await this.onImageUpload(file); if(block) this.insertBlock(block); } finally { this.imageBtn.disabled=false; } };
    this._onTableClick = () => this.insertBlock({type:"table",rows:Array.from({length:3},()=>({cells:Array.from({length:3},()=>({runs:[]}))}))});
    this._onEditorClick = e => {
      const target=e.target;
      if(target?.hasAttribute?.("data-rt-remove-block")){ this._flushPendingHistorySnapshot(); target.closest(`[${DATA_BLOCK_ATTR}]`)?.remove(); this._ensureParagraph(); this._commitHistorySnapshot(); this.onChange(); return; }
      const block=target?.closest?.(`[${DATA_BLOCK_ATTR}="table"]`); if(!block)return;
      const rows=Array.from(block.querySelectorAll("tr")); const width=rows[0]?.querySelectorAll('[data-rt-cell="1"]').length||0;
      this._flushPendingHistorySnapshot();
      if(target.hasAttribute("data-rt-table-row") && rows.length<MAX_TABLE_ROWS){ const tr=this.doc.createElement("tr"); for(let i=0;i<width;i++)tr.appendChild(this._newCell()); block.querySelector("tbody").appendChild(tr); }
      else if(target.hasAttribute("data-rt-table-column") && width<MAX_TABLE_COLUMNS) rows.forEach(tr=>tr.appendChild(this._newCell()));
      else if(target.hasAttribute("data-rt-table-remove-row") && rows.length>1) rows.at(-1).remove();
      else if(target.hasAttribute("data-rt-table-remove-column") && width>1) rows.forEach(tr=>tr.lastElementChild.remove());
      else return;
      this._commitHistorySnapshot();
      this.onChange();
    };

    this.boldBtn.addEventListener("click", this._onBoldClick);
    this.italicBtn.addEventListener("click", this._onItalicClick);
    this.underlineBtn.addEventListener("click", this._onUnderlineClick);
    this.strikeBtn.addEventListener("click", this._onStrikeClick);
    this.fontSelect.addEventListener("change", this._onFontChange);
    this.sizeSelect.addEventListener("change", this._onSizeChange);
    this.colorSelect.addEventListener("change", this._onColorChange);
    this.bulletBtn.addEventListener("click", this._onBulletClick);
    this.numberBtn.addEventListener("click", this._onNumberClick);
    this.outdentBtn.addEventListener("click", this._onOutdentClick);
    this.indentBtn.addEventListener("click", this._onIndentClick);
    this.lineSpacingSelect.addEventListener("change", this._onLineSpacingChange);
    this.spacingSelect.addEventListener("change", this._onSpacingChange);
    this.clearFormatBtn.addEventListener("click", this._onClearFormatClick);
    this.undoBtn.addEventListener("click", this._onUndoClick);
    this.redoBtn.addEventListener("click", this._onRedoClick);
    this.imageBtn.addEventListener("click", this._onImageClick);
    this.imageInput.addEventListener("change", this._onImageChange);
    this.tableBtn.addEventListener("click", this._onTableClick);
    this.editableEl.addEventListener("click", this._onEditorClick);
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
    if (this._historyDebounceTimer) { clearTimeout(this._historyDebounceTimer); this._historyDebounceTimer = null; }
    this.editableEl.removeEventListener("beforeinput", this._onBeforeInput);
    this.editableEl.removeEventListener("keydown", this._onKeyDown);
    this.editableEl.removeEventListener("input", this._onInput);
    this.editableEl.removeEventListener("compositionstart", this._onCompositionStart);
    this.editableEl.removeEventListener("compositionend", this._onCompositionEnd);
    this.editableEl.removeEventListener("paste", this._onPaste);
    if (this.doc.removeEventListener) this.doc.removeEventListener("selectionchange", this._onSelectionChange);
    this.boldBtn.removeEventListener("click", this._onBoldClick);
    this.italicBtn.removeEventListener("click", this._onItalicClick);
    this.underlineBtn.removeEventListener("click", this._onUnderlineClick);
    this.strikeBtn.removeEventListener("click", this._onStrikeClick);
    this.bulletBtn.removeEventListener("click", this._onBulletClick);
    this.numberBtn.removeEventListener("click", this._onNumberClick);
    this.outdentBtn.removeEventListener("click", this._onOutdentClick);
    this.indentBtn.removeEventListener("click", this._onIndentClick);
    this.clearFormatBtn.removeEventListener("click", this._onClearFormatClick);
    this.undoBtn.removeEventListener("click", this._onUndoClick);
    this.redoBtn.removeEventListener("click", this._onRedoClick);
    for (const btn of [this.boldBtn, this.italicBtn, this.underlineBtn, this.strikeBtn, this.bulletBtn, this.numberBtn, this.outdentBtn, this.indentBtn, this.clearFormatBtn]) {
      btn.removeEventListener("mousedown", this._onToolbarButtonMouseDown);
    }
    this.alignButtons.forEach(([, btn], i) => {
      btn.removeEventListener("mousedown", this._onToolbarButtonMouseDown);
      btn.removeEventListener("click", this._onAlignClicks[i]);
    });
    this.fontSelect.removeEventListener("change", this._onFontChange);
    this.sizeSelect.removeEventListener("change", this._onSizeChange);
    this.colorSelect.removeEventListener("change", this._onColorChange);
    this.lineSpacingSelect.removeEventListener("change", this._onLineSpacingChange);
    this.spacingSelect.removeEventListener("change", this._onSpacingChange);
    this.imageBtn.removeEventListener("click", this._onImageClick);
    this.imageInput.removeEventListener("change", this._onImageChange);
    this.tableBtn.removeEventListener("click", this._onTableClick);
    this.editableEl.removeEventListener("click", this._onEditorClick);
    for (const sel of [this.fontSelect, this.sizeSelect, this.colorSelect, this.lineSpacingSelect, this.spacingSelect]) {
      sel.removeEventListener("mousedown", this._onSelectMouseDown);
    }
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
    if (!validateRichText(value)) return { ok: false, reason: "invalid_value" };
    this._clearEditable();
    this.editableEl.appendChild(richTextToDom(this.doc, value));
    this._hydrateImages();
    this._pendingFormat = { ...DEFAULT_RUN_FORMAT };
    // Loading a document starts a FRESH history context — Undo should never reach back past the
    // point a document was (re)loaded. Re-derived from the built DOM (not the input `value`
    // directly) so the baseline exactly matches what export would produce from this DOM state.
    this._initHistoryFromCurrentDom();
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
    this._initHistoryFromCurrentDom();
    this._refreshToolbarFromSelection();
    this.onChange();
    return { ok: true };
  }

  _initHistoryFromCurrentDom() {
    const result = serializeToRichText(this.editableEl);
    this._initHistory(result.ok ? result.value : emptyRichTextDocument());
  }

  _clearEditable() {
    while (this.editableEl.firstChild) this.editableEl.removeChild(this.editableEl.firstChild);
  }

  _newCell() { const td=this.doc.createElement("td"), input=this.doc.createElement("div"); input.contentEditable="true"; input.setAttribute("role","textbox"); input.setAttribute("data-rt-cell","1"); input.appendChild(this.doc.createElement("br")); td.appendChild(input); return td; }

  _ensureParagraph() { if(!this.editableEl.querySelector(`[${DATA_BLOCK_ATTR}="paragraph"]`)) this.editableEl.appendChild(createEmptyDocumentDom(this.doc)); }

  insertBlock(block) {
    const candidate={version:2,blocks:[block]};
    if(!validateRichText(candidate)) return {ok:false,reason:"invalid_value"};
    this._flushPendingHistorySnapshot();
    this.editableEl.appendChild(richTextToDom(this.doc,candidate)); this._hydrateImages();
    this._ensureParagraph(); this._renormalizeListMarkers(); this._commitHistorySnapshot(); this.onChange(); return {ok:true};
  }

  _hydrateImages(){
    if(!this.resolveImageUrl)return;
    this.editableEl.querySelectorAll('[data-rt-block="image"]').forEach(el=>{if(el.querySelector("img"))return;const img=this.doc.createElement("img");img.alt=el.querySelector('[data-rt-image-alt="1"]')?.value||"";img.style.maxWidth="100%";img.style.display="block";img.style.margin="8px auto";el.prepend(img);Promise.resolve(this.resolveImageUrl(el.getAttribute("data-rt-image-path"))).then(url=>{if(typeof url==="string"&&/^(?:https?:\/\/|blob:)/i.test(url)&&img.isConnected){img.src=url;if(/^blob:/i.test(url)&&typeof img.addEventListener==="function"){const revoke=()=>URL.revokeObjectURL(url);img.addEventListener("load",revoke,{once:true});img.addEventListener("error",revoke,{once:true});}}}).catch(()=>{img.alt="Không tải được ảnh";});});
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
    this._flushPendingHistorySnapshot();
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
    this._flushPendingHistorySnapshot();
    this._replaceSpansWithFormat(spans, { [prop]: value }, range);
  }

  // ---------------- Paragraph alignment ----------------
  // Block-level, not run-level: unlike bold/italic/font/size/color, alignment never splits or
  // touches run spans at all — it only ever sets/clears data-rt-align (+ matching CSS) on whichever
  // paragraph <div> element(s) the caret/selection touches. Word-like semantics: a collapsed caret
  // aligns just its own paragraph; a selection aligns every paragraph it touches, even partially,
  // always SETTING the clicked alignment (never toggling) — exactly like clicking one of several
  // mutually exclusive alignment buttons in Word, including when the touched paragraphs started out
  // with mixed alignment.

  // Every DATA_BLOCK_ATTR="paragraph" element the given Range touches, in document order. A
  // collapsed range (caret only) resolves to that caret's own paragraph (never a table cell — table
  // cells are a structurally different block kind, matched by data-rt-cell, and are deliberately
  // excluded: alignment is a paragraph-only feature in this gate). A non-collapsed range uses the
  // standard Range.intersectsNode so a selection that starts/ends mid-paragraph still includes that
  // whole paragraph, matching Word's own "partially selected paragraph is affected" behavior; this
  // naturally also covers a selection spanning across an Image/Table block into a different text
  // region, since it simply asks each paragraph element in the editor whether the Range touches it.
  _paragraphsTouchedByRange(range) {
    if (range.collapsed) {
      const block = this._blockAncestor(range.startContainer);
      return block && block.getAttribute(DATA_BLOCK_ATTR) === "paragraph" ? [block] : [];
    }
    const all = Array.from(this.editableEl.querySelectorAll(`[${DATA_BLOCK_ATTR}="paragraph"]`));
    return all.filter((block) => range.intersectsNode(block));
  }

  _applyAlignment(align) {
    const sel = this._restoreActiveSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const blocks = this._paragraphsTouchedByRange(range);
    if (blocks.length === 0) return;
    this._flushPendingHistorySnapshot();
    for (const block of blocks) setBlockAlign(block, align);
    this._commitHistorySnapshot();
    this._refreshToolbarFromSelection();
    this.onChange();
  }

  // ---------------- Bullet / numbered lists, indent, line/paragraph spacing ----------------
  // All block-level, reusing _paragraphsTouchedByRange exactly like alignment above — none of
  // these ever touch run spans.

  // Toggle semantics (like Bold/Italic, unlike alignment's always-set): clicking Bullet when every
  // touched paragraph is already a bullet list turns list formatting OFF for all of them; any other
  // state (including mixed, or Numbered) turns them all into this exact list type — Word's own
  // "click to apply this list type" behavior, never lying about a mixed starting state.
  _applyListFormat(listType) {
    const sel = this._restoreActiveSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const blocks = this._paragraphsTouchedByRange(range);
    if (blocks.length === 0) return;
    this._flushPendingHistorySnapshot();
    const allAlreadyThisType = blocks.every((b) => effectiveBlockList(b) === listType);
    for (const block of blocks) setBlockList(block, allAlreadyThisType ? null : listType);
    this._renormalizeListMarkers();
    this._commitHistorySnapshot();
    this._refreshToolbarFromSelection();
    this.onChange();
  }

  _applyIndent(delta) {
    const sel = this._restoreActiveSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const blocks = this._paragraphsTouchedByRange(range);
    if (blocks.length === 0) return;
    this._flushPendingHistorySnapshot();
    for (const block of blocks) {
      const next = Math.max(0, Math.min(MAX_INDENT_LEVEL, effectiveBlockIndent(block) + delta));
      setBlockIndent(block, next);
    }
    this._renormalizeListMarkers();
    this._commitHistorySnapshot();
    this._refreshToolbarFromSelection();
    this.onChange();
  }

  _applyLineSpacing(value) {
    const sel = this._restoreActiveSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const blocks = this._paragraphsTouchedByRange(range);
    if (blocks.length === 0) return;
    this._flushPendingHistorySnapshot();
    for (const block of blocks) setBlockLineSpacing(block, value);
    this._commitHistorySnapshot();
    this._refreshToolbarFromSelection();
    this.onChange();
  }

  _applySpacing(value) {
    const sel = this._restoreActiveSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const blocks = this._paragraphsTouchedByRange(range);
    if (blocks.length === 0) return;
    this._flushPendingHistorySnapshot();
    for (const block of blocks) setBlockSpacing(block, value);
    this._commitHistorySnapshot();
    this._refreshToolbarFromSelection();
    this.onChange();
  }

  _renormalizeListMarkers() {
    renormalizeListMarkers(this.doc, this.editableEl);
  }

  _blockIsEmpty(block) {
    return !Array.from(block.childNodes).some(isRunSpan);
  }

  // ---------------- Clear formatting (run-level reset only — see module header for scope) ----------------
  // Deliberately resets ONLY run-level formatting (bold/italic/underline/strike/font/size/color),
  // reusing the exact same span-replacement machinery bold/italic/etc. already use. Paragraph
  // text, blank lines, Image/Table blocks, list membership, indent, alignment, and spacing are
  // never touched here — clearing formatting on a bulleted, centered paragraph leaves it a
  // bulleted, centered paragraph, just with plain (unformatted) text, matching most real editors'
  // "Clear Formatting" scope and this task's own explicit conservatism requirement.
  _clearFormatting() {
    const sel = this._restoreActiveSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const clearedPatch = { bold: false, italic: false, underline: false, strike: false, font: "default", size: DEFAULT_SIZE, color: "default" };
    if (range.collapsed) {
      this._pendingFormat = { ...clearedPatch };
      this._refreshToolbarFromSelection();
      return;
    }
    const spans = this._getExactRunSpansForRange(range);
    if (spans.length === 0) return;
    this._flushPendingHistorySnapshot();
    this._replaceSpansWithFormat(spans, clearedPatch, range);
  }

  // ---------------- Undo / Redo (bounded per-instance RichText-document history) ----------------
  // See this module's header comment for why this replaced document.execCommand. Four pieces:
  //   _initHistory      — called whenever a NEW document is loaded (constructor/setRichText/
  //                        setPlainText): resets the stack to exactly one entry, the loaded state.
  //   _queueHistorySnapshot   — DEBOUNCED commit, for continuous typing-like input (native typing/
  //                        merge, paste... see call sites) so a whole burst becomes ONE undo step.
  //   _commitHistorySnapshot  — IMMEDIATE commit, for discrete one-click actions (every toolbar
  //                        formatting action, Enter, image/table insertion) so each is its own step.
  //   _flushPendingHistorySnapshot — turns a still-pending debounced burst into a real entry right
  //                        now, called at the START of every discrete action and at the start of
  //                        _undo/_redo, so a just-finished typing burst is never silently lost or
  //                        merged into the next, unrelated action.

  _initHistory(snapshot) {
    if (this._historyDebounceTimer) { clearTimeout(this._historyDebounceTimer); this._historyDebounceTimer = null; }
    this._history = [snapshot];
    this._historyIndex = 0;
    this._updateUndoRedoButtons();
  }

  _commitHistorySnapshot() {
    if (this._isRestoringHistory) return;
    const result = serializeToRichText(this.editableEl);
    if (!result.ok) return; // a transient/over-limit DOM state must never corrupt history
    const snapshot = result.value;
    const current = this._history[this._historyIndex];
    if (current && richTextDeepEqual(current, snapshot)) return; // meaningless duplicate — skip
    // A new edit always discards whatever redo branch existed beyond the current point.
    this._history = this._history.slice(0, this._historyIndex + 1);
    this._history.push(snapshot);
    if (this._history.length > this._historyMax) this._history.shift(); // bounded ring, oldest first
    this._historyIndex = this._history.length - 1;
    this._updateUndoRedoButtons();
  }

  _flushPendingHistorySnapshot() {
    if (!this._historyDebounceTimer) return;
    clearTimeout(this._historyDebounceTimer);
    this._historyDebounceTimer = null;
    this._commitHistorySnapshot();
  }

  _queueHistorySnapshot() {
    if (this._isRestoringHistory) return;
    if (this._historyDebounceTimer) clearTimeout(this._historyDebounceTimer);
    this._historyDebounceTimer = setTimeout(() => {
      this._historyDebounceTimer = null;
      this._commitHistorySnapshot();
    }, this._historyDebounceMs);
  }

  _undo() {
    if (this._isComposing) return;
    this._flushPendingHistorySnapshot();
    if (this._historyIndex <= 0) return;
    this._historyIndex--;
    this._restoreHistorySnapshot(this._history[this._historyIndex]);
  }

  _redo() {
    if (this._isComposing) return;
    // Flushing here too: if the user typed something after an Undo but the debounce hasn't
    // committed yet, that edit must win over (and correctly discard) any stale redo branch —
    // exactly the same "a new edit clears redo" rule _commitHistorySnapshot already enforces.
    this._flushPendingHistorySnapshot();
    if (this._historyIndex >= this._history.length - 1) return;
    this._historyIndex++;
    this._restoreHistorySnapshot(this._history[this._historyIndex]);
  }

  // Rebuilds the editable DOM from scratch from an already-valid snapshot (richTextToDom always
  // produces fully normalized DOM — correct run spans, list markers, region grouping — so no
  // _normalizeAllBlocks pass is needed afterward, unlike native typing). _isRestoringHistory
  // suppresses the onChange() below from re-entering the history stack. Caret placement is
  // intentionally simple and always-valid (end of the restored document) rather than attempting to
  // reproduce the exact pre-edit caret position — see the final report's documented limitation.
  _restoreHistorySnapshot(snapshot) {
    this._isRestoringHistory = true;
    try {
      this._clearEditable();
      this.editableEl.appendChild(richTextToDom(this.doc, snapshot));
      this._hydrateImages();
      this._pendingFormat = { ...DEFAULT_RUN_FORMAT };
      this._placeCaretAtDocumentEnd();
      this._refreshToolbarFromSelection();
      this.onChange();
    } finally {
      this._isRestoringHistory = false;
    }
  }

  _placeCaretAtDocumentEnd() {
    const sel = this._getSelection();
    if (!sel) return;
    const blocks = Array.from(this.editableEl.querySelectorAll(`[${DATA_BLOCK_ATTR}="paragraph"]`));
    const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : this._firstBlock();
    if (!lastBlock) return;
    const runs = Array.from(lastBlock.childNodes).filter(isRunSpan);
    const lastRun = runs[runs.length - 1];
    const range = this.doc.createRange();
    if (lastRun) {
      range.setStart(lastRun.firstChild || lastRun, (lastRun.textContent || "").length);
    } else {
      range.setStart(lastBlock, lastBlock.childNodes.length);
    }
    range.collapse(true);
    try { sel.removeAllRanges(); sel.addRange(range); } catch { /* best-effort caret placement */ }
  }

  _updateUndoRedoButtons() {
    this.undoBtn.disabled = this._historyIndex <= 0;
    this.redoBtn.disabled = this._historyIndex >= this._history.length - 1;
  }

  _runInfoFromSpan(span) {
    const run = readRunFromMarkedSpan(span);
    return {
      bold: run.bold === true,
      italic: run.italic === true,
      underline: run.underline === true,
      strike: run.strike === true,
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
      if (merged.underline) cleaned.underline = true;
      if (merged.strike) cleaned.strike = true;
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
    this._commitHistorySnapshot();
    this._refreshToolbarFromSelection();
    this.onChange();
  }

  _mergeAdjacentRunsEverywhere() {
    const blocks = Array.from(this.editableEl.querySelectorAll(`[${DATA_BLOCK_ATTR}="paragraph"],[data-rt-cell="1"]`));
    for (const block of blocks) this._mergeAdjacentRunsInBlock(block);
  }

  _mergeAdjacentRunsInBlock(block) {
    let child = block.firstChild;
    while (child && child.nextSibling) {
      const next = child.nextSibling;
      if (isRunSpan(child) && isRunSpan(next)) {
        const a = this._runInfoFromSpan(child);
        const b = this._runInfoFromSpan(next);
        const sameFormat = a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike && a.font === b.font && a.size === b.size && a.color === b.color;
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
    let alignBlocks;
    if (!sel || !this._selectionIsInsideEditor(sel) || sel.rangeCount === 0) {
      infos = [this._pendingFormat];
      const fallback = this._currentBlock();
      alignBlocks = fallback && fallback.getAttribute(DATA_BLOCK_ATTR) === "paragraph" ? [fallback] : [];
    } else {
      const range = sel.getRangeAt(0);
      if (range.collapsed) {
        infos = [this._pendingFormat];
      } else {
        const spans = this._getTouchedSpansReadOnly(range);
        infos = spans.length > 0 ? spans.map((s) => this._runInfoFromSpan(s)) : [this._pendingFormat];
      }
      alignBlocks = this._paragraphsTouchedByRange(range);
    }
    const state = computeFormatState(infos);
    this.boldBtn.setAttribute("aria-pressed", state.mixed.bold ? "mixed" : String(state.bold));
    this.italicBtn.setAttribute("aria-pressed", state.mixed.italic ? "mixed" : String(state.italic));
    this.underlineBtn.setAttribute("aria-pressed", state.mixed.underline ? "mixed" : String(state.underline));
    this.strikeBtn.setAttribute("aria-pressed", state.mixed.strike ? "mixed" : String(state.strike));
    this.fontSelect.value = state.mixed.font ? "" : state.font;
    this.sizeSelect.value = state.mixed.size ? "" : String(state.size);
    this.colorSelect.value = state.mixed.color ? "" : state.color;

    const alignValues = alignBlocks.length > 0 ? alignBlocks.map((b) => effectiveBlockAlign(b)) : [];
    const alignState = computeAlignState(alignValues);
    for (const [align, btn] of this.alignButtons) {
      btn.setAttribute("aria-pressed", alignState.mixed ? "mixed" : String(alignState.align === align));
    }

    const listValues = alignBlocks.map((b) => effectiveBlockList(b));
    const listState = computeUniformState(listValues, "");
    this.bulletBtn.setAttribute("aria-pressed", listState.mixed ? "mixed" : String(listState.value === "bullet"));
    this.numberBtn.setAttribute("aria-pressed", listState.mixed ? "mixed" : String(listState.value === "number"));

    const lineSpacingValues = alignBlocks.map((b) => effectiveBlockLineSpacing(b));
    const lineSpacingState = computeUniformState(lineSpacingValues, "1");
    this.lineSpacingSelect.value = lineSpacingState.mixed ? "" : lineSpacingState.value;

    const spacingValues = alignBlocks.map((b) => effectiveBlockSpacing(b));
    const spacingState = computeUniformState(spacingValues, "normal");
    this.spacingSelect.value = spacingState.mixed ? "" : spacingState.value;

    this._updateUndoRedoButtons();
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
    if (e.key === "Backspace" || e.key === "Delete") {
      // A switch from inserting to deleting is a natural undo-group boundary (matching most real
      // editors): flush any pending typed-text checkpoint now, BEFORE the native deletion runs, so
      // a deletion/merge never gets silently absorbed into the undo step for unrelated prior
      // typing. The deletion itself is not intercepted (no preventDefault) — it proceeds natively,
      // and _handleInput queues its own result afterward as a new (and, for a run of several
      // Backspace presses, still correctly coalesced) debounced entry.
      this._flushPendingHistorySnapshot();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const sel=this._getSelection();
      const cell=sel?.rangeCount ? (sel.getRangeAt(0).startContainer.nodeType===1?sel.getRangeAt(0).startContainer:sel.getRangeAt(0).startContainer.parentNode)?.closest?.('[data-rt-cell="1"]') : null;
      if(cell){ this._insertTextAtCaret("\n"); return; }
      const currentBlock = this._currentBlock();
      if (currentBlock && currentBlock.getAttribute(DATA_BLOCK_ATTR) === "paragraph" && effectiveBlockList(currentBlock) && this._blockIsEmpty(currentBlock)) {
        // Word-like: Enter on an empty list item exits the list in place, rather than adding yet
        // another empty bullet/number — this one paragraph becomes a plain paragraph, no new line.
        this._flushPendingHistorySnapshot();
        setBlockList(currentBlock, null);
        setBlockIndent(currentBlock, 0);
        this._renormalizeListMarkers();
        this._commitHistorySnapshot();
        this._refreshToolbarFromSelection();
        this.onChange();
        return;
      }
      this._insertParagraphBreakAtCaret();
      return;
    }
    // Standard formatting shortcuts (Ctrl on Windows/Linux, Cmd on macOS), including Undo/Redo —
    // see this module's header comment: Ctrl/Cmd+Z/+Y now drive this module's OWN history (the
    // exact same _undo()/_redo() the toolbar buttons call), not the browser's native history.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === "b") { e.preventDefault(); this._toggleBooleanFormat("bold"); return; }
      if (key === "i") { e.preventDefault(); this._toggleBooleanFormat("italic"); return; }
      if (key === "u") { e.preventDefault(); this._toggleBooleanFormat("underline"); return; }
      if (key === "z") { e.preventDefault(); this._undo(); return; }
      if (key === "y") { e.preventDefault(); this._redo(); return; }
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

    // Editability now lives on the shared text region (currentBlock.parentNode), not on each
    // paragraph individually — the new block inherits it natively from that same region.
    const newBlock = this.doc.createElement("div");
    newBlock.setAttribute(DATA_BLOCK_ATTR, "paragraph");
    // Word-like Enter inheritance: the newly-split paragraph starts with the SAME alignment/list/
    // indent as the paragraph it split from (e.g. Enter from a Centered title keeps the next line
    // Centered; Enter on a list item creates the next item, same type and indent, until the user
    // chooses otherwise). Reads attributes directly (not the effectiveBlockXxx helpers) so a
    // currentBlock with no explicit value correctly leaves newBlock with no attribute either,
    // rather than writing out an explicit default. List marker insertion itself happens afterward
    // via _renormalizeListMarkers, not here.
    for (const attr of [DATA_ALIGN_ATTR, DATA_LIST_ATTR, DATA_INDENT_ATTR]) {
      const value = currentBlock.getAttribute(attr);
      if (value !== null) newBlock.setAttribute(attr, value);
    }
    if (currentBlock.style.textAlign) newBlock.style.textAlign = currentBlock.style.textAlign;
    if (currentBlock.style.marginLeft) newBlock.style.marginLeft = currentBlock.style.marginLeft;

    // Move every sibling AFTER the split point into the new block. The list marker (if any) is the
    // block's non-editable first child and must never itself be moved — only real content moves;
    // the new block gets its own fresh marker from _renormalizeListMarkers below.
    let moveStart;
    if (anchorSpan) {
      moveStart = anchorSpan.nextSibling;
    } else {
      // Caret was at a position with no run to its left (start of block, or empty block) — the
      // whole block's content (if any, excluding its marker) moves to the new block, leaving the
      // original (plus its marker, if it has one) empty.
      moveStart = Array.from(currentBlock.childNodes).find((c) => !isListMarkerElement(c)) || null;
    }
    while (moveStart) {
      const next = moveStart.nextSibling;
      newBlock.appendChild(moveStart);
      moveStart = next;
    }

    this._ensureBlockHasContent(currentBlock);
    this._ensureBlockHasContent(newBlock);

    currentBlock.parentNode.insertBefore(newBlock, currentBlock.nextSibling);
    this._renormalizeListMarkers();

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

    // Debounced, same bucket as native typing: Enter is a normal part of a typing flow, and a
    // fast "Enter, keep typing" burst should coalesce into one undo step like everything else.
    this._queueHistorySnapshot();
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

  // Falls back to the first actual paragraph/cell block (never a text-region container, which is
  // not itself a valid Range-anchor block for the callers of this method) when there is no live
  // selection to anchor to.
  _firstBlock() {
    return this.editableEl.querySelector(`[${DATA_BLOCK_ATTR}="paragraph"],[data-rt-cell="1"]`) || this.editableEl.firstChild;
  }

  _currentBlock() {
    const sel = this._getSelection();
    if (!sel || sel.rangeCount === 0) return this._firstBlock();
    return this._blockAncestor(sel.getRangeAt(0).startContainer) || this._firstBlock();
  }

  // ---------------- Input normalization (bare-text-node wrapping, IME-safe) ----------------

  _handleInput() {
    if (this._isComposing) return;
    const restore = this._captureCaretForNormalize();
    this._normalizeAllBlocks();
    this._restoreCaretAfterNormalize(restore);
    this._queueHistorySnapshot();
    this._handleSelectionChange();
    this.onChange();
  }

  // Captures the caret as a block-relative character offset (the same DOM-mutation-independent
  // technique _insertTextAtCaret already uses for paste, via _blockCharOffset/_locateBlockOffset)
  // BEFORE _normalizeAllBlocks can run. Native typing's "input" event, and a composition's
  // "compositionend", both fire AFTER the browser has already inserted a bare text node directly
  // under the block div when typing/composing into a previously bare/empty paragraph (e.g. one
  // just created by Enter, or the first paragraph of a blank document). _normalizeBlock's
  // block.replaceChild(fresh, bareTextNode) then silently drops the Selection's anchor with no
  // restoration, so without this capture-and-restore pair the caret resets to the start of the
  // block on that one keystroke/composition. When typing continues into an ALREADY-normalized
  // paragraph (the common case), the browser mutates the existing run span's text node in place —
  // no bare node appears, _normalizeBlock never touches that span, and this capture/restore pair is
  // a no-op (the located offset round-trips exactly), so this does not change already-correct
  // behavior.
  _captureCaretForNormalize() {
    const sel = this._getSelection();
    if (!sel || sel.rangeCount === 0 || !this._selectionIsInsideEditor(sel)) return null;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return null;
    const block = this._blockAncestor(range.startContainer);
    if (!block) return null;
    return { block, charOffset: this._blockCharOffset(block, range.startContainer, range.startOffset) };
  }

  _restoreCaretAfterNormalize(restore) {
    if (!restore) return;
    const sel = this._getSelection();
    if (!sel) return;
    const located = this._locateBlockOffset(restore.block, restore.charOffset);
    const newRange = this.doc.createRange();
    if (located) {
      newRange.setStart(located.span.firstChild, located.offset);
    } else {
      newRange.setStart(restore.block, 0);
    }
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }

  // Wraps any bare Text node the browser inserted directly under a block div into a proper run
  // span carrying the current typing-state format, removes/restores the empty-paragraph <br>
  // placeholder as needed, and merges adjacent same-format runs. Runs over the whole editor each
  // time — cheap at the classroom-scale content sizes this contract allows (<=20 blocks, <=20
  // runs/block).
  _normalizeAllBlocks() {
    const blocks = Array.from(this.editableEl.querySelectorAll(`[${DATA_BLOCK_ATTR}="paragraph"],[data-rt-cell="1"]`));
    if (!this.editableEl.querySelector(`[${DATA_BLOCK_ATTR}="paragraph"]`)) {
      this.editableEl.appendChild(createEmptyDocumentDom(this.doc));
    }
    for (const block of blocks) this._normalizeBlock(block);
    // Defensive only: native multi-paragraph Backspace/Delete across a selection could in principle
    // remove every paragraph out of a text region. Re-arm any region left with none, the same way
    // the whole-editor fallback above re-arms a document left with no paragraph anywhere.
    for (const region of this.editableEl.querySelectorAll(`[${DATA_TEXT_REGION_ATTR}="1"]`)) {
      if (!region.querySelector(`[${DATA_BLOCK_ATTR}="paragraph"]`)) {
        region.appendChild(createEmptyParagraphElement(this.doc));
      }
    }
    // Covers every path that reaches here: native typing/merge (_handleInput), paste, and
    // compositionend — any of which can change which paragraphs are list items, their order, or
    // introduce/remove a region boundary.
    this._renormalizeListMarkers();
  }

  _normalizeBlock(block) {
    for (const child of Array.from(block.childNodes)) {
      if (isListMarkerElement(child)) {
        // The non-editable bullet/number marker — never treated as bare/hostile content; its
        // number is recomputed separately by _renormalizeListMarkers, not here.
        continue;
      }
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
    if (formatInfo.underline) run.underline = true;
    if (formatInfo.strike) run.strike = true;
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

    // Commits any pending typing burst from BEFORE this paste as its own separate undo step, so
    // undoing the paste never also silently swallows unrelated prior typing.
    this._flushPendingHistorySnapshot();

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
    // Discard the noisy intermediate debounce timer(s) the multi-line insertion loop above may
    // have queued via _insertParagraphBreakAtCaret (each line split calls _queueHistorySnapshot) —
    // a paste should land as exactly ONE atomic, undoable step, not one per pasted line.
    if (this._historyDebounceTimer) { clearTimeout(this._historyDebounceTimer); this._historyDebounceTimer = null; }
    this._commitHistorySnapshot();
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
      // The list marker's own text ("•"/"1.") is presentational, never part of the block's actual
      // character stream — excluded here exactly like it is from readRunsFromBlock/serialization.
      if (isListMarkerElement(child)) continue;
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

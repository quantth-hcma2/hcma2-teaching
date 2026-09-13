// Minimal, dependency-free DOM test double for exercising rich-text-renderer.mjs under Node's
// test runner without adding a jsdom (or similar) dependency to this project, which otherwise has
// zero frontend dependencies. Implements only the handful of DOM operations the renderer actually
// uses: createElement, appendChild, removeChild, firstChild, textContent (get/set), and a plain
// `style` object.

export class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this._children = [];
    this._text = "";
    this.style = {};
  }
  get children() {
    return this._children.slice();
  }
  get firstChild() {
    return this._children.length ? this._children[0] : null;
  }
  appendChild(node) {
    this._children.push(node);
    return node;
  }
  removeChild(node) {
    const idx = this._children.indexOf(node);
    if (idx !== -1) this._children.splice(idx, 1);
    return node;
  }
  get textContent() {
    if (this._children.length === 0) return this._text;
    return this._children.map((c) => c.textContent).join("");
  }
  set textContent(value) {
    this._children = [];
    this._text = String(value);
  }
}

export class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

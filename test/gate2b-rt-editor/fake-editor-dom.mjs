// GATE 2B-RT-EDITOR — dependency-free DOM test double for exercising
// rich-text-editor-serializer.mjs under Node's test runner, without adding jsdom (this project has
// zero frontend dependencies — see test/gate2b-rt-contract/fake-dom.mjs for the precedent this
// extends). Unlike that earlier fake DOM (write-only: createElement/appendChild/textContent, built
// only for the renderer which never reads attributes back), this one also supports reading
// attributes, parentNode/nextSibling traversal, and node removal/replacement/splicing — the
// operations the editor's DOM->RichText serializer and its splitRunAtOffset() helper need. It does
// NOT implement Selection/Range/contenteditable/events — those require a real browser and are
// exercised in test/gate2b-rt-editor/harness (driven by the Claude Browser MCP tools), never faked.

class FakeNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.parentNode = null;
    this._children = [];
  }
  get childNodes() {
    return this._children.slice();
  }
  get firstChild() {
    return this._children.length ? this._children[0] : null;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode._children.indexOf(this);
    if (idx === -1) return null;
    return this.parentNode._children[idx + 1] || null;
  }
  contains(node) {
    let n = node;
    while (n) {
      if (n === this) return true;
      n = n.parentNode;
    }
    return false;
  }
  appendChild(node) {
    if (node.nodeType === 11) {
      for (const child of node._children.slice()) this.appendChild(child);
      node._children = [];
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this._children.push(node);
    return node;
  }
  insertBefore(node, refNode) {
    if (node.nodeType === 11) {
      for (const child of node._children.slice()) this.insertBefore(child, refNode);
      node._children = [];
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    if (refNode === null || refNode === undefined) {
      this._children.push(node);
      return node;
    }
    const idx = this._children.indexOf(refNode);
    if (idx === -1) this._children.push(node);
    else this._children.splice(idx, 0, node);
    return node;
  }
  removeChild(node) {
    const idx = this._children.indexOf(node);
    if (idx !== -1) {
      this._children.splice(idx, 1);
      node.parentNode = null;
    }
    return node;
  }
  replaceChild(newNode, oldNode) {
    const idx = this._children.indexOf(oldNode);
    if (idx === -1) throw new Error("FakeNode.replaceChild: oldNode is not a child");
    if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
    newNode.parentNode = this;
    this._children[idx] = newNode;
    oldNode.parentNode = null;
    return oldNode;
  }
}

export class FakeText extends FakeNode {
  constructor(text) {
    super(3);
    this._text = String(text);
  }
  get textContent() {
    return this._text;
  }
  set textContent(value) {
    this._text = String(value);
  }
}

export class FakeElement extends FakeNode {
  constructor(tagName) {
    super(1);
    this.tagName = String(tagName).toUpperCase();
    this._attrs = new Map();
    this.style = {};
  }
  setAttribute(name, value) {
    this._attrs.set(name, String(value));
  }
  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null;
  }
  removeAttribute(name) {
    this._attrs.delete(name);
  }
  hasAttribute(name) {
    return this._attrs.has(name);
  }
  get textContent() {
    if (this._children.length === 0) return "";
    return this._children.map((c) => c.textContent).join("");
  }
  set textContent(value) {
    for (const c of this._children.slice()) this.removeChild(c);
    const s = String(value);
    if (s !== "") this.appendChild(new FakeText(s));
  }
}

export class FakeFragment extends FakeNode {
  constructor() {
    super(11);
  }
  get textContent() {
    return this._children.map((c) => c.textContent).join("");
  }
}

export class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
  createTextNode(text) {
    return new FakeText(text);
  }
  createDocumentFragment() {
    return new FakeFragment();
  }
}

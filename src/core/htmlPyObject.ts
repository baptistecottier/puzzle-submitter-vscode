import { findAll, HtmlElement, HtmlNode, textOf } from './htmlTree';
import { PyObject, PyValue } from './pyExpr';

/** An element as aocd's locators see it through BeautifulSoup: `.text`, `.children`,
 * `.codes` (the text of every <code> inside — aocd adds this to <li>s), `.find_all(tag)`,
 * and any other attribute name as "first descendant with that tag, or None" (`li.em`). */
export class ElementObject implements PyObject {
  constructor(private readonly element: HtmlElement) {}

  getAttr(name: string): PyValue {
    switch (name) {
      case 'text':
        return textOf(this.element);
      case 'codes':
        return findAll(this.element, 'code').map(textOf);
      case 'children':
        return this.element.children.map(nodeValue);
      default: {
        const [first] = findAll(this.element, name);
        return first ? new ElementObject(first) : null;
      }
    }
  }

  callMethod(name: string, args: PyValue[]): PyValue {
    if (name === 'find_all' && typeof args[0] === 'string') return findAll(this.element, args[0]).map((el) => new ElementObject(el));
    throw new Error(`element has no method ${name}()`);
  }
}

function nodeValue(node: HtmlNode): PyValue {
  return node.kind === 'element' ? new ElementObject(node) : node.value;
}

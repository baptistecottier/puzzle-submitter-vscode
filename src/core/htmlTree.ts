/** Just enough of an HTML tree to read puzzle descriptions the way aocd does with
 * BeautifulSoup's "html.parser" — so the example locators ported from aocd (see
 * ../providers/aocExamples.ts) see the same elements and the same text. Not a general
 * HTML parser: no implied end tags, scripts and styles dropped. */

export interface HtmlElement {
  kind: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}

/** Comments are kept as nodes (they count in .children, as in BeautifulSoup) but are
 * left out of an element's text. */
export type HtmlNode = HtmlElement | { kind: 'text' | 'comment'; value: string };

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT_TAGS = new Set(['script', 'style']);
const WHITESPACE_PRESERVING_TAGS = new Set(['pre', 'textarea']);
const ASCII_WHITESPACE = /^[ \n\t\f\r]+$/;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[ref] ?? match;
  });
}

/** Index of the '>' closing the tag opened at `from`, skipping quoted attribute values. */
function tagEnd(html: string, from: number): number {
  let quote: string | undefined;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = undefined;
    } else if ((ch === '"' || ch === "'") && /=\s*$/.test(html.slice(Math.max(from, i - 8), i))) {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { kind: 'element', tag: '#document', attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const current = () => stack[stack.length - 1];

  const addText = (raw: string) => {
    if (!raw) return;
    let value = decodeEntities(raw);
    // BeautifulSoup collapses whitespace-only strings outside <pre>/<textarea> to a single
    // newline (or space) — this changes an element's text, so it's mirrored exactly.
    if (ASCII_WHITESPACE.test(value) && !stack.some((el) => WHITESPACE_PRESERVING_TAGS.has(el.tag))) {
      value = value.includes('\n') ? '\n' : ' ';
    }
    current().children.push({ kind: 'text', value });
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      addText(html.slice(i));
      break;
    }
    addText(html.slice(i, lt));

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      current().children.push({ kind: 'comment', value: html.slice(lt + 4, end === -1 ? html.length : end) });
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const name = /^<(\/?)([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 64));
    const end = name ? tagEnd(html, lt + name[0].length) : -1;
    if (!name || end === -1) {
      // Not a tag after all (a bare '<' in text) — keep it as text, like html.parser.
      addText('<');
      i = lt + 1;
      continue;
    }
    const tag = name[2].toLowerCase();
    i = end + 1;

    if (name[1]) {
      // End tag: close up to the most recent matching open element; ignore it if none is open.
      const open = stack.map((el) => el.tag).lastIndexOf(tag);
      if (open > 0) stack.length = open;
      continue;
    }

    const element: HtmlElement = { kind: 'element', tag, attrs: parseAttrs(html.slice(lt + name[0].length, end)), children: [] };
    current().children.push(element);
    const selfClosing = html[end - 1] === '/';
    if (RAW_TEXT_TAGS.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i);
      const closeEnd = close === -1 ? -1 : html.indexOf('>', close);
      i = closeEnd === -1 ? html.length : closeEnd + 1;
      continue;
    }
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(element);
  }
  return root;
}

/** Every descendant element with this tag, in document order (BeautifulSoup's find_all). */
export function findAll(element: HtmlElement, tag: string): HtmlElement[] {
  const found: HtmlElement[] = [];
  const walk = (el: HtmlElement) => {
    for (const child of el.children) {
      if (child.kind !== 'element') continue;
      if (child.tag === tag) found.push(child);
      walk(child);
    }
  };
  walk(element);
  return found;
}

export function hasClass(element: HtmlElement, className: string): boolean {
  return (element.attrs.class ?? '').split(/\s+/).includes(className);
}

/** All descendant text, comments excluded (BeautifulSoup's .text). */
export function textOf(element: HtmlElement): string {
  return element.children.map((child) => (child.kind === 'element' ? textOf(child) : child.kind === 'text' ? child.value : '')).join('');
}

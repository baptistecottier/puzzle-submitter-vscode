export function getWebviewHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    line-height: 1.4;
    color: var(--vscode-foreground);
    padding: 0 12px 16px;
  }
  h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
    margin: 16px 0 6px;
    font-weight: 600;
  }
  .card {
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 4px;
    padding: 10px;
  }
  .puzzle-title {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.3;
    cursor: pointer;
  }
  .puzzle-title:hover { text-decoration: underline; }
  .site-label {
    font-size: 11px;
    line-height: 1.4;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .field-label {
    line-height: 1.4;
    color: var(--vscode-descriptionForeground);
  }
  .row { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
  .title-row { margin-top: 2px; }
  .row-divider { width: 1px; align-self: stretch; background: var(--vscode-widget-border, var(--vscode-panel-border)); }
  select, textarea, input[type=text] {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    padding: 4px 6px;
    font-family: inherit;
    font-size: inherit;
  }
  textarea { width: 100%; box-sizing: border-box; min-height: 50px; resize: vertical; }
  button {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 2px;
    padding: 4px 10px;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    width: 100%;
    padding: 6px;
    font-weight: 600;
    margin-top: 8px;
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .status-line { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .dot.ok { background: var(--vscode-testing-iconPassed, #4caf50); }
  .dot.missing { background: var(--vscode-descriptionForeground); }
  .result {
    margin-top: 8px;
    padding: 6px 8px;
    border-radius: 2px;
    font-size: 12px;
  }
  .result.correct, .result.already-solved, .result.copied {
    background: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 18%, transparent);
  }
  .result.incorrect, .result.rate-limited, .result.unknown {
    background: color-mix(in srgb, var(--vscode-testing-iconFailed, #f44336) 15%, transparent);
  }
  .empty {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
  a.link { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .input-preview {
    margin: 6px 0 0;
    padding: 6px 8px;
    max-height: 140px;
    overflow: auto;
    background: var(--vscode-textCodeBlock-background, var(--vscode-input-background));
    border-radius: 2px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .input-preview-note { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .split-button { position: relative; display: inline-flex; }
  .split-button button:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .split-arrow {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-left: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    padding: 4px 5px;
    display: flex;
    align-items: center;
  }
  .split-menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 10;
    margin-top: 2px;
    background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border));
    border-radius: 2px;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  }
  .split-menu-item { padding: 6px 10px; cursor: pointer; }
  .split-menu-item:hover { background: var(--vscode-list-hoverBackground); }
</style>
</head>
<body>
  <div id="root"></div>
<script>
const vscode = acquireVsCodeApi();
let state = { progress: [] };
let draftAnswer = '';
let solverMenuOpen = false;

function el(tag, props, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children || []) {
    if (child) node.appendChild(child);
  }
  return node;
}

function post(msg) { vscode.postMessage(msg); }

function render() {
  const root = document.getElementById('root');
  root.innerHTML = '';

  if (!state.site) {
    root.appendChild(el('div', { class: 'empty' }, [
      document.createTextNode('No site configured for this workspace yet. '),
      el('a', { class: 'link', onclick: () => post({ type: 'setSite' }), text: 'Choose one' }),
    ]));
    return;
  }

  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'site-label', text: state.site.label }));

  if (!state.context) {
    card.appendChild(el('div', { class: 'empty', style: 'margin-top:6px' }, [
      document.createTextNode("Couldn't detect a puzzle from the active file. "),
    ]));
    card.appendChild(el('button', { onclick: () => post({ type: 'pickManually' }), text: 'Pick manually' }));
    root.appendChild(card);
    return;
  }

  const title = [state.context.group, state.context.index].filter(Boolean).join(' · ');
  const titleRow = el('div', { class: 'row title-row' });
  titleRow.appendChild(el('span', {
    class: 'puzzle-title',
    onclick: () => post({ type: 'openSite' }),
    text: title,
  }));
  titleRow.appendChild(el('span', { class: 'row-divider' }));
  titleRow.appendChild(el('span', { class: 'field-label', text: 'Part' }));
  if (state.context.maxPart > 1) {
    const select = el('select', {
      onchange: (e) => post({ type: 'setPart', part: Number(e.target.value) }),
    });
    for (let p = 1; p <= state.context.maxPart; p++) {
      select.appendChild(el('option', { value: String(p), ...(p === state.context.part ? { selected: 'selected' } : {}), text: String(p) }));
    }
    titleRow.appendChild(select);
  } else {
    titleRow.appendChild(el('span', { text: String(state.context.part) }));
  }
  card.appendChild(titleRow);

  const inputRow = el('div', { class: 'status-line', style: 'margin-top:10px' }, [
    el('span', { class: 'dot ' + (state.inputCached ? 'ok' : 'missing') }),
    el('span', { text: state.inputCached ? 'Input cached locally' : 'No local input yet' }),
  ]);
  card.appendChild(inputRow);

  const inputButtons = el('div', { class: 'row' });
  if (state.supportsFetch) {
    inputButtons.appendChild(el('button', { onclick: () => post({ type: 'fetchInput' }), text: 'Fetch Input' }));
  }
  inputButtons.appendChild(el('button', { onclick: () => post({ type: 'setInputFromClipboard' }), text: 'Set from Clipboard' }));
  card.appendChild(inputButtons);

  if (state.inputPreview) {
    const pre = el('pre', { class: 'input-preview' });
    pre.textContent = state.inputPreview.text;
    card.appendChild(pre);
    if (state.inputPreview.truncated) {
      card.appendChild(el('div', { class: 'input-preview-note' }, [
        document.createTextNode(
          'Showing first ' + state.inputPreview.text.length + ' of ' + state.inputPreview.fullLength + ' characters. '
        ),
        el('a', { class: 'link', onclick: () => post({ type: 'openInputInEditor' }), text: 'Open full input in a tab' }),
      ]));
    }
  }

  card.appendChild(el('h2', { text: 'Answer' }));
  const textarea = el('textarea', {
    placeholder: 'Type the answer, or generate it below',
    oninput: (e) => { draftAnswer = e.target.value; },
  });
  textarea.value = draftAnswer;
  card.appendChild(textarea);

  const runButtons = el('div', { class: 'row' });
  if (state.solverRunning) {
    runButtons.appendChild(el('button', { onclick: () => post({ type: 'cancelSolver' }), text: 'Running solver… Cancel' }));
  } else if (state.supportsSolver) {
    const arrowButton = el('button', {
      class: 'split-arrow',
      'aria-label': 'More run options',
      onclick: (e) => { e.stopPropagation(); solverMenuOpen = !solverMenuOpen; render(); },
    });
    arrowButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M7.976 10.072l4.357-4.357.618.62L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"/></svg>';
    const splitButton = el('div', { class: 'split-button' }, [
      el('button', { onclick: () => post({ type: 'runSolver' }), text: 'Run Python solver' }),
      arrowButton,
    ]);
    if (solverMenuOpen) {
      splitButton.appendChild(el('div', { class: 'split-menu' }, [
        el('div', {
          class: 'split-menu-item',
          onclick: () => { solverMenuOpen = false; post({ type: 'runSolver', withPrints: true }); },
          text: 'Run Python solver with prints',
        }),
      ]));
    }
    runButtons.appendChild(splitButton);
  }
  if (state.hasRunCommand) {
    runButtons.appendChild(el('button', { onclick: () => post({ type: 'runCommand' }), text: 'Run configured command' }));
  }
  if (runButtons.children.length > 0) card.appendChild(runButtons);

  if (state.supportsSubmit) {
    card.appendChild(el('button', {
      class: 'primary',
      onclick: () => post({ type: 'submit', answer: draftAnswer }),
      text: 'Submit',
    }));
  } else {
    card.appendChild(el('button', {
      class: 'primary',
      onclick: () => post({ type: 'submit', answer: draftAnswer }),
      text: 'Copy answer & open puzzle page',
    }));
  }

  if (state.lastResult) {
    card.appendChild(el('div', { class: 'result ' + state.lastResult.status, text: state.lastResult.message }));
  }

  if (state.supportsSubmit) {
    const tokenRow = el('div', { class: 'status-line', style: 'margin-top:10px' }, [
      el('span', { class: 'dot ' + (state.hasToken ? 'ok' : 'missing') }),
      el('span', { text: state.hasToken ? 'Token set' : 'No token set' }),
      el('a', { class: 'link', onclick: () => post({ type: state.hasToken ? 'clearToken' : 'setToken' }), text: state.hasToken ? 'Clear' : 'Set' }),
    ]);
    card.appendChild(tokenRow);
  }

  root.appendChild(card);
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'state') {
    state = msg.state;
    solverMenuOpen = false;
    render();
  } else if (msg.type === 'answerFilled') {
    draftAnswer = msg.value;
    render();
  }
});

document.addEventListener('click', () => {
  if (solverMenuOpen) {
    solverMenuOpen = false;
    render();
  }
});

post({ type: 'ready' });
</script>
</body>
</html>`;
}

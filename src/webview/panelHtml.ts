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
  input.answer-field { width: 100%; box-sizing: border-box; font-family: var(--vscode-editor-font-family, monospace); }
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
  .file-link { text-transform: none; letter-spacing: normal; }
  .checkbox-label { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; }
  .checkbox-label input[type=checkbox] { margin: 0; cursor: pointer; }
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
  textarea.input-editor {
    display: block;
    width: 100%;
    box-sizing: border-box;
    min-height: 80px;
    max-height: none;
    height: 140px;
    border: 1px solid var(--vscode-input-border, transparent);
    color: var(--vscode-input-foreground);
    white-space: pre;
    word-break: normal;
    overflow: auto;
    resize: vertical;
  }
  .example-runs { margin-top: 6px; font-size: 12px; }
  .run-note { margin-top: 6px; font-size: 12px; word-break: break-word; }
  .run-row { position: relative; }
  .gridos-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 2px; }
  .gridos-table th { color: var(--vscode-descriptionForeground); font-weight: 600; text-align: right; padding: 1px 3px; }
  .gridos-table td { padding: 1px 3px; white-space: nowrap; }
  .gridos-table td.num { text-align: right; font-family: var(--vscode-editor-font-family, monospace); }
  .gridos-table td.file { max-width: 90px; overflow: hidden; text-overflow: ellipsis; }
  .gridos-table tr.active td.file a { font-weight: 600; }
  .gridos-table td.target { text-decoration: underline; }
  .gridos-table td.best { color: var(--vscode-testing-iconPassed, #4caf50); }
  .gridos-table td.muted, .gridos-table tr.site-best td { color: var(--vscode-descriptionForeground); }
  .gridos-table tr.site-best td { border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); padding-top: 3px; }
  .gridos-table tr.failure td { color: var(--vscode-testing-iconFailed, #f44336); white-space: normal; padding-bottom: 3px; }
  .gridos-table .status.ok { color: var(--vscode-testing-iconPassed, #4caf50); }
  .gridos-table .status.fail { color: var(--vscode-testing-iconFailed, #f44336); }
  button.tiny { padding: 0 5px; line-height: 16px; }
  .help {
    display: inline-flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; border-radius: 50%;
    border: 1px solid var(--vscode-descriptionForeground);
    color: var(--vscode-descriptionForeground);
    font-size: 11px; font-weight: 600; cursor: help; outline: none;
  }
  .help:hover, .help:focus { color: var(--vscode-foreground); border-color: var(--vscode-focusBorder); }
  .help-card {
    display: none; position: absolute; left: 0; right: 0; top: 100%; margin-top: 4px; z-index: 10;
    padding: 8px 10px; border-radius: 4px; font-size: 12px; line-height: 1.45; cursor: default;
    background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background));
    color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border));
    box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.3));
  }
  .help:hover + .help-card, .help:focus + .help-card, .help-card:hover { display: block; }
  .help-card .help-title { font-weight: 600; margin-bottom: 4px; }
  .help-card pre {
    margin: 4px 0 6px; padding: 6px 8px; border-radius: 2px; white-space: pre; overflow-x: auto;
    font-family: var(--vscode-editor-font-family, monospace); font-size: 11px;
    background: var(--vscode-textCodeBlock-background, var(--vscode-input-background));
  }
  .help-card ul { margin: 0; padding-left: 16px; }
  .help-card code { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; }
  .run-note.ok { color: var(--vscode-testing-iconPassed, #4caf50); }
  .run-note.fail { color: var(--vscode-testing-iconFailed, #f44336); }
  .example-run { margin-top: 2px; word-break: break-all; }
  .example-runs .note { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div id="root"></div>
<script>
const vscode = acquireVsCodeApi();
let state = { progress: [] };
let draftAnswer = '';
// Unsaved edits to the input, kept across re-renders (state updates) for the same part.
let draftInput;
let draftInputKey;
let showPrints = true;

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
  const siteRow = el('div', { class: 'site-label' }, [document.createTextNode(state.site.label)]);
  if (state.solutionFile) {
    siteRow.appendChild(document.createTextNode(' · '));
    siteRow.appendChild(el('a', { class: 'link file-link', title: 'Open the solution', onclick: () => post({ type: 'openSolution' }), text: state.solutionFile }));
  }
  card.appendChild(siteRow);

  if (!state.context) {
    card.appendChild(el('div', { class: 'empty', style: 'margin-top:6px' }, [
      document.createTextNode('No puzzle yet — open a solution file, or pick the puzzle for the open file. '),
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

  if (state.gridos) {
    renderGridos(card);
    renderFooter(card);
    root.appendChild(card);
    return;
  }

  // Fetch Input (where the site has an input API) with the input's status beside it.
  const inputRow = el('div', { class: 'row', style: 'margin-top:10px' });
  if (state.supportsFetch) {
    inputRow.appendChild(el('button', { onclick: () => post({ type: 'fetchInput' }), text: 'Fetch Input' }));
  }
  inputRow.appendChild(el('span', { class: 'status-line' }, [
    el('span', { class: 'dot ' + (state.inputCached ? 'ok' : 'missing') }),
    el('span', { text: state.inputCached ? 'Input cached locally' : 'No local input yet' }),
  ]));
  if (state.inputCached) {
    inputRow.appendChild(el('a', { class: 'link', style: 'font-size:12px', onclick: () => post({ type: 'openInputInEditor' }), text: 'Open in a tab' }));
  }
  card.appendChild(inputRow);

  const inputKey = [state.context.group, state.context.index, state.context.part].join('/');
  if (draftInputKey !== inputKey) {
    draftInput = undefined;
    draftInputKey = inputKey;
  }
  if (!state.inputPreview || !state.inputPreview.truncated) {
    const saved = state.inputPreview ? state.inputPreview.text : '';
    const editor = el('textarea', {
      class: 'input-preview input-editor',
      spellcheck: 'false',
      placeholder: 'No input yet — paste it here, then Save',
    });
    editor.value = draftInput !== undefined ? draftInput : saved;
    const editButtons = el('div', { class: 'row' }, [
      el('button', { onclick: () => { post({ type: 'saveInput', text: editor.value }); draftInput = undefined; }, text: 'Save input' }),
      el('button', { onclick: () => { draftInput = undefined; render(); }, text: 'Revert' }),
    ]);
    const showButtons = () => { editButtons.style.display = editor.value !== saved ? '' : 'none'; };
    editor.addEventListener('input', () => { draftInput = editor.value; showButtons(); });
    showButtons();
    card.appendChild(editor);
    card.appendChild(editButtons);
  } else {
    const pre = el('pre', { class: 'input-preview' });
    pre.textContent = state.inputPreview.text;
    card.appendChild(pre);
    if (state.inputPreview.truncated) {
      card.appendChild(el('div', { class: 'input-preview-note' }, [
        document.createTextNode(
          'Showing first ' + state.inputPreview.text.length + ' of ' + state.inputPreview.fullLength + ' characters. '
        ),
        el('a', { class: 'link', onclick: () => post({ type: 'openInputInEditor' }), text: 'Open it in a tab' }),
      ]));
    }
  }

  if (state.examples) renderExamples(card);

  card.appendChild(el('h2', { text: 'Answer' }));
  const answerField = el('input', {
    type: 'text',
    class: 'answer-field',
    spellcheck: 'false',
    placeholder: 'Type the answer, or generate it below',
    oninput: (e) => { draftAnswer = e.target.value; },
  });
  answerField.value = draftAnswer;
  card.appendChild(answerField);

  const runButtons = el('div', { class: 'row run-row' });
  if (state.solverRunning) {
    runButtons.appendChild(el('button', { onclick: () => post({ type: 'cancelSolver' }), text: 'Running… Cancel' }));
  } else if (state.supportsSolver) {
    runButtons.appendChild(el('button', {
      onclick: () => post({ type: 'runSolver', withPrints: showPrints }),
      text: 'Run',
      title: 'Run solver() from this file on the cached input',
      ...(state.examplesRunning ? { disabled: '' } : {}),
    }));
  }
  if (state.supportsSolver) {
    runButtons.appendChild(el('span', { class: 'help', tabindex: '0', 'aria-label': 'Solution format', text: '?' }));
    runButtons.appendChild(solverHelpCard(state.solverShape));
    runButtons.appendChild(el('label', { class: 'checkbox-label' }, [
      el('input', {
        type: 'checkbox',
        ...(showPrints ? { checked: 'checked' } : {}),
        onchange: (e) => { showPrints = e.target.checked; },
      }),
      document.createTextNode('Show prints'),
    ]));
    runButtons.appendChild(el('label', { class: 'checkbox-label', title: 'Saving the solution repeats the last run: the solver, or the examples' }, [
      el('input', {
        type: 'checkbox',
        ...(state.runOnSave ? { checked: 'checked' } : {}),
        onchange: (e) => post({ type: 'setRunOnSave', value: e.target.checked }),
      }),
      document.createTextNode('Run on save'),
    ]));
  }
  if (state.hasRunCommand) {
    runButtons.appendChild(el('button', { onclick: () => post({ type: 'runCommand' }), text: 'Run configured command' }));
  }
  if (runButtons.children.length > 0) card.appendChild(runButtons);
  if (state.runOnSave && state.saveRunNote) {
    card.appendChild(el('div', { class: 'run-note ' + (state.saveRunNote.ok ? 'ok' : 'fail'), text: state.saveRunNote.text }));
  }

  if (state.supportsSubmit || state.checksLocally) {
    card.appendChild(el('button', {
      class: 'primary',
      onclick: () => post({ type: 'submit', answer: draftAnswer }),
      text: 'Submit',
      ...(state.checksLocally ? { title: 'Checked against the published answer' } : {}),
    }));
  } else {
    card.appendChild(el('button', {
      class: 'primary',
      onclick: () => post({ type: 'submit', answer: draftAnswer }),
      text: 'Copy answer & open puzzle page',
    }));
  }

  renderFooter(card);
  root.appendChild(card);
}

/** The last submit result and the token line, under either mode. */
function renderFooter(card) {
  if (state.lastResult) {
    card.appendChild(el('div', { class: 'result ' + state.lastResult.status, text: state.lastResult.message }));
  }
  if (state.supportsSubmit) {
    card.appendChild(el('div', { class: 'status-line', style: 'margin-top:10px' }, [
      el('span', { class: 'dot ' + (state.hasToken ? 'ok' : 'missing') }),
      el('span', { text: state.hasToken ? 'Token set' : 'No token set' }),
      el('a', { class: 'link', onclick: () => post({ type: state.hasToken ? 'clearToken' : 'setToken' }), text: state.hasToken ? 'Clear' : 'Set' }),
    ]));
  }
}

const GRIDOS_SCORES = [['heads', 'H'], ['states', 'S'], ['rules', 'R'], ['steps', 'St'], ['golf', 'G']];

/** GridOS mode: the part's official test cases, then every .rules file of the part folder
 * with its scores side by side, and your best scores recorded on the site. */
function renderGridos(card) {
  const g = state.gridos;
  const testsRow = el('div', { class: 'row', style: 'margin-top:10px' });
  testsRow.appendChild(el('button', { onclick: () => post({ type: 'fetchInput' }), text: 'Fetch tests' }));
  testsRow.appendChild(el('span', { class: 'status-line' }, [
    el('span', { class: 'dot ' + (g.testCount ? 'ok' : 'missing') }),
    el('span', { text: g.testCount ? g.testCount + ' test cases cached' : 'No test cases yet' }),
  ]));
  if (g.testCount) {
    testsRow.appendChild(el('a', { class: 'link', style: 'font-size:12px', onclick: () => post({ type: 'openInputInEditor' }), text: 'Open in a tab' }));
  }
  card.appendChild(testsRow);

  card.appendChild(el('h2', { text: 'Rules files' }));
  if (!g.files.length) {
    card.appendChild(el('div', { class: 'empty', text: 'No .rules file in this part folder yet.' }));
  } else {
    // Best value per score among the files that pass every case.
    const best = {};
    for (const [key] of GRIDOS_SCORES) {
      const values = g.files.filter((f) => f.run && f.run.allPassed).map((f) => f.run.scores[key]);
      if (values.length) best[key] = Math.min.apply(null, values);
    }
    const table = el('table', { class: 'gridos-table' });
    const head = el('tr', {}, [el('th', { text: '' })]);
    for (const [, short] of GRIDOS_SCORES) head.appendChild(el('th', { text: short }));
    head.appendChild(el('th', { text: '' }));
    table.appendChild(head);

    for (const file of g.files) {
      const run = file.run;
      const icon = !run ? '·' : run.allPassed ? '✓' : '✗';
      const label = file.name.replace(/^q\\d+p\\d+_?/, '').replace(/\\.rules$/, '') || file.name;
      const row = el('tr', { class: file.active ? 'active' : '' });
      row.appendChild(el('td', { class: 'file' }, [
        el('span', { class: 'status ' + (!run ? '' : run.allPassed ? 'ok' : 'fail'), text: icon + ' ' }),
        el('a', { class: 'link', title: file.name, onclick: () => post({ type: 'openFile', path: file.path }), text: label }),
      ]));
      for (const [key] of GRIDOS_SCORES) {
        if (!run) { row.appendChild(el('td', { class: 'num muted', text: '–' })); continue; }
        const value = run.scores[key];
        const classes = ['num'];
        if (file.target === key) classes.push('target');
        if (run.allPassed && best[key] === value) classes.push('best');
        const beats = run.allPassed && g.siteBest && typeof g.siteBest[key] === 'number' && value < g.siteBest[key];
        if (!run.allPassed) classes.push('muted');
        row.appendChild(el('td', { class: classes.join(' '), title: beats ? 'Beats your best on the site (' + g.siteBest[key] + ')' : '', text: value + (beats ? '★' : '') }));
      }
      row.appendChild(el('td', {}, run && run.allPassed
        ? [el('button', { class: 'tiny', title: 'Submit ' + file.name, onclick: () => post({ type: 'gridosSubmit', path: file.path }), text: '↑' })]
        : []));
      table.appendChild(row);
      if (run && !run.allPassed) {
        table.appendChild(el('tr', { class: 'failure' }, [
          el('td', { colspan: String(GRIDOS_SCORES.length + 2), text: run.passed + '/' + run.total + ' passed — ' + run.failure }),
        ]));
      }
    }

    if (g.siteBest) {
      const row = el('tr', { class: 'site-best' }, [el('td', { class: 'file', title: 'Your best scores recorded on everybody.codes', text: 'site best' })]);
      for (const [key] of GRIDOS_SCORES) {
        const value = g.siteBest[key];
        row.appendChild(el('td', { class: 'num', text: typeof value === 'number' ? String(value) : '–' }));
      }
      row.appendChild(el('td', {}));
      table.appendChild(row);
    }
    card.appendChild(table);
  }

  const runRow = el('div', { class: 'row run-row' });
  runRow.appendChild(el('button', {
    onclick: () => post({ type: 'gridosRun' }),
    text: g.running ? 'Running…' : 'Run all',
    title: "Run every .rules file of this part on its official test cases, with Everybody Codes' own GridOS engine",
    ...(g.running || !g.files.length ? { disabled: '' } : {}),
  }));
  runRow.appendChild(el('span', { class: 'help', tabindex: '0', 'aria-label': 'How to read the table', text: '?' }));
  runRow.appendChild(gridosHelpCard());
  runRow.appendChild(el('label', { class: 'checkbox-label', title: 'Saving any .rules file of this part runs them all again' }, [
    el('input', {
      type: 'checkbox',
      ...(state.runOnSave ? { checked: 'checked' } : {}),
      onchange: (e) => post({ type: 'setRunOnSave', value: e.target.checked }),
    }),
    document.createTextNode('Run on save'),
  ]));
  card.appendChild(runRow);
  if (state.runOnSave && state.saveRunNote) {
    card.appendChild(el('div', { class: 'run-note ' + (state.saveRunNote.ok ? 'ok' : 'fail'), text: state.saveRunNote.text }));
  }
}

function gridosHelpCard() {
  const list = el('ul');
  for (const html of [
    'Every <code>.rules</code> file of this part folder runs on the part\\'s official test cases, with Everybody Codes\\' own GridOS engine: same errors, checks and scores as on the site.',
    '<b>H</b> heads, <b>S</b> states used, <b>R</b> rules used, <b>St</b> steps (summed over the cases), <b>G</b> golf: lines over 5 characters, comments excluded.',
    'Underlined: the score a file is named after (<code>…_steps.rules</code>). Green: the best of these files. ★ beats your best recorded on the site.',
    '<b>↑</b> submits that file. Only a file passing every case can be sent, and one beating none of your recorded scores asks first.',
  ]) {
    const item = el('li');
    item.innerHTML = html;
    list.appendChild(item);
  }
  return el('div', { class: 'help-card', role: 'tooltip' }, [el('div', { class: 'help-title', text: 'GridOS rules files' }), list]);
}

/** The hover card next to "Run": what the solution file must define, for
 * this site's calling convention ('text': one part's input; 'parts-dict': every part). */
function solverHelpCard(shape) {
  const allParts = shape === 'parts-dict';
  const code = allParts
    ? 'def preprocessing(data):        # optional\\n' +
      '    return [parse(note) for note in data.values()]\\n\\n' +
      'def solver(notes):\\n' +
      '    yield part_1(notes[0])\\n' +
      '    yield part_2(notes[1])\\n' +
      '    yield part_3(notes[2])'
    : 'def preprocessing(data):        # optional\\n' +
      '    return parse(data)\\n\\n' +
      'def solver(data):\\n' +
      '    yield part_1(data)\\n' +
      '    yield part_2(data)';
  const points = allParts
    ? [
        ['<code>data</code> holds every unlocked part at once: <code>{1: "…", 2: "…", 3: "…"}</code>.'],
        ['What <code>preprocessing()</code> returns is passed to <code>solver()</code> as one argument.'],
      ]
    : [
        ['<code>data</code> is the selected part\\'s input, as text.'],
        ['If <code>preprocessing()</code> returns a tuple, it\\'s unpacked: <code>solver(*data)</code>. A list is passed as one argument.'],
      ];
  points.push(
    ['Return one answer, or several (tuple, list or <code>yield</code>), one per part.'],
    ['Examples often use other values (a smaller grid…): either set <code>EXAMPLE_PARAMS = {"w": 11}</code> in the file to override your defaults, or give <code>solver()</code> or <code>preprocessing()</code> an <code>example=False</code> parameter, which is <code>True</code> on example runs.'],
    ['<code>input()</code> asks you in an input box.']
  );
  const list = el('ul');
  for (const [html] of points) {
    const item = el('li');
    item.innerHTML = html;
    list.appendChild(item);
  }
  const pre = el('pre');
  pre.textContent = code;
  return el('div', { class: 'help-card', role: 'tooltip' }, [
    el('div', { class: 'help-title', text: 'What the solution file needs' }),
    pre,
    list,
  ]);
}

function renderExamples(card) {
  const ex = state.examples;
  card.appendChild(el('h2', { text: 'Examples' }));
  const status = ex.count
    ? ex.count + ' example' + (ex.count > 1 ? 's' : '') + ' · ' + ex.forPart + ' with a part ' + state.context.part + ' answer'
    : 'No examples yet';
  const statusLine = el('div', { class: 'status-line' }, [
    el('span', { class: 'dot ' + (ex.forPart ? 'ok' : 'missing') }),
    el('span', { text: status }),
  ]);
  if (ex.count) statusLine.appendChild(el('a', { class: 'link', onclick: () => post({ type: 'openExamples' }), text: 'Open' }));
  card.appendChild(statusLine);

  const buttons = el('div', { class: 'row' });
  if (state.examplesRunning) {
    buttons.appendChild(el('button', { onclick: () => post({ type: 'cancelSolver' }), text: 'Running examples… Cancel' }));
  } else {
    buttons.appendChild(el('button', {
      onclick: () => post({ type: 'runExamples', withPrints: showPrints }),
      text: 'Run on Examples',
      ...(state.solverRunning ? { disabled: '' } : {}),
    }));
  }
  if (ex.canFetch) {
    buttons.appendChild(el('button', {
      onclick: () => post({ type: 'fetchExamples' }),
      text: 'Fetch Examples',
      ...(state.solverRunning || state.examplesRunning ? { disabled: '' } : {}),
    }));
  }
  card.appendChild(buttons);

  if (!state.exampleRuns) return;
  const list = el('div', { class: 'example-runs' });
  const passed = state.exampleRuns.filter((r) => r.status === 'pass').length;
  list.appendChild(el('div', { class: 'note', text: passed + '/' + state.exampleRuns.length + ' passing' }));
  for (const run of state.exampleRuns) {
    const icon = { pass: '✅', fail: '❌', error: '⚠️' }[run.status];
    const text = run.status === 'pass'
      ? run.computed
      : run.status === 'fail'
        ? 'got ' + run.computed + ', expected ' + run.expected
        : run.message;
    const row = el('div', { class: 'example-run', text: icon + ' Example ' + run.index + ' — ' + text });
    if (run.extra && run.status !== 'pass') {
      const extra = Object.entries(run.extra).map(([k, v]) => k + '=' + JSON.stringify(v)).join(', ');
      row.appendChild(el('span', { class: 'note', text: ' (example uses ' + extra + ')' }));
    }
    list.appendChild(row);
  }
  card.appendChild(list);
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'state') {
    state = msg.state;
    render();
  } else if (msg.type === 'answerFilled') {
    draftAnswer = msg.value;
    render();
  }
});

post({ type: 'ready' });
</script>
</body>
</html>`;
}

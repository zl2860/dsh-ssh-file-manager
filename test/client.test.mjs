// Client-half smoke test: loads the browser module the way the Web loader does
// (window.__ModuleLoader__.load), runs apply() against a stub Client context,
// checks locale parity and slot registrations, then renders the panel once with
// hook stubs to catch render-time errors without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let loadedModule = null;
let resolveModule;
const loaded = new Promise((resolve) => { resolveModule = resolve; });

globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loadedModule = spec;
      resolveModule(spec);
    },
  },
};

await import('../client.js');
const spec = await loaded;
assert.equal(spec.id, 'dsh-ssh-file-manager');
assert.equal(typeof spec.factory, 'function');

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useMemo: (factory) => factory(),
  useCallback: (callback) => callback,
  useEffect: () => {},
};

function createHarness() {
  const registrations = [];
  let localeRegistration = null;
  let boundNamespace = null;
  const module = spec.factory((name) => {
    if (name === 'react') return ReactStub;
    throw new Error('unexpected module request: ' + name);
  });
  const ctx = {
    effect: (factory) => {
      const dispose = factory();
      assert.equal(typeof dispose, 'function', 'every effect returns a disposer');
    },
    locale: {
      register: (namespace, dicts) => {
        localeRegistration = { namespace, dicts };
        return () => {};
      },
      bind: (namespace) => {
        boundNamespace = namespace;
        return (key) => key;
      },
    },
    slots: {
      inject: (owner, factory) => {
        assert.equal(typeof owner, 'string');
        factory();
      },
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  module.apply(ctx);
  return { module, registrations, localeRegistration, boundNamespace };
}

test('apply registers both locale dictionaries and both slots', () => {
  const harness = createHarness();
  assert.equal(harness.boundNamespace, 'ssh-files');
  assert.equal(harness.localeRegistration.namespace, 'ssh-files');
  assert.equal(typeof harness.localeRegistration.dicts.zh, 'object');
  assert.equal(typeof harness.localeRegistration.dicts.en, 'object');

  const sidebar = harness.registrations.find((entry) => entry.options.name === 'sidebar.panellist');
  assert.ok(sidebar, 'sidebar entry registered');
  assert.equal(sidebar.options.id, 'ssh-files');
  assert.equal(typeof sidebar.options.label, 'function');
  assert.equal(typeof sidebar.component, 'function');

  const main = harness.registrations.find((entry) => entry.options.name === 'main');
  assert.ok(main, 'main panel registered');
  assert.equal(main.options.key, 'ssh-files');
  assert.equal(typeof main.component, 'function');
});

test('zh and en dictionaries cover the same keys', () => {
  const harness = createHarness();
  const zh = harness.localeRegistration.dicts.zh;
  const en = harness.localeRegistration.dicts.en;
  const missingInEn = Object.keys(zh).filter((key) => !(key in en));
  const missingInZh = Object.keys(en).filter((key) => !(key in zh));
  assert.deepEqual(missingInEn, []);
  assert.deepEqual(missingInZh, []);
});

function walk(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    visit(node);
    return;
  }
  assert.ok(node.type !== undefined, 'element has a type');
  assert.ok(typeof node.type === 'string' || typeof node.type === 'function' || typeof node.type === 'object',
    'element type is renderable: ' + String(node.type));
  visit(node);
  walk(node.children, visit);
  if (node.props && node.props.children) walk(node.props.children, visit);
}

function classNames(element) {
  const names = new Set();
  walk(element, (node) => {
    if (node && typeof node === 'object' && node.props && typeof node.props.className === 'string') {
      for (const name of node.props.className.split(/\s+/)) if (name) names.add(name);
    }
  });
  return names;
}

test('panel renders an empty state without a browser', () => {
  const harness = createHarness();
  const tree = harness.module.Panel();
  const names = classNames(tree);
  assert.ok(names.has('ssf-root'));
  assert.ok(names.has('ssf-top'));
  assert.ok(names.has('ssf-main'));
  assert.ok(names.has('ssf-foot'));
  // No sources loaded yet: the empty hint is drawn inside the tree area.
  let texts = [];
  walk(tree, (node) => { if (typeof node === 'string') texts.push(node); });
  assert.ok(texts.includes('state.loading') || texts.includes('source.label'));
});

test('sidebar icon renders a self-contained svg', () => {
  const harness = createHarness();
  const element = harness.module.Icon({ size: 24 });
  assert.equal(element.type, 'svg');
  assert.equal(element.props.width, 24);
  walk(element, (node) => {
    if (node && typeof node === 'object' && node.type === 'path') {
      assert.ok(typeof node.props.d === 'string' && node.props.d.length > 0);
    }
  });
});

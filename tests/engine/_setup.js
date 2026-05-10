const fs = require('fs');
const vm = require('vm');
const path = require('path');

function createContext() {
  const listeners = new Map();
  const elements = new Map();
  function makeElement(tagName, id) {
    const el = {
      tagName: tagName || 'div',
      id: id || '',
      className: '',
      textContent: '',
      innerHTML: '',
      value: '',
      checked: false,
      style: {},
      dataset: {},
      children: [],
      classList: { add(){}, remove(){}, contains(){ return false; } },
      appendChild(child){ this.children.push(child); if (child && child.id) elements.set(child.id, child); return child; },
      remove(){},
      addEventListener(){},
      querySelector(){ return null; },
      querySelectorAll(){ return []; },
    };
    if (id) elements.set(id, el);
    return el;
  }
  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Error,
    TypeError,
    Promise,
    location: { search: '' },
    window: null,
    globalThis: null,
    document: {
      createElement(tagName) { return makeElement(tagName); },
      body: makeElement('body', 'body'),
      getElementById(id) {
        if (!id) return null;
        if (!elements.has(id)) elements.set(id, makeElement('div', id));
        return elements.get(id);
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
    },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatchEvent(event) {
      const handlers = listeners.get(event.type) || [];
      handlers.forEach(handler => handler(event));
      return true;
    },
    confirm() { return true; },
    alert() {},
    notify() {},
    log() {},
    sendGameState() {},
    renderAll() {},
    sendAction() {},
    shuffle(arr) { return arr.slice(); },
    currentPhase: 'deploy',
    isMyTurn: true,
    myRole: 'host',
    opRole: 'guest',
    activeChainState: null,
    G: null,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}

function projectRoot() {
  return path.resolve(__dirname, '..', '..');
}

function runFile(ctx, rel) {
  const full = path.join(projectRoot(), rel);
  const code = fs.readFileSync(full, 'utf8');
  vm.runInContext(code, ctx, { filename: rel });
}

const CORE_FILES = [
  'js/cards.js',
  'js/rules/effect-types.js',
  'js/rules/zones.js',
  'js/rules/phases.js',
  'js/rules/card-types.js',
  'js/rules/effect-tags.js',
  'js/rules/events.js',
  'js/rules/timing.js',
  'js/engine/effect-definition.js',
  'js/effects/effect-registry.js',
  'js/engine/zone-access.js',
  'js/engine/event-bus.js',
  'js/engine/card-move.js',
  'js/engine/effect-context.js',
  'js/engine/processing-negate-engine.js',
  'js/engine/chain-engine.js',
  'js/engine/trigger-queue.js',
  'js/engine/continuous-engine.js',
  'js/engine/field-zone.js',
  'js/engine/network-sync.js',
  'js/engine/effect-ui.js',
  'js/engine/legacy-bridge.js',
];

const THEME_FILES = [
  'js/effects/theme/penguin.js',
  'js/effects/theme/circusmare.js',
  'js/effects/theme/elements.js',
  'js/effects/theme/cthulhu.js',
  'js/effects/theme/ruler.js',
  'js/effects/theme/bulgasaui.js',
  'js/effects/theme/mafia.js',
  'js/effects/theme/lion.js',
  'js/effects/theme/tiger.js',
  'js/effects/theme/liger.js',
];

function loadCore(ctx) {
  CORE_FILES.forEach(file => runFile(ctx, file));
  return ctx;
}

function loadAllEffects(ctx) {
  loadCore(ctx);
  THEME_FILES.forEach(file => runFile(ctx, file));
  return ctx;
}

function makeCard(id, extra) {
  return Object.assign({ id, name: id }, extra || {});
}

function makeState(overrides) {
  return Object.assign({
    myHand: [],
    opHand: [],
    myDeck: [],
    opDeck: [],
    myField: [],
    opField: [],
    myGrave: [],
    opGrave: [],
    myExile: [],
    opExile: [],
    myFieldCard: null,
    opFieldCard: null,
    myKeyDeck: [],
    opKeyDeck: [],
    myDeckCount: 0,
    opDeckCount: 0,
    myExtraSlots: 0,
    opExtraSlots: 0,
    turn: 1,
    phase: 'deploy',
    activeController: 'me',
  }, overrides || {});
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message || 'not equal'}: expected ${expected}, got ${actual}`);
}

function assertArrayIncludes(array, value, message) {
  if (!array.includes(value)) throw new Error(`${message || 'array does not include value'}: ${value}`);
}

module.exports = {
  createContext,
  loadCore,
  loadAllEffects,
  runFile,
  makeCard,
  makeState,
  assert,
  assertEqual,
  assertArrayIncludes,
};

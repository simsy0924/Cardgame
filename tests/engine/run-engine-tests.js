const tests = [
  ['card-move', require('./card-move.test')],
  ['chain-engine', require('./chain-engine.test')],
  ['full-chain-migration', require('./full-chain-migration.test')],
  ['chain-network-safety', require('./chain-network-safety.test')],
  ['ai-engine-actions', require('./ai-engine-actions.test')],
  ['trigger-queue', require('./trigger-queue.test')],
  ['field-zone', require('./field-zone.test')],
  ['effect-registry', require('./effect-registry.test')],
  ['penguin-discard', require('./penguin-discard.test')],
  ['immunity-enforcement', require('./immunity-enforcement.test')],
  ['legacy-cleanup', require('./legacy-cleanup.test')],
  ['final-gate', require('./final-gate.test')],
  ['final-audit', require('./final-audit.test')],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

if (failed > 0) {
  console.error(`${failed} engine test(s) failed.`);
  process.exit(1);
}
console.log(`All ${tests.length} engine test files passed.`);
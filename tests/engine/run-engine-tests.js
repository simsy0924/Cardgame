const tests = [
  ['card-move', require('./card-move.test')],
  ['chain-engine', require('./chain-engine.test')],
  ['trigger-queue', require('./trigger-queue.test')],
  ['field-zone', require('./field-zone.test')],
  ['effect-registry', require('./effect-registry.test')],
  ['legacy-cleanup', require('./legacy-cleanup.test')],
  ['final-gate', require('./final-gate.test')],
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

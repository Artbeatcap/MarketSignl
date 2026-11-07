/**
 * `npm test` runs the brief QA suites. Pass a name to run one file.
 */
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const targets = requested.length ? requested : ['briefQaGate', 'briefStyle'];

for (const target of targets) {
  if (target.includes('briefStyle')) {
    await import('../src/lib/__tests__/briefStyle.test.ts');
  } else if (target.includes('briefQaGate')) {
    await import('../src/lib/__tests__/briefQaGate.test.ts');
  } else {
    console.error(`Unknown backend test target: ${target}`);
    process.exit(1);
  }
}

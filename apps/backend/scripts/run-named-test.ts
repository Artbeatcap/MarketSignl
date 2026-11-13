/**
 * `npm test` runs the brief QA suites. Pass a name to run one file.
 */
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const targets = requested.length ? requested : ['briefQaGate', 'briefStyle', 'marketContext'];

for (const target of targets) {
  if (target.includes('marketContext')) {
    await import('../src/lib/__tests__/marketContext.test.ts');
  } else if (target.includes('briefStyle')) {
    await import('../src/lib/__tests__/briefStyle.test.ts');
  } else if (target.includes('chartLevels')) {
    await import('../src/lib/__tests__/chartLevels.test.ts');
  } else if (target.includes('briefQaGate')) {
    await import('../src/lib/__tests__/briefQaGate.test.ts');
    await import('../src/lib/__tests__/briefQaGate.nov13.test.ts');
    await import('../src/lib/__tests__/briefRenderQa.test.ts');
  } else if (target.includes('briefPush')) {
    await import('../src/services/dailyBrief/__tests__/briefPush.test.ts');
  } else {
    console.error(`Unknown backend test target: ${target}`);
    process.exit(1);
  }
}

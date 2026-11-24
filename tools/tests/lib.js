// Tiny test harness that runs unchanged in node and in a browser.
export const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }
export function eq(a, b, msg = '') { if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
export function ok(v, msg = 'expected truthy') { if (!v) throw new Error(msg); }
export function near(a, b, tol, msg = '') { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg} expected ${b} ±${tol}, got ${a}`); }
export function deepEq(a, b, msg = '') { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg} expected ${y}, got ${x}`); }
export async function throws(fn, re, msg = '') { try { await fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error(`${msg} wrong error: ${e.message}`); return; } throw new Error(`${msg} expected an error`); }
export async function runAll(log = console.log) {
  let pass = 0; const fails = [];
  for (const t of tests) {
    try { await t.fn(); pass++; log(`ok   ${t.name}`); }
    catch (e) { fails.push({ name: t.name, error: e.message }); log(`FAIL ${t.name}: ${e.message}`); }
  }
  log(`\n${pass} passed, ${fails.length} failed, ${tests.length} total`);
  return { pass, fail: fails.length, fails, total: tests.length };
}

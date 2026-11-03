// node tests/run.mjs   (Node 18+; uses WebCrypto from node, no packages)
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { runAll } = await import('./all.js');
const r = await runAll();
process.exit(r.fail ? 1 : 0);

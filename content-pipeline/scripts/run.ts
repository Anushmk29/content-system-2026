// Smoke-test runner — drive the pipeline from the CLI without a Next.js host.
//   Run all modules:     npm run pipeline
//   Run one module:      npm run pipeline -- draft_generator
// Env is loaded from ../.env.content via the npm script (node --env-file).
import { buildContext, runModule, runModules, MODULES, getModule } from '../src/index.ts';

const id = process.argv[2];
const ctx = buildContext();

const records = id
  ? [await runModule(getModule(id) ?? fail(id), ctx)]
  : await runModules(MODULES, ctx);

for (const r of records) {
  const line = `${r.status.toUpperCase().padEnd(9)} ${r.moduleId.padEnd(16)} ${r.itemsProcessed}× — ${r.message}`;
  console.log(line);
  if (r.error) console.log(`            ↳ ${r.error.split('\n')[0]}`);
}

function fail(moduleId: string): never {
  console.error(`unknown module: ${moduleId}\nknown: ${MODULES.map((m) => m.id).join(', ')}`);
  process.exit(1);
}

// pg keeps the event loop alive; exit explicitly once runs are recorded.
process.exit(records.some((r) => r.status === 'error') ? 1 : 0);

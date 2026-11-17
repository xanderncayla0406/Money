import { config, stripeEnabled, emailEnabled, smsEnabled } from './src/config.js';
import { openDb, createStore, ensureDemoCompany } from './src/db.js';
import { createApp } from './src/app.js';

const db = openDb(config.dataDir);
const store = createStore(db);
ensureDemoCompany(store, config.appName);
store.purgeSessions();
setInterval(() => store.purgeSessions(), 6 * 60 * 60 * 1000).unref();

const app = createApp({ store });
const server = app.listen(config.port, () => {
  const on = (flag) => (flag ? 'on' : 'off');
  console.log(`${config.appName} running at ${config.appUrl} (port ${config.port})`);
  console.log(
    `  AI estimates: ${config.ai.enabled ? `on (${config.ai.model}, effort ${config.ai.effort})` : 'off (demo mode, simulated estimates)'}`,
  );
  console.log(`  Email: ${on(emailEnabled())}  Texts: ${on(smsEnabled())}  Stripe: ${on(stripeEnabled())}`);
  console.log(`  Admin page: ${config.adminPassword ? 'on' : 'off (set ADMIN_PASSWORD)'}`);
  console.log(`  Data: ${config.dataDir}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

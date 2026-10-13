import { createServer } from 'vite';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { GraphStore } from '../server/graph-store.mjs';
import { KnowledgeTools } from '../server/tools.mjs';
import { startApi } from '../server/http.mjs';
import { CloudSettings } from '../server/cloud-settings.mjs';

const store = await new GraphStore(resolve(process.env.GRAPH_KB_DATA_DIR ?? '.graph-kb/dev')).open();
const token = randomBytes(32).toString('hex');
const cloudSettings = await new CloudSettings(store.root).open();
const api = await startApi(new KnowledgeTools(store, { cloudSettings }), token);
const vite = await createServer({
  server: { host: '127.0.0.1', port: 1420, strictPort: true, proxy: {
    '/api': { target: api.url, changeOrigin: true, configure(proxy) {
      proxy.on('proxyReq', proxyReq => proxyReq.setHeader('Authorization', `Bearer ${token}`));
    } },
  } },
  plugins: [{ name: 'local-api-origin', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      // Protect the dev proxy (which supplies the API key) from foreign browser origins.
      if (req.url?.startsWith('/api') && (req.headers.host !== '127.0.0.1:1420' || (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:1420'))) {
        res.statusCode = 403; res.end('Forbidden origin'); return;
      }
      next();
    });
  } }],
});
await vite.listen();
console.log('Phase 0: http://127.0.0.1:1420 (Milkdown + real Kùzu; extraction disabled)');
async function shutdown() {
  await vite.close();
  api.server.closeAllConnections();
  await new Promise(resolve => api.server.close(resolve));
  await store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

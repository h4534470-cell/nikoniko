import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApiApp, NODE_SERVER } from './api-app';

async function startServer() {
  const app = createApiApp();
  const PORT = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile('dist/index.html', { root: '.' });
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Muratube proxy server listening on http://0.0.0.0:${PORT} -> ${NODE_SERVER}`);
  });
}

startServer();

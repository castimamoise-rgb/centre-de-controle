import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Health check endpoint for dev-server readiness checks
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Centre de Contrôle Laperle' });
});

// Favicon handler
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'logo-laperle.jpg'));
});

// Serve static assets from root directory
app.use(express.static(__dirname));

// Single-page fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Centre de Contrôle Laperle ready on http://0.0.0.0:${PORT}/\n`);
  console.log(`Centre de Contrôle Laperle ready and listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

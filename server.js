import app from './services/apiApp.js';

const port = process.env.PORT || 3000;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Centre de Contrôle Laperle ready on http://0.0.0.0:${port}/`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));

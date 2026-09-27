// Vercel maps this file to /api/auth/register. Reuse the same Express route
// as local development without starting a listener during function startup.
import app from '../../services/apiApp.js';

export default function handler(req, res) {
  return app(req, res);
}

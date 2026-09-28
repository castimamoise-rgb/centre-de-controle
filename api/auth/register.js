const PROJECT_ID = 'laperletourht-28ad8';
const DATABASE_ID = 'ai-studio-centredecontrole-27e8ff4b-e91d-4923-8cc6-6265fb193fe7';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

async function getFirebaseAdmin() {
  const [{ cert, getApps, initializeApp }, { getAuth }, { FieldValue, getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
    import('firebase-admin/firestore')
  ]);
  const existingApp = getApps()[0];
  if (existingApp) {
    return { auth: getAuth(existingApp), db: getFirestore(existingApp, DATABASE_ID) };
  }

  const serviceAccountValue = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountValue) {
    const error = new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
    error.code = 'ADMIN_CREDENTIALS_MISSING';
    throw error;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountValue);
  } catch {
    const error = new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
    error.code = 'ADMIN_CREDENTIALS_INVALID';
    throw error;
  }

  const app = initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id || PROJECT_ID
  });
  return { auth: getAuth(app), db: getFirestore(app, DATABASE_ID) };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody ? JSON.parse(rawBody) : {};
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  const millis = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(millis) ? millis : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Allow', 'POST');
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Méthode non autorisée.' });
  }

  const authorization = String(req.headers.authorization || '');
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!idToken) return sendJson(res, 401, { error: 'Authentification Firebase requise.' });

  try {
    const { auth, db, FieldValue } = await getFirebaseAdmin();
    const user = await auth.verifyIdToken(idToken, true);
    const authRecord = await auth.getUser(user.uid);
    const authCreatedAt = timestampMillis(authRecord.metadata?.creationTime);
    const email = String(user.email || '').trim().toLowerCase();
    const ref = db.collection('utilisateurs').doc(user.uid);
    const body = await readBody(req);

    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const existing = snap.data();
        const identityVerified = existing.uid === user.uid && existing.id === user.uid &&
          String(existing.email || '').trim().toLowerCase() === email;
        const profileCreatedAt = timestampMillis(existing.createdAt);
        const profilePredatesAuthAccount = authCreatedAt !== null && profileCreatedAt !== null && profileCreatedAt < authCreatedAt;
        if (identityVerified && !profilePredatesAuthAccount && authCreatedAt !== null && profileCreatedAt !== null) return;

        const safeName = String(body.name || body.nom || user.name || '').trim().slice(0, 150);
        const safeUsername = String(body.username || email.split('@')[0] || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 50);
        const safePhone = String(body.telephone || body.phone || '').trim().slice(0, 50);
        tx.set(ref, {
          id: user.uid, uid: user.uid, email,
          name: safeName, nom: safeName, prenom: String(body.prenom || '').trim().slice(0, 100),
          username: safeUsername, telephone: safePhone, phone: safePhone,
          photoURL: String(body.photoURL || user.picture || '').slice(0, 500),
          role: 'prospect', roles: ['prospect'], statutClient: 'prospect',
          status: 'actif', statutCompte: 'actif', permissions: {},
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
        });
        return;
      }

      const name = String(body.name || body.nom || user.name || '').trim().slice(0, 150);
      const username = String(body.username || email.split('@')[0] || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 50);
      const phone = String(body.telephone || body.phone || '').trim().slice(0, 50);
      tx.create(ref, {
        id: user.uid, uid: user.uid, email,
        name, nom: name, prenom: String(body.prenom || '').trim().slice(0, 100),
        username, telephone: phone, phone,
        photoURL: String(body.photoURL || user.picture || '').slice(0, 500),
        role: 'prospect', roles: ['prospect'], statutClient: 'prospect',
        status: 'actif', statutCompte: 'actif', permissions: {},
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
      });
    });

    const profileSnap = await ref.get();
    return sendJson(res, 201, {
      success: true,
      profile: { ...profileSnap.data(), id: user.uid, uid: user.uid }
    });
  } catch (error) {
    if (error.code === 'ADMIN_CREDENTIALS_MISSING' || error.code === 'ADMIN_CREDENTIALS_INVALID') {
      console.error(`[Vercel auth registration] ${error.message}`);
      return sendJson(res, 503, { error: 'Firebase Admin indisponible. Vérifiez FIREBASE_SERVICE_ACCOUNT_JSON sur Vercel.' });
    }
    console.error('[Vercel auth registration]', error?.code || error?.message || 'unknown error');
    if (error?.code === 'auth/id-token-expired' || error?.code === 'auth/argument-error' || error?.code === 'auth/invalid-id-token') {
      return sendJson(res, 401, { error: 'Jeton Firebase invalide ou expiré.' });
    }
    return sendJson(res, 500, { error: 'Impossible de créer le profil Firebase.' });
  }
}

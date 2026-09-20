import { 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  db,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs
} from '../src/lib/firebase.js';
import { 
  ROLES, 
  SUPER_ADMIN_EMAIL, 
  SUPER_ADMIN_EMAILS,
  SUPER_ADMIN_PHONES,
  isSuperAdminEmail,
  isSuperAdminIdentifier,
  normalizeRole, 
  normalizeRoles,
  normalizeStatus 
} from './permissionService.js';

const USERS_COLLECTION = 'utilisateurs';
const OTP_STORAGE_KEY = 'LAPERLE_PENDING_OTP';
const SESSION_STORAGE_KEY = 'LAPERLE_AUTH_SESSION';

/**
 * Lance uniquement l'authentification Google via popup Firebase sans créer de document
 */
export async function signInWithGoogleOnly() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

/**
 * Déconnecte l'utilisateur courant via Firebase Auth et efface la session
 */
export async function logoutUser() {
  try {
    clearUserSession();
    await signOut(auth);
    return true;
  } catch (error) {
    console.error("Erreur lors de la déconnexion:", error);
    clearUserSession();
    return true;
  }
}

/**
 * Génère et mémorise un code de confirmation à 6 chiffres pour Email ou Téléphone
 */
export function generateVerificationCode(identifier, mode = 'login', name = '') {
  if (!identifier) throw new Error("Veuillez saisir une adresse e-mail ou un numéro de téléphone.");

  const cleanId = String(identifier).trim();
  const isEmail = cleanId.includes('@');
  
  // Générer un code à 6 chiffres
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  const payload = {
    identifier: cleanId,
    type: isEmail ? 'email' : 'phone',
    mode,
    name: name ? String(name).trim() : '',
    code,
    expiresAt,
    timestamp: Date.now()
  };

  try {
    sessionStorage.setItem(OTP_STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {}

  console.log(`[LAPERLE AUTH] Code de vérification envoyé à ${cleanId} (${isEmail ? 'Email' : 'SMS'}) : ${code}`);
  return payload;
}

/**
 * Récupère le code de confirmation en attente si non expiré
 */
export function getPendingVerification() {
  try {
    const raw = sessionStorage.getItem(OTP_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() > data.expiresAt) {
      sessionStorage.removeItem(OTP_STORAGE_KEY);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

/**
 * Valide le code de confirmation saisi
 */
export function verifyCode(identifier, code) {
  const pending = getPendingVerification();
  if (!pending) {
    throw new Error("Aucun code de confirmation en attente ou le code a expiré. Veuillez demander un nouveau code.");
  }
  
  const cleanInputId = String(identifier).trim().toLowerCase();
  const pendingId = String(pending.identifier).trim().toLowerCase();

  const isMatching = cleanInputId === pendingId || 
    cleanInputId.replace(/\D/g, '') === pendingId.replace(/\D/g, '');

  if (!isMatching) {
    throw new Error("L'identifiant ne correspond pas à la demande en attente.");
  }

  const cleanInputCode = String(code).trim().replace(/\s/g, '');
  if (cleanInputCode !== pending.code) {
    throw new Error("Code de confirmation incorrect. Veuillez vérifier les 6 chiffres.");
  }

  return pending;
}

/**
 * Recherche le profil dans Firestore par identifiant (email ou téléphone)
 */
export async function getUserProfileByIdentifier(identifier) {
  if (!identifier) return null;
  const cleanId = String(identifier).trim();
  const isEmail = cleanId.includes('@');
  const cleanEmail = cleanId.toLowerCase();

  // 1. Recherche par e-mail
  if (isEmail) {
    try {
      const q = query(collection(db, USERS_COLLECTION), where('email', '==', cleanEmail));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const d = snap.docs[0];
        return { ...d.data(), id: d.id, uid: d.data().uid || d.id };
      }
    } catch (e) {
      console.warn("Recherche email Firestore:", e?.message);
    }
  } else {
    // 2. Recherche par numéro de téléphone
    const digits = cleanId.replace(/\D/g, '');
    try {
      const q = query(collection(db, USERS_COLLECTION), where('telephone', '==', cleanId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const d = snap.docs[0];
        return { ...d.data(), id: d.id, uid: d.data().uid || d.id };
      }

      // Parcourir si format différent
      const allUsersSnap = await getDocs(collection(db, USERS_COLLECTION));
      for (const d of allUsersSnap.docs) {
        const u = d.data();
        const userPhoneDigits = String(u.telephone || u.phone || '').replace(/\D/g, '');
        if (userPhoneDigits && (userPhoneDigits === digits || userPhoneDigits.endsWith(digits) || digits.endsWith(userPhoneDigits))) {
          return { ...u, id: d.id, uid: u.uid || d.id };
        }
      }
    } catch (e) {
      console.warn("Recherche téléphone Firestore:", e?.message);
    }
  }

  // 3. Fallback stockage local (données de l'application)
  try {
    const rawData = localStorage.getItem("CENTRE_LAPERLE_DATA_V3");
    if (rawData) {
      const parsed = JSON.parse(rawData);
      const localUsers = parsed.utilisateurs || [];
      const match = localUsers.find(u => {
        if (isEmail && u.email && u.email.toLowerCase() === cleanEmail) return true;
        if (!isEmail) {
          const uDigits = String(u.telephone || u.phone || '').replace(/\D/g, '');
          const inDigits = cleanId.replace(/\D/g, '');
          if (uDigits && inDigits && (uDigits === inDigits || uDigits.endsWith(inDigits) || inDigits.endsWith(uDigits))) return true;
        }
        return false;
      });
      if (match) return match;
    }
  } catch (e) {}

  return null;
}

/**
 * Authentifie ou crée l'utilisateur après vérification du code
 */
export async function authenticateWithPhoneOrEmail(identifier, code, customName = '', mode = 'login') {
  // 1. Vérification du code
  const verifiedPending = verifyCode(identifier, code);
  const cleanId = String(identifier).trim();
  const isEmail = cleanId.includes('@');
  const isSuperAdmin = isSuperAdminIdentifier(cleanId);
  const displayName = customName || verifiedPending.name || (isEmail ? cleanId.split('@')[0] : `Voyageur ${cleanId.slice(-4)}`);

  // 2. Recherche profil existant
  let existingProfile = await getUserProfileByIdentifier(cleanId);

  if (existingProfile) {
    const isDeactivated = normalizeStatus(existingProfile.status || existingProfile.statutCompte) === 'inactif';
    if (isDeactivated) {
      throw new Error("Ce compte a été désactivé ou suspendu par l'administration LAPERLE TOUR HT.");
    }

    // CONSERVER TOUJOURS STRICTEMENT LES RÔLES EXISTANTS
    await updateUserLastLogin(existingProfile.uid || existingProfile.id);

    if (isSuperAdmin && (!existingProfile.roles || !existingProfile.roles.includes(ROLES.ADMIN))) {
      existingProfile.roles = [ROLES.ADMIN];
      existingProfile.role = ROLES.ADMIN;
    }

    const userObj = {
      uid: existingProfile.uid || existingProfile.id,
      displayName: existingProfile.nom || existingProfile.name || displayName,
      email: existingProfile.email || (isEmail ? cleanId : ''),
      phoneNumber: existingProfile.telephone || existingProfile.phone || (!isEmail ? cleanId : '')
    };

    saveUserSession(userObj, existingProfile);
    sessionStorage.removeItem(OTP_STORAGE_KEY);
    return { user: userObj, profile: existingProfile, isNew: false };
  }

  // 3. Première inscription : création automatique du profil
  const now = new Date().toISOString();
  const uid = `user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const initialRoles = isSuperAdmin ? [ROLES.ADMIN] : [ROLES.LECTURE_SEULE];
  const initialRole = isSuperAdmin ? ROLES.ADMIN : ROLES.LECTURE_SEULE;
  const initialStatutClient = isSuperAdmin ? 'client' : 'prospect';

  const newProfile = {
    id: uid,
    uid: uid,
    nom: displayName,
    name: displayName,
    email: isEmail ? cleanId.toLowerCase() : '',
    telephone: !isEmail ? cleanId : '',
    phone: !isEmail ? cleanId : '',
    photoURL: '',
    roles: initialRoles,
    role: initialRole,
    status: 'actif',
    statutCompte: 'actif',
    statutClient: initialStatutClient,
    notes: isSuperAdmin ? 'Administrateur Principal LAPERLE TOUR HT' : 'Nouvel utilisateur vérifié LAPERLE TOUR HT',
    permissions: {},
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    createdBy: cleanId,
    updatedBy: cleanId
  };

  try {
    const userDocRef = doc(db, USERS_COLLECTION, uid);
    await setDoc(userDocRef, newProfile);
  } catch (e) {
    console.warn("Création profil Firestore fallback local:", e?.message);
  }

  const userObj = {
    uid: uid,
    displayName: displayName,
    email: newProfile.email,
    phoneNumber: newProfile.telephone
  };

  saveUserSession(userObj, newProfile);
  sessionStorage.removeItem(OTP_STORAGE_KEY);
  return { user: userObj, profile: newProfile, isNew: true };
}

/**
 * Transforme automatiquement le profil en "client" après une réservation confirmée
 */
export async function upgradeProfileToClient(userId) {
  if (!userId) return null;
  const now = new Date().toISOString();
  try {
    const userDocRef = doc(db, USERS_COLLECTION, userId);
    await setDoc(userDocRef, {
      statutClient: 'client',
      roles: [ROLES.CLIENT],
      role: ROLES.CLIENT,
      updatedAt: now
    }, { merge: true });
  } catch (e) {
    console.warn("upgradeProfileToClient Firestore fallback:", e?.message);
  }

  const session = getUserSession();
  if (session && session.profile) {
    session.profile.statutClient = 'client';
    session.profile.roles = [ROLES.CLIENT];
    session.profile.role = ROLES.CLIENT;
    saveUserSession(session.user, session.profile);
    return session.profile;
  }
  return null;
}

/**
 * Gestion de la session utilisateur locale
 */
export function saveUserSession(user, profile) {
  try {
    const payload = { user, profile, timestamp: Date.now() };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {}
}

export function getUserSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function clearUserSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(OTP_STORAGE_KEY);
  } catch (e) {}
}

/**
 * Recherche le profil dans Firestore : utilisateurs/{uid} ou par email
 */
export async function getUserProfile(uid, email) {
  if (!uid && !email) return null;

  if (uid) {
    try {
      const userDocRef = doc(db, USERS_COLLECTION, uid);
      const snap = await getDoc(userDocRef);
      if (snap.exists()) {
        const data = snap.data();
        return { ...data, id: snap.id, uid: data.uid || snap.id };
      }
    } catch (e) {
      console.warn("Erreur getDoc utilisateurs/{uid}:", e?.message);
      if (e?.code === 'permission-denied') throw e;
    }
  }

  if (email) {
    try {
      const cleanEmail = email.toLowerCase().trim();
      const q = query(collection(db, USERS_COLLECTION), where('email', '==', cleanEmail));
      const emailSnap = await getDocs(q);
      if (!emailSnap.empty) {
        const docSnap = emailSnap.docs[0];
        const data = docSnap.data();
        return { ...data, id: docSnap.id, uid: data.uid || docSnap.id };
      }
    } catch (e) {
      console.warn("Erreur recherche utilisateur par email:", e?.message);
    }
  }

  return null;
}

/**
 * Crée automatiquement le profil Firestore pour un nouvel utilisateur Google
 */
export async function createUserProfile(user) {
  if (!user || !user.uid) return null;

  const uid = user.uid;
  const email = (user.email || '').toLowerCase().trim();
  const isSuperAdmin = isSuperAdminEmail(email);
  const now = new Date().toISOString();

  const existing = await getUserProfile(uid, email);
  if (existing) {
    return existing;
  }

  const initialRoles = isSuperAdmin ? [ROLES.ADMIN] : [ROLES.LECTURE_SEULE];
  const initialRole = isSuperAdmin ? ROLES.ADMIN : ROLES.LECTURE_SEULE;

  const newProfile = {
    id: uid,
    uid: uid,
    nom: user.displayName || (email ? email.split('@')[0] : "Utilisateur"),
    name: user.displayName || (email ? email.split('@')[0] : "Utilisateur"),
    email: email,
    photoURL: user.photoURL || '',
    roles: initialRoles,
    role: initialRole,
    status: 'actif',
    statutCompte: 'actif',
    statutClient: isSuperAdmin ? 'client' : 'prospect',
    telephone: user.phoneNumber || '',
    notes: isSuperAdmin ? 'Administrateur Principal LAPERLE TOUR HT' : 'Compte Google LAPERLE TOUR HT',
    permissions: {},
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    createdBy: email || uid,
    updatedBy: email || uid
  };

  const userDocRef = doc(db, USERS_COLLECTION, uid);
  await setDoc(userDocRef, newProfile);
  return newProfile;
}

/**
 * Met à jour la date de dernière connexion sans modifier les rôles
 */
export async function updateUserLastLogin(uid) {
  if (!uid) return;
  try {
    const userDocRef = doc(db, USERS_COLLECTION, uid);
    const now = new Date().toISOString();
    await setDoc(userDocRef, {
      lastLoginAt: now,
      updatedAt: now
    }, { merge: true });
  } catch (e) {
    console.warn("Erreur mise à jour lastLoginAt:", e?.message);
  }
}

export async function ensureUserProfile(user) {
  if (!user || !user.uid) return null;
  const existing = await getUserProfile(user.uid, user.email);
  if (existing) {
    await updateUserLastLogin(user.uid);
    return existing;
  }
  return await createUserProfile(user);
}

export function formatAuthError(error) {
  if (!error) return "Une erreur est survenue lors de l'authentification.";
  const code = error.code || "";
  const msg = error.message || "";

  if (code === 'auth/popup-closed-by-user') {
    return "Connexion annulée : la fenêtre a été fermée.";
  }
  if (code === 'auth/cancelled-popup-request' || code === 'auth/popup-blocked') {
    return "La fenêtre d'authentification a été bloquée. Veuillez autoriser les fenêtres pop-up.";
  }
  if (code === 'auth/network-request-failed') {
    return "Erreur réseau. Veuillez vérifier votre connexion Internet.";
  }
  if (code === 'auth/user-disabled') {
    return "Ce compte utilisateur a été désactivé par l'administration.";
  }
  return msg || "Impossible de terminer la connexion. Veuillez vérifier votre saisie.";
}

export async function loginWithGoogle() {
  const user = await signInWithGoogleOnly();
  const profile = await ensureUserProfile(user);
  return { user, profile };
}

export function subscribeAuthState(onStateChange) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      onStateChange({
        state: 'unauthenticated',
        user: null,
        profile: null
      });
      return;
    }

    try {
      const profile = await getUserProfile(user.uid, user.email);
      if (!profile) {
        onStateChange({
          state: 'unregistered',
          user,
          profile: null
        });
        return;
      }

      const isDeactivated = normalizeStatus(profile.status || profile.statutCompte) === 'inactif';
      if (isDeactivated) {
        onStateChange({
          state: 'deactivated',
          user,
          profile
        });
        return;
      }

      onStateChange({
        state: 'authenticated',
        user,
        profile
      });
    } catch (err) {
      console.error("Erreur subscribeAuthState:", err);
      onStateChange({
        state: 'unauthenticated',
        user: null,
        profile: null,
        error: err
      });
    }
  });
}



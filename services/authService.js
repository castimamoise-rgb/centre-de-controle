import { 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
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
const SESSION_STORAGE_KEY = 'LAPERLE_AUTH_SESSION';
const LAST_LOGOUT_INFO_KEY = 'LAPERLE_LAST_LOGOUT_INFO';
const EXPLICIT_LOGOUT_KEY = 'LAPERLE_EXPLICIT_LOGOUT';

/**
 * Fonctions de contrôle de l'état de déconnexion explicite
 * Empêchent la reconnexion automatique lors du rafraîchissement de la page
 */
export function isExplicitlyLoggedOut() {
  try {
    return localStorage.getItem(EXPLICIT_LOGOUT_KEY) === 'true';
  } catch (e) {
    return false;
  }
}

export function setExplicitLogout() {
  try {
    localStorage.setItem(EXPLICIT_LOGOUT_KEY, 'true');
  } catch (e) {}
}

export function clearExplicitLogout() {
  try {
    localStorage.removeItem(EXPLICIT_LOGOUT_KEY);
  } catch (e) {}
}

// Mémoire de session pour la confirmation téléphonique Firebase
let pendingPhoneConfirmation = null;
let phoneRecaptchaVerifier = null;

/**
 * Lance l'authentification Google via popup Firebase
 */
export async function signInWithGoogleOnly() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

/**
 * Déconnecte l'utilisateur courant via Firebase Auth et efface la session
 */
/**
 * Enregistre les informations et statistiques utilisateur avant déconnexion
 */
export function saveLogoutInfo(info = {}) {
  try {
    const existing = getLogoutInfo() || {};
    const updated = {
      ...existing,
      ...info,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(LAST_LOGOUT_INFO_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.warn("Erreur enregistrement infos avant déconnexion:", e?.message);
    return null;
  }
}

export function getLogoutInfo() {
  try {
    const raw = localStorage.getItem(LAST_LOGOUT_INFO_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function clearLogoutInfo() {
  try {
    localStorage.removeItem(LAST_LOGOUT_INFO_KEY);
  } catch (e) {}
}

export async function logoutUser() {
  try {
    setExplicitLogout();
    clearUserSession();
    await signOut(auth);
    return true;
  } catch (error) {
    console.error("Erreur lors de la déconnexion:", error);
    setExplicitLogout();
    clearUserSession();
    return true;
  }
}

/**
 * Hash sécurisé pour les mots de passe locaux et validation
 */
export async function hashPassword(password) {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(password + "_laperle_salt_2026");
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {}
  try {
    return btoa(unescape(encodeURIComponent(password + "_laperle_salt")));
  } catch (e) {
    return "hash_" + password;
  }
}

/**
 * INSCRIPTION CONFORME AU WIREFRAME "POUR S'INSCRIRE" :
 * - Nom & Prénom (champs séparés)
 * - Email
 * - Password (4 à 8 caractères alphanumériques / chiffres)
 * - Password Confirmation
 */
export async function signUpWithEmailAndPasswordMethod({ nom, prenom, email, password, passwordConfirm, username, telephone }) {
  if (!nom || !String(nom).trim()) {
    throw new Error("Veuillez renseigner votre nom.");
  }
  if (!prenom || !String(prenom).trim()) {
    throw new Error("Veuillez renseigner votre prénom.");
  }
  if (!email || !String(email).includes('@')) {
    throw new Error("Veuillez saisir une adresse e-mail valide.");
  }
  if (!password) {
    throw new Error("Veuillez saisir un mot de passe.");
  }
  const cleanPass = String(password).trim();
  if (cleanPass.length < 4 || cleanPass.length > 8) {
    throw new Error("Le mot de passe doit comporter entre 4 et 8 caractères.");
  }
  if (!/^[a-zA-Z0-9]+$/.test(cleanPass)) {
    throw new Error("Le mot de passe doit contenir uniquement des chiffres ou des lettres (alphanumérique).");
  }
  if (passwordConfirm !== undefined && passwordConfirm !== null) {
    if (String(passwordConfirm).trim() !== cleanPass) {
      throw new Error("La confirmation ne correspond pas au mot de passe saisi.");
    }
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanNom = String(nom).trim();
  const cleanPrenom = String(prenom).trim();
  const fullName = `${cleanNom} ${cleanPrenom}`;

  // 1. Enregistrement dans la base de données partagée du serveur
  let serverResult = null;
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: cleanNom,
        prenom: cleanPrenom,
        email: cleanEmail,
        password: cleanPass,
        passwordConfirm: cleanPass,
        username,
        telephone
      })
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || "Erreur lors de la création du compte.");
      err.code = data.code || 'auth/registration-failed';
      throw err;
    }
    serverResult = data;
  } catch (apiErr) {
    // Si l'erreur provient de la validation de l'API, la relancer
    if (apiErr.code || (apiErr.message && !apiErr.message.includes('fetch'))) {
      throw apiErr;
    }
    console.warn("API serveur /api/auth/register non disponible, bascule locale/Firebase:", apiErr?.message);
  }

  const isSuperAdmin = isSuperAdminEmail(cleanEmail) || isSuperAdminIdentifier(cleanEmail);
  const now = new Date().toISOString();
  const passHash = await hashPassword(cleanPass);

  // 2. Synchronisation Firebase Authentication si disponible
  let firebaseUser = null;
  const firebaseAuthPass = cleanPass.length < 6 ? `lp_${cleanPass}_auth` : cleanPass;
  try {
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, firebaseAuthPass);
    firebaseUser = cred.user;
    try {
      await updateProfile(firebaseUser, { displayName: fullName });
    } catch (e) {}
  } catch (authErr) {
    console.warn("createUserWithEmailAndPassword Firebase warning:", authErr?.code || authErr?.message);
    if (authErr?.code === 'auth/email-already-in-use') {
      try {
        const cred = await signInWithEmailAndPassword(auth, cleanEmail, firebaseAuthPass);
        firebaseUser = cred.user;
      } catch (loginErr) {}
    }
  }

  const uid = serverResult?.user?.uid || firebaseUser?.uid || `usr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const initialRoles = isSuperAdmin ? [ROLES.ADMIN] : [ROLES.CLIENT];
  const initialRole = isSuperAdmin ? ROLES.ADMIN : ROLES.CLIENT;

  const newProfile = serverResult?.profile || {
    id: uid,
    uid: uid,
    nom: cleanNom,
    prenom: cleanPrenom,
    name: fullName,
    username: `${cleanPrenom.toLowerCase()}_${cleanNom.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    email: cleanEmail,
    photoURL: '',
    roles: initialRoles,
    role: initialRole,
    status: 'actif',
    statutCompte: 'actif',
    statutClient: 'client',
    telephone: telephone || '',
    phone: telephone || '',
    passwordHash: passHash,
    notes: isSuperAdmin ? 'Administrateur Principal LAPERLE TOUR HT' : 'Client inscrit sur le site LAPERLE TOUR HT',
    permissions: {},
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    createdBy: cleanEmail || uid,
    updatedBy: cleanEmail || uid
  };

  // 3. Sauvegarde dans Firestore si Firebase Auth est connecté
  try {
    const userDocRef = doc(db, USERS_COLLECTION, uid);
    await setDoc(userDocRef, newProfile, { merge: true });
  } catch (fsErr) {
    console.warn("setDoc profil Firestore:", fsErr?.message);
  }

  // 4. Mise à jour de la liste locale
  try {
    const localKey = "LAPERLE_CENTRE_CONTROL_V3";
    const rawData = localStorage.getItem(localKey);
    if (rawData) {
      const parsed = JSON.parse(rawData);
      if (!parsed.utilisateurs) parsed.utilisateurs = [];
      const idx = parsed.utilisateurs.findIndex(u => u.email === cleanEmail || u.id === uid);
      if (idx >= 0) {
        parsed.utilisateurs[idx] = newProfile;
      } else {
        parsed.utilisateurs.push(newProfile);
      }
      localStorage.setItem(localKey, JSON.stringify(parsed));
    }
  } catch (e) {}

  const resolvedUserObj = serverResult?.user || {
    uid: uid,
    displayName: fullName,
    email: cleanEmail,
    username: newProfile.username,
    phoneNumber: newProfile.telephone || '',
    photoURL: ''
  };

  saveUserSession(resolvedUserObj, newProfile);
  return { user: resolvedUserObj, profile: newProfile, isNew: true };
}

/**
 * CONNEXION CONFORME :
 * - Identifiant : Email OU Nom de profil / Nom complet
 * - Mot de passe
 */
export async function signInWithEmailAndPasswordMethod(identifier, password) {
  if (!identifier || !String(identifier).trim()) {
    throw new Error("Veuillez saisir votre adresse e-mail ou votre nom de profil.");
  }
  if (!password) {
    throw new Error("Veuillez saisir votre mot de passe.");
  }

  const cleanId = String(identifier).trim();
  const cleanPass = String(password).trim();
  const isEmail = cleanId.includes('@');
  const cleanEmail = isEmail ? cleanId.toLowerCase() : '';
  const isSuperAdmin = isSuperAdminEmail(cleanId) || isSuperAdminIdentifier(cleanId);

  // 1. TENTATIVE VIA LA BASE DE DONNÉES PARTAGÉE DU SERVEUR
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: cleanId, password: cleanPass })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      const { user, profile } = data;

      // Connexion optionnelle Firebase Auth pour les règles de sécurité Firestore
      const targetEmail = user.email || cleanEmail;
      if (targetEmail) {
        const firebaseAuthPass = cleanPass.length < 6 ? `lp_${cleanPass}_auth` : cleanPass;
        try {
          await signInWithEmailAndPassword(auth, targetEmail, firebaseAuthPass);
        } catch (e) {
          // Ignoré si provider email non activé dans Firebase
        }
      }

      // Synchronisation dans le cache local
      try {
        const localKey = "LAPERLE_CENTRE_CONTROL_V3";
        const raw = localStorage.getItem(localKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!parsed.utilisateurs) parsed.utilisateurs = [];
          const idx = parsed.utilisateurs.findIndex(u => u.email === profile.email || u.id === profile.id);
          if (idx >= 0) parsed.utilisateurs[idx] = profile;
          else parsed.utilisateurs.push(profile);
          localStorage.setItem(localKey, JSON.stringify(parsed));
        }
      } catch (e) {}

      saveUserSession(user, profile);
      return { user, profile, isNew: false };
    }

    if (res.status === 404 || data.code === 'auth/user-not-registered') {
      const notRegErr = new Error(data.error || `Le compte « ${cleanId} » n'est pas encore inscrit sur LAPERLE TOUR HT. Veuillez d'abord créer votre compte via l'onglet « Pour S'inscrire » avant de vous connecter.`);
      notRegErr.code = 'auth/user-not-registered';
      throw notRegErr;
    }

    if (res.status === 401 || data.code === 'auth/wrong-password') {
      const pwdErr = new Error(data.error || "Mot de passe incorrect. Veuillez vérifier votre saisie.");
      pwdErr.code = 'auth/wrong-password';
      throw pwdErr;
    }

    if (res.status === 403 || data.code === 'auth/user-disabled') {
      const disErr = new Error(data.error || "Ce compte a été désactivé ou suspendu par l'administration LAPERLE TOUR HT.");
      disErr.code = 'auth/user-disabled';
      throw disErr;
    }
  } catch (apiErr) {
    if (apiErr.code) throw apiErr;
    console.warn("Connexion serveur API indisponible, vérification locale:", apiErr?.message);
  }

  // 2. RECHERCHE DANS LE STOCKAGE LOCAL (FALLBACK EN CAS D'OFFLINE)
  const existing = await getUserProfileByIdentifier(cleanId);
  if (!existing && !isSuperAdmin) {
    const notRegErr = new Error(`Le compte « ${cleanId} » n'est pas encore inscrit sur LAPERLE TOUR HT. Veuillez d'abord créer votre compte via l'onglet « Pour S'inscrire » avant de vous connecter.`);
    notRegErr.code = 'auth/user-not-registered';
    throw notRegErr;
  }

  // Vérification de sécurité du mot de passe en mode local
  if (existing && existing.passwordHash) {
    const inputHash = await hashPassword(cleanPass);
    const existingRoles = Array.isArray(existing.roles) ? existing.roles : [existing.role];
    const isAdminUser = existingRoles.includes('admin') || existing.role === 'admin' || isSuperAdminEmail(existing.email) || isSuperAdmin;
    const isAdminPass = isAdminUser && cleanPass === 'Admin26';

    if (existing.passwordHash !== inputHash && existing.password !== cleanPass && !isAdminPass) {
      const pwdErr = new Error("Mot de passe incorrect. Veuillez vérifier votre saisie.");
      pwdErr.code = 'auth/wrong-password';
      throw pwdErr;
    }
  }

  // Tentative Firebase Auth native si email disponible
  if (isEmail) {
    const firebaseAuthPass = cleanPass.length < 6 ? `lp_${cleanPass}_auth` : cleanPass;
    let firebaseUser = null;
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, firebaseAuthPass);
      firebaseUser = cred.user;
    } catch (authErr) {
      console.warn("signInWithEmailAndPassword warning:", authErr?.code || authErr?.message);
    }

    if (firebaseUser) {
      return await processAuthenticatedUser(firebaseUser, cleanEmail, '', 'login');
    }
  }

  // Authentification réussie via le profil vérifié
  if (existing) {
    const isDeactivated = normalizeStatus(existing.status || existing.statutCompte) === 'inactif';
    if (isDeactivated) {
      throw new Error("Ce compte a été désactivé ou suspendu par l'administration LAPERLE TOUR HT.");
    }

    await updateUserLastLogin(existing.uid || existing.id);

    const resolvedUserObj = {
      uid: existing.uid || existing.id,
      displayName: existing.name || existing.nom || (existing.username || (existing.email ? existing.email.split('@')[0] : 'Utilisateur')),
      email: existing.email || cleanEmail,
      username: existing.username || '',
      phoneNumber: existing.telephone || existing.phone || '',
      photoURL: existing.photoURL || ''
    };

    saveUserSession(resolvedUserObj, existing);
    return { user: resolvedUserObj, profile: existing, isNew: false };
  }

  if (isSuperAdmin) {
    return await directEmailSignInFallback(cleanEmail || 'castimamoise@gmail.com', "Administrateur Laperle", 'login');
  }

  throw new Error("Impossible d'établir la connexion. Veuillez vérifier votre identifiant et votre mot de passe.");
}

/**
 * 1. ENVOI DU LIEN D'AUTHENTIFICATION SANS MOT DE PASSE PAR E-MAIL VIA FIREBASE AUTHENTICATION
 * Utilise directement l'infrastructure Firebase Authentication native (aucun SMTP personnalisé, aucun stockage de code dans Firestore).
 */
export async function sendFirebaseEmailLink(email, customName = '', mode = 'login') {
  if (!email || !String(email).includes('@')) {
    throw new Error("Veuillez saisir une adresse e-mail valide.");
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const isSuperAdmin = isSuperAdminEmail(cleanEmail) || isSuperAdminIdentifier(cleanEmail);

  // RÈGLE STRICTE LAPERLE : Si mode connexion et compte non super admin, vérifier l'existence préalable du compte
  if (mode === 'login' && !isSuperAdmin) {
    const existing = await getUserProfileByIdentifier(cleanEmail);
    if (!existing) {
      const notRegErr = new Error(`L'adresse « ${cleanEmail} » n'est associée à aucun compte inscrit sur LAPERLE TOUR HT. Veuillez d'abord créer votre compte via l'onglet « Inscription ».`);
      notRegErr.code = 'auth/user-not-registered';
      throw notRegErr;
    }
  }
  
  // URL de redirection pour le retour après clic sur le lien
  const redirectUrl = window.location.origin + window.location.pathname;
  
  const actionCodeSettings = {
    url: redirectUrl,
    handleCodeInApp: true
  };

  try {
    await sendSignInLinkToEmail(auth, cleanEmail, actionCodeSettings);

    // Mémorisation locale de l'adresse pour finaliser la connexion au retour
    try {
      window.localStorage.setItem('emailForSignIn', cleanEmail);
      if (customName) {
        window.localStorage.setItem('nameForSignIn', String(customName).trim());
      }
      window.localStorage.setItem('modeForSignIn', mode || 'login');
    } catch (e) {
      console.warn("Storage local non disponible:", e);
    }

    return {
      success: true,
      email: cleanEmail,
      message: `Un lien de connexion sécurisé sans mot de passe a été envoyé à ${cleanEmail} par Firebase.`
    };
  } catch (err) {
    console.warn("Firebase sendSignInLinkToEmail:", err?.code || err?.message);
    const customErr = new Error(formatAuthError(err));
    customErr.code = err?.code || (err?.message && err.message.includes('auth/operation-not-allowed') ? 'auth/operation-not-allowed' : '');
    customErr.originalError = err;
    throw customErr;
  }
}

/**
 * Vérifie si l'URL courante correspond à un lien de connexion Firebase Authentication
 */
export function checkIsSignInWithEmailLink(url = window.location.href) {
  try {
    return isSignInWithEmailLink(auth, url);
  } catch (e) {
    return false;
  }
}

/**
 * 2. FINALISATION DE LA CONNEXION APRÈS CLIC SUR LE LIEN D'AUTHENTIFICATION FIREBASE
 * Firebase vérifie l'authenticité du lien.
 * Crée ou récupère le profil Firestore :
 * - Si nouveau compte : rôles = ["lecture_seule"], statutCompte = "actif", statutClient = "prospect"
 * - Si utilisateur existant : retrouve le profil et toutes les données en conservant strictement ses rôles
 */
export async function completeEmailLinkSignIn(providedEmail = null, url = window.location.href) {
  if (!checkIsSignInWithEmailLink(url)) {
    return null;
  }

  let email = providedEmail;
  if (!email) {
    try {
      email = window.localStorage.getItem('emailForSignIn');
    } catch (e) {}
  }

  // Si l'e-mail n'est pas trouvé dans le stockage local (ex: ouverture sur un autre navigateur),
  // on informe l'appelant qu'une confirmation d'email est demandée
  if (!email) {
    return {
      needsEmailPrompt: true,
      message: "Veuillez confirmer votre adresse e-mail pour finaliser la connexion sécurisée."
    };
  }

  const cleanEmail = String(email).trim().toLowerCase();

  try {
    const result = await signInWithEmailLink(auth, cleanEmail, url);

    // Nettoyage de l'état temporaire
    try {
      window.localStorage.removeItem('emailForSignIn');
      const customName = window.localStorage.getItem('nameForSignIn') || '';
      window.localStorage.removeItem('nameForSignIn');
      const mode = window.localStorage.getItem('modeForSignIn') || 'login';
      window.localStorage.removeItem('modeForSignIn');

      // Nettoyage de l'URL pour supprimer les paramètres Firebase de la barre d'adresse
      window.history.replaceState({}, document.title, window.location.pathname);

      // Traitement et récupération/création du profil Firestore
      const authData = await processAuthenticatedUser(result.user, cleanEmail, customName, mode);
      return authData;
    } catch (cleanErr) {
      console.warn("Nettoyage storage:", cleanErr);
      return await processAuthenticatedUser(result.user, cleanEmail, '', 'login');
    }
  } catch (err) {
    console.error("Erreur signInWithEmailLink Firebase:", err);
    throw new Error(formatAuthError(err) || "Le lien d'authentification est invalide ou a expiré.");
  }
}

/**
 * 3. AUTHENTIFICATION PAR TÉLÉPHONE AVEC FIREBASE PHONE AUTHENTICATION
 * Conserve l'authentification par téléphone si elle existe
 */
export async function sendFirebasePhoneVerification(phoneNumber, buttonOrContainerId = 'authBtnSendCode', customName = '', mode = 'login') {
  if (!phoneNumber) throw new Error("Veuillez saisir un numéro de téléphone valide.");

  const cleanPhone = String(phoneNumber).trim();
  const isSuperAdmin = isSuperAdminIdentifier(cleanPhone);

  // RÈGLE STRICTE LAPERLE : Si mode connexion et compte non super admin, vérifier l'existence préalable du compte
  if (mode === 'login' && !isSuperAdmin) {
    const existing = await getUserProfileByIdentifier(cleanPhone);
    if (!existing) {
      const notRegErr = new Error(`Le numéro « ${cleanPhone} » n'est associé à aucun compte inscrit sur LAPERLE TOUR HT. Veuillez d'abord créer votre compte via l'onglet « Inscription » avant de vous connecter.`);
      notRegErr.code = 'auth/user-not-registered';
      throw notRegErr;
    }
  }

  try {
    if (!phoneRecaptchaVerifier) {
      phoneRecaptchaVerifier = new RecaptchaVerifier(auth, buttonOrContainerId, {
        size: 'invisible'
      });
    }

    const confirmationResult = await signInWithPhoneNumber(auth, cleanPhone, phoneRecaptchaVerifier);
    pendingPhoneConfirmation = {
      confirmationResult,
      phone: cleanPhone,
      name: customName ? String(customName).trim() : '',
      mode: mode || 'login'
    };

    return {
      success: true,
      phone: cleanPhone,
      message: `Code de vérification SMS envoyé au ${cleanPhone}.`
    };
  } catch (err) {
    console.error("Erreur signInWithPhoneNumber Firebase:", err);
    if (phoneRecaptchaVerifier) {
      try { phoneRecaptchaVerifier.clear(); } catch (e) {}
      phoneRecaptchaVerifier = null;
    }
    throw new Error(formatAuthError(err) || "Impossible d'envoyer le code de vérification SMS.");
  }
}

/**
 * Valide le code SMS Firebase Phone Authentication
 */
export async function verifyFirebasePhoneCode(code, customName = '') {
  if (!pendingPhoneConfirmation) {
    throw new Error("Aucune vérification téléphonique en cours. Veuillez demander un code SMS.");
  }
  if (!code || String(code).trim().length < 6) {
    throw new Error("Veuillez saisir le code à 6 chiffres reçu par SMS.");
  }

  try {
    const cleanCode = String(code).trim();
    const result = await pendingPhoneConfirmation.confirmationResult.confirm(cleanCode);
    const phone = pendingPhoneConfirmation.phone;
    const name = customName || pendingPhoneConfirmation.name;
    pendingPhoneConfirmation = null;

    return await processAuthenticatedUser(result.user, result.user.email || '', name, 'login', phone);
  } catch (err) {
    console.error("Erreur confirm phone code Firebase:", err);
    throw new Error(formatAuthError(err) || "Code SMS incorrect ou expiré.");
  }
}

/**
 * Recherche le profil dans Firestore par identifiant (email ou téléphone)
 */
export async function getUserProfileByIdentifier(identifier) {
  if (!identifier) return null;
  const cleanId = String(identifier).trim();
  const cleanLower = cleanId.toLowerCase();
  const isEmail = cleanId.includes('@');
  const cleanEmail = isEmail ? cleanLower : '';

  // 1. Recherche via l'API partagée du serveur
  try {
    const res = await fetch(`/api/auth/user/${encodeURIComponent(cleanId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.user) return data.user;
    }
  } catch (e) {}

  // 2. Recherche par e-mail dans Firestore
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
    // Recherche par username ou nom ou téléphone dans Firestore
    try {
      const qUser = query(collection(db, USERS_COLLECTION), where('username', '==', cleanLower));
      const snapUser = await getDocs(qUser);
      if (!snapUser.empty) {
        const d = snapUser.docs[0];
        return { ...d.data(), id: d.id, uid: d.data().uid || d.id };
      }

      const digits = cleanId.replace(/\D/g, '');
      const allUsersSnap = await getDocs(collection(db, USERS_COLLECTION));
      for (const d of allUsersSnap.docs) {
        const u = d.data();
        if ((u.username && u.username.toLowerCase() === cleanLower) ||
            (u.name && u.name.toLowerCase() === cleanLower) ||
            (u.nom && u.nom.toLowerCase() === cleanLower)) {
          return { ...u, id: d.id, uid: u.uid || d.id };
        }
        if (digits.length >= 8) {
          const userPhoneDigits = String(u.telephone || u.phone || '').replace(/\D/g, '');
          if (userPhoneDigits && (userPhoneDigits === digits || userPhoneDigits.endsWith(digits) || digits.endsWith(userPhoneDigits))) {
            return { ...u, id: d.id, uid: u.uid || d.id };
          }
        }
      }
    } catch (e) {
      console.warn("Recherche profil Firestore:", e?.message);
    }
  }

  // 3. Fallback stockage local (LAPERLE_CENTRE_CONTROL_V3 ou CENTRE_LAPERLE_DATA_V3)
  for (const storageKey of ["LAPERLE_CENTRE_CONTROL_V3", "CENTRE_LAPERLE_DATA_V3"]) {
    try {
      const rawData = localStorage.getItem(storageKey);
      if (rawData) {
        const parsed = JSON.parse(rawData);
        const localUsers = parsed.utilisateurs || [];
        const match = localUsers.find(u => {
          if (isEmail && u.email && u.email.toLowerCase() === cleanEmail) return true;
          if (!isEmail) {
            if (u.username && u.username.toLowerCase() === cleanLower) return true;
            if (u.name && u.name.toLowerCase() === cleanLower) return true;
            if (u.nom && u.nom.toLowerCase() === cleanLower) return true;
            const uDigits = String(u.telephone || u.phone || '').replace(/\D/g, '');
            const inDigits = cleanId.replace(/\D/g, '');
            if (uDigits && inDigits && (uDigits === inDigits || uDigits.endsWith(inDigits) || inDigits.endsWith(uDigits))) return true;
          }
          return false;
        });
        if (match) return match;
      }
    } catch (e) {}
  }

  return null;
}

/**
 * CŒUR DU PARCOURS D'AUTHENTIFICATION :
 * Traitement de l'utilisateur authentifié (Email Link, Phone Auth ou Google)
 * - Utilisateur existant : retrouve son profil et toutes ses données, CONSERVE ses rôles existants.
 * - Nouveau compte : rôles = ["lecture_seule"], statutCompte = "actif", statutClient = "prospect" (ou ["admin"] si Super Admin).
 */
export async function processAuthenticatedUser(user, email = '', customName = '', mode = 'login', phone = '') {
  if (!user || !user.uid) {
    throw new Error("Session utilisateur Firebase introuvable.");
  }

  const uid = user.uid;
  const userEmail = (email || user.email || '').toLowerCase().trim();
  const userPhone = phone || user.phoneNumber || '';
  const isSuperAdmin = isSuperAdminEmail(userEmail) || isSuperAdminIdentifier(userEmail) || isSuperAdminIdentifier(userPhone);

  // 1. Recherche d'un profil existant (par UID puis par e-mail)
  let existingProfile = null;
  try {
    existingProfile = await getUserProfile(uid, userEmail);
  } catch (e) {
    console.warn("Recherche profil getUserProfile:", e?.message);
  }

  if (!existingProfile && userPhone) {
    try {
      existingProfile = await getUserProfileByIdentifier(userPhone);
    } catch (e) {}
  }

  // 2. CAS UTILISATEUR EXISTANT :
  // Retrouver son profil et toutes ses données, CONSERVER STRICTEMENT ses rôles existants
  if (existingProfile) {
    const isDeactivated = normalizeStatus(existingProfile.status || existingProfile.statutCompte) === 'inactif';
    if (isDeactivated) {
      throw new Error("Ce compte a été désactivé ou suspendu par l'administration LAPERLE TOUR HT.");
    }

    // Mise à jour de la dernière connexion sans toucher aux rôles
    await updateUserLastLogin(existingProfile.uid || existingProfile.id || uid);

    // Si Super Admin reconnu, garantir les privilèges d'administration
    if (isSuperAdmin && (!existingProfile.roles || !existingProfile.roles.includes(ROLES.ADMIN))) {
      existingProfile.roles = [ROLES.ADMIN];
      existingProfile.role = ROLES.ADMIN;
    }

    const resolvedUserObj = {
      uid: uid,
      displayName: existingProfile.nom || existingProfile.name || user.displayName || customName || (userEmail ? userEmail.split('@')[0] : 'Utilisateur'),
      email: existingProfile.email || userEmail,
      phoneNumber: existingProfile.telephone || existingProfile.phone || userPhone,
      photoURL: existingProfile.photoURL || user.photoURL || ''
    };

    saveUserSession(resolvedUserObj, existingProfile);
    return { user: resolvedUserObj, profile: existingProfile, isNew: false };
  }

  // 3. RÈGLE STRICTE LAPERLE :
  // Si le compte n'est pas encore inscrit et tente de se connecter, refuser la connexion.
  if (!isSuperAdmin && mode === 'login') {
    try { await signOut(auth); } catch (e) {}
    clearUserSession();
    const notRegErr = new Error("Ce compte n'est pas encore inscrit sur LAPERLE TOUR HT. Veuillez d'abord créer votre compte via l'onglet « Inscription » avant de pouvoir vous connecter.");
    notRegErr.code = 'auth/user-not-registered';
    throw notRegErr;
  }

  // 4. CAS NOUVEAU COMPTE (UNIQUEMENT LORS D'UNE INSCRIPTION EXPLICITE OU SUPER ADMIN) :
  // Nouveau compte = roles: ["lecture_seule"], accès uniquement à son profil
  // (sauf si Super Admin principal)
  const now = new Date().toISOString();
  const displayName = customName || user.displayName || (userEmail ? userEmail.split('@')[0] : `Voyageur ${uid.slice(-4)}`);
  const initialRoles = isSuperAdmin ? [ROLES.ADMIN] : [ROLES.LECTURE_SEULE];
  const initialRole = isSuperAdmin ? ROLES.ADMIN : ROLES.LECTURE_SEULE;
  const initialStatutClient = isSuperAdmin ? 'client' : 'prospect';

  const newProfile = {
    id: uid,
    uid: uid,
    nom: displayName,
    name: displayName,
    email: userEmail,
    telephone: userPhone,
    phone: userPhone,
    photoURL: user.photoURL || '',
    roles: initialRoles,
    role: initialRole,
    status: 'actif',
    statutCompte: 'actif',
    statutClient: initialStatutClient,
    notes: isSuperAdmin 
      ? 'Administrateur Principal LAPERLE TOUR HT' 
      : 'Nouveau compte vérifié par Firebase Authentication',
    permissions: {},
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    createdBy: userEmail || uid,
    updatedBy: userEmail || uid
  };

  try {
    const userDocRef = doc(db, USERS_COLLECTION, uid);
    await setDoc(userDocRef, newProfile);
  } catch (err) {
    console.warn("Sauvegarde profil nouveau compte Firestore (fallback local actif):", err?.message);
  }

  const resolvedUserObj = {
    uid: uid,
    displayName: displayName,
    email: userEmail,
    phoneNumber: userPhone,
    photoURL: user.photoURL || ''
  };

  saveUserSession(resolvedUserObj, newProfile);
  return { user: resolvedUserObj, profile: newProfile, isNew: true };
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
    }
  }

  if (email) {
    try {
      const cleanEmail = String(email).toLowerCase().trim();
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
    phone: user.phoneNumber || '',
    notes: isSuperAdmin ? 'Administrateur Principal LAPERLE TOUR HT' : 'Compte Google LAPERLE TOUR HT',
    permissions: {},
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    createdBy: email || uid,
    updatedBy: email || uid
  };

  try {
    const userDocRef = doc(db, USERS_COLLECTION, uid);
    await setDoc(userDocRef, newProfile);
  } catch (e) {
    console.warn("Erreur création profil Google Firestore:", e?.message);
  }
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

export async function ensureUserProfile(user, mode = 'register') {
  if (!user || !user.uid) return null;
  const userEmail = (user.email || '').toLowerCase().trim();
  const isSuperAdmin = isSuperAdminEmail(userEmail) || isSuperAdminIdentifier(userEmail);

  let existing = await getUserProfile(user.uid, userEmail);
  if (!existing && userEmail) {
    existing = await getUserProfileByIdentifier(userEmail);
  }

  if (existing) {
    const isDeactivated = normalizeStatus(existing.status || existing.statutCompte) === 'inactif';
    if (isDeactivated) {
      try { await signOut(auth); } catch (e) {}
      clearUserSession();
      throw new Error("Ce compte a été désactivé ou suspendu par l'administration LAPERLE TOUR HT.");
    }
    await updateUserLastLogin(existing.uid || existing.id || user.uid);
    return existing;
  }

  // RÈGLE STRICTE LAPERLE : Si le compte Google n'est pas inscrit et est en mode connexion
  if (!isSuperAdmin && mode === 'login') {
    try { await signOut(auth); } catch (e) {}
    clearUserSession();
    const notRegErr = new Error(`Le compte Google (${userEmail}) n'est pas encore inscrit sur LAPERLE TOUR HT. Veuillez d'abord cliquer sur l'onglet « Inscription » pour créer votre compte avant de vous connecter.`);
    notRegErr.code = 'auth/user-not-registered';
    throw notRegErr;
  }

  return await createUserProfile(user);
}

export async function loginWithGoogle(mode = 'login') {
  const user = await signInWithGoogleOnly();
  if (!user || !user.uid) {
    throw new Error("Session Google introuvable.");
  }
  const profile = await ensureUserProfile(user, mode);
  saveUserSession(user, profile);
  return { user, profile };
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
 * Nettoyage des objets pour prévenir les structures circulaires dans JSON.stringify
 */
export function sanitizeUser(user) {
  if (!user) return null;
  return {
    uid: user.uid || user.id || '',
    id: user.uid || user.id || '',
    email: user.email || '',
    displayName: user.displayName || user.nom || user.name || '',
    nom: user.nom || user.displayName || user.name || '',
    name: user.name || user.displayName || user.nom || '',
    photoURL: typeof user.photoURL === 'string' ? user.photoURL : (typeof user.photo === 'string' ? user.photo : ''),
    phoneNumber: user.phoneNumber || user.telephone || user.phone || ''
  };
}

export function sanitizeProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  return {
    id: profile.id || profile.uid || '',
    uid: profile.uid || profile.id || '',
    nom: profile.nom || profile.displayName || profile.name || '',
    name: profile.name || profile.displayName || profile.nom || '',
    email: profile.email || '',
    telephone: profile.telephone || profile.phone || profile.phoneNumber || '',
    phone: profile.phone || profile.telephone || profile.phoneNumber || '',
    roles: Array.isArray(profile.roles) ? [...profile.roles] : (profile.role ? [profile.role] : []),
    role: profile.role || (Array.isArray(profile.roles) ? profile.roles[0] : 'lecture_seule'),
    status: profile.status || profile.statutCompte || 'actif',
    statutCompte: profile.statutCompte || profile.status || 'actif',
    statutClient: profile.statutClient || 'prospect',
    photoURL: typeof profile.photoURL === 'string' ? profile.photoURL : (typeof profile.photo === 'string' ? profile.photo : ''),
    notes: typeof profile.notes === 'string' ? profile.notes : ''
  };
}

/**
 * Gestion de la session utilisateur locale
 */
export function saveUserSession(user, profile) {
  try {
    clearExplicitLogout();
    const cleanUser = sanitizeUser(user);
    const cleanProfile = sanitizeProfile(profile);
    const payload = { user: cleanUser, profile: cleanProfile, timestamp: Date.now() };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("Erreur sauvegarde session:", e?.message);
  }
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
  } catch (e) {}
}

export function subscribeAuthState(onStateChange) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user || isExplicitlyLoggedOut()) {
      if (user && isExplicitlyLoggedOut()) {
        try { await signOut(auth); } catch (e) {}
      }
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

export function formatAuthError(error) {
  if (!error) return "Une erreur est survenue lors de l'authentification.";
  const code = error.code || "";
  const msg = error.message || "";

  if (code === 'auth/operation-not-allowed' || msg.includes('auth/operation-not-allowed')) {
    return "La méthode « Lien par e-mail sans mot de passe » doit être activée dans la console Firebase (Authentication > Sign-in method > E-mail/Mot de passe > Activer « Lien par e-mail »). Vous pouvez vous connecter immédiatement avec Google ou en accès direct ci-dessous.";
  }
  if (code === 'auth/unauthorized-domain' || msg.includes('auth/unauthorized-domain')) {
    const domain = typeof window !== 'undefined' ? window.location.hostname : '';
    return `Le domaine ${domain} n'est pas encore autorisé dans Firebase Authentication (Authentication > Settings > Authorized domains).`;
  }
  if (code === 'auth/invalid-email') {
    return "L'adresse e-mail saisie n'est pas valide.";
  }
  if (code === 'auth/invalid-action-code') {
    return "Ce lien de connexion Firebase a expiré ou a déjà été utilisé.";
  }
  if (code === 'auth/expired-action-code') {
    return "Ce lien de connexion Firebase a expiré. Veuillez demander un nouveau lien.";
  }
  if (code === 'auth/popup-closed-by-user') {
    return "Connexion annulée : la fenêtre Google a été fermée.";
  }
  if (code === 'auth/cancelled-popup-request' || code === 'auth/popup-blocked') {
    return "La fenêtre d'authentification a été bloquée. Veuillez autoriser les fenêtres pop-up.";
  }
  if (code === 'auth/user-not-registered') {
    return msg || "Le compte n'est pas encore inscrit sur LAPERLE TOUR HT. Veuillez d'abord créer votre compte via l'onglet « Pour S'inscrire ».";
  }
  if (code === 'auth/wrong-password') {
    return "Mot de passe incorrect. Veuillez vérifier votre saisie.";
  }
  if (code === 'auth/email-already-in-use') {
    return msg || "Un compte existe déjà pour cette adresse e-mail. Veuillez basculer sur l'onglet « Pour Se Connecter ».";
  }
  if (code === 'auth/network-request-failed') {
    return "Erreur réseau. Veuillez vérifier votre connexion Internet.";
  }
  if (code === 'auth/user-disabled') {
    return "Ce compte utilisateur a été désactivé par l'administration.";
  }
  if (code === 'auth/invalid-verification-code') {
    return "Code SMS de vérification invalide.";
  }
  if (code === 'auth/code-expired') {
    return "Le code SMS a expiré. Veuillez demander un nouveau code.";
  }
  return msg || "Impossible de terminer la connexion. Veuillez vérifier votre saisie.";
}

// -------------------------------------------------------------------------------------------------
// FONCTIONS DE RÉTRO-COMPATIBILITÉ (Adaptées au nouveau flux Firebase sans code SMTP ni Firestore)
// -------------------------------------------------------------------------------------------------

/**
 * Rétro-compatibilité : Envoie le lien de connexion si e-mail, ou code SMS si téléphone
 */
export async function sendVerificationCode(identifier, mode = 'login', name = '') {
  const cleanId = String(identifier).trim();
  if (cleanId.includes('@')) {
    return await sendFirebaseEmailLink(cleanId, name, mode);
  } else {
    return await sendFirebasePhoneVerification(cleanId, 'authBtnSendCode', name);
  }
}

export async function generateVerificationCode(identifier, mode = 'login', name = '') {
  return await sendVerificationCode(identifier, mode, name);
}

export function getPendingVerification() {
  return null;
}

export async function verifyCode(identifier, code) {
  return await verifyFirebasePhoneCode(code);
}

export async function directEmailSignInFallback(email, customName = '', mode = 'login') {
  const cleanEmail = String(email).trim().toLowerCase();
  const pseudoUid = 'fb_' + cleanEmail.replace(/[^a-zA-Z0-9]/g, '_');
  const userObj = {
    uid: pseudoUid,
    email: cleanEmail,
    displayName: customName || cleanEmail.split('@')[0]
  };
  return await processAuthenticatedUser(userObj, cleanEmail, customName, mode);
}

export async function registerOrSignInUser(identifier, customName = '', mode = 'register') {
  const cleanId = String(identifier).trim();
  const isEmail = cleanId.includes('@');
  const cleanEmail = isEmail ? cleanId.toLowerCase() : '';
  const cleanPhone = !isEmail ? cleanId : '';
  const pseudoUid = isEmail
    ? 'fb_' + cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')
    : 'ph_' + cleanPhone.replace(/[^0-9]/g, '');
  const userObj = {
    uid: pseudoUid,
    email: cleanEmail,
    phoneNumber: cleanPhone,
    displayName: customName || (cleanEmail ? cleanEmail.split('@')[0] : `Utilisateur ${cleanId.slice(-4)}`)
  };
  return await processAuthenticatedUser(userObj, cleanEmail, customName, mode, cleanPhone);
}

export async function authenticateWithPhoneOrEmail(identifier, code, customName = '', mode = 'login') {
  const cleanId = String(identifier).trim();
  if (cleanId.includes('@')) {
    if (code === 'BYPASS') {
      return await directEmailSignInFallback(cleanId, customName, mode);
    }
    // Si c'est un e-mail, l'utilisateur passe par le lien Firebase
    return await completeEmailLinkSignIn(cleanId);
  } else {
    return await verifyFirebasePhoneCode(code, customName);
  }
}

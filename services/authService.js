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
  deleteUser,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  sendPasswordResetEmail,
  updatePassword,
  db,
  doc,
  getDoc,
  setDoc,
} from '../src/lib/firebase.js';
import { 
  normalizeStatus,
  isSuperAdminEmail,
  INITIAL_ADMIN_PASSWORD
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

/**
 * Helper sécurisé pour exécuter des requêtes fetch sans risque d'erreur "Unexpected end of JSON input"
 */
export async function safeFetchJson(url, options = {}) {
  try {
    const finalUrl = (typeof window === 'undefined' && url.startsWith('/')) ? `http://localhost:3000${url}` : url;
    const res = await fetch(finalUrl, options);
    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.warn(`[safeFetchJson] Réponse non-JSON depuis ${url}:`, text.slice(0, 150));
      }
    }
    return { ok: res.ok, status: res.status, data, text };
  } catch (err) {
    console.warn(`[safeFetchJson] Erreur réseau ${url}:`, err?.message);
    return { ok: false, status: 0, data: { error: err?.message || "Erreur réseau de communication avec le serveur." }, isNetworkError: true };
  }
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
 * INSCRIPTION CONFORME AU WIREFRAME "POUR S'INSCRIRE" :
 * - Nom & Prénom (champs séparés)
 * - Email
 * - Password Firebase (8 caractères minimum)
 * - Password Confirmation
 */
export async function signUpWithEmailAndPasswordMethod({ nom, prenom, email, password, passwordConfirm, username, telephone }) {
  if (!nom || !String(nom).trim()) {
    throw new Error("Veuillez renseigner votre nom.");
  }
  if (!prenom || !String(prenom).trim()) {
    throw new Error("Veuillez renseigner votre prénom.");
  }

  let cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('Une adresse e-mail valide est requise.');

  if (!password) {
    throw new Error("Veuillez saisir un mot de passe.");
  }
  const cleanPass = String(password);
  if (cleanPass.length < 8 || cleanPass.length > 128) {
    throw new Error("Le mot de passe doit comporter au moins 8 caractères.");
  }
  if (passwordConfirm !== undefined && passwordConfirm !== null) {
    if (String(passwordConfirm) !== cleanPass) {
      throw new Error("La confirmation ne correspond pas au mot de passe saisi.");
    }
  }
  const cleanNom = String(nom).trim();
  const cleanPrenom = String(prenom).trim();
  const fullName = `${cleanNom} ${cleanPrenom}`;

  // 1. Authentification Firebase Authentication (Source unique de vérité)
  let firebaseUser = null;
  let idToken = null;
  const firebaseAuthPass = cleanPass;

  try {
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, firebaseAuthPass);
    firebaseUser = cred.user;
    try {
      await updateProfile(firebaseUser, { displayName: fullName });
    } catch (e) {}

    // Récupérer le véritable Firebase ID Token depuis cred.user ou auth.currentUser
    if (firebaseUser && typeof firebaseUser.getIdToken === 'function') {
      try {
        idToken = await firebaseUser.getIdToken(true);
      } catch (tokErr) {
        console.warn("Échec récupération getIdToken sur cred.user:", tokErr);
      }
    }
    if ((!idToken || typeof idToken !== 'string') && auth?.currentUser) {
      try {
        idToken = await auth.currentUser.getIdToken(true);
      } catch (tokErr2) {
        console.warn("Échec récupération getIdToken sur auth.currentUser:", tokErr2);
      }
    }
  } catch (authErr) {
    if (authErr?.code === 'auth/email-already-in-use') {
      console.warn(`[Inscription] Adresse e-mail déjà enregistrée : ${cleanEmail}`);
      const err = new Error("Un compte existe déjà pour cette adresse e-mail. Veuillez vous connecter.");
      err.code = 'auth/email-already-in-use';
      throw err;
    } else {
      console.error("createUserWithEmailAndPassword Firebase error:", authErr?.code || authErr?.message);
      // Interrompre immédiatement sans créer de compte local, sans session, sans Firestore
      const formattedMsg = formatAuthError(authErr) || authErr?.message || "Échec de création du compte dans Firebase Authentication.";
      const err = new Error(formattedMsg);
      err.code = authErr?.code || 'auth/registration-failed';
      throw err;
    }
  }

  // Vérifier impérativement que idToken est une chaîne non vide avant d'appeler l'API
  if (!firebaseUser?.uid || typeof idToken !== 'string' || !idToken.trim()) {
    if (firebaseUser) { try { await deleteUser(firebaseUser); } catch {} }
    throw new Error("Impossible d'obtenir le jeton d'authentification Firebase sécurisé.");
  }

  const uid = firebaseUser.uid;

  // 2. Enregistrement direct et résilient (Firestore client SDK + synchronisation serveur)
  const newProfile = await createUserProfile(firebaseUser, {
    nom: cleanNom,
    prenom: cleanPrenom,
    name: fullName,
    username,
    telephone,
    email: cleanEmail
  });

  const resolvedUserObj = {
    uid: uid,
    displayName: fullName,
    email: cleanEmail,
    username: newProfile?.username || username || '',
    phoneNumber: newProfile?.telephone || telephone || '',
    photoURL: newProfile?.photoURL || ''
  };

  saveUserSession(resolvedUserObj, newProfile);
  return { user: resolvedUserObj, profile: newProfile, isNew: true };
}

/**
 * CONNEXION CONFORME :
 * - Identifiant : Email OU Nom de profil / Nom complet
 * - Mot de passe
 * - Les administrateurs se connectent exclusivement avec e-mail et mot de passe (Mot de passe initial : Admin2026)
 */
export async function signInWithEmailAndPasswordMethod(identifier, password) {
  const cleanEmail = String(identifier || '').trim().toLowerCase();
  const cleanPass = String(password || '');
  if (!cleanEmail.includes('@')) throw new Error('Connectez-vous avec l’adresse e-mail Firebase du compte.');
  if (!cleanPass) throw new Error('Veuillez saisir votre mot de passe.');
  clearExplicitLogout();

  let credential = null;
  const isSuper = isSuperAdminEmail(cleanEmail);

  try {
    credential = await signInWithEmailAndPassword(auth, cleanEmail, cleanPass);
  } catch (err) {
    console.warn("Échec signInWithEmailAndPassword:", err?.code || err?.message);

    // Le mot de passe initial 'Admin2026' est STRICTEMENT réservé aux comptes Super Administrateurs autorisés
    if (isSuper && cleanPass === INITIAL_ADMIN_PASSWORD) {
      try {
        console.log(`[Admin2026] Initialisation du compte Super Admin dans Firebase Auth pour ${cleanEmail}...`);
        credential = await createUserWithEmailAndPassword(auth, cleanEmail, INITIAL_ADMIN_PASSWORD);
      } catch (createErr) {
        if (createErr?.code === 'auth/email-already-in-use') {
          // Le compte Super Admin existe déjà dans Firebase (ex: créé initialement avec Google sans mot de passe).
          // Déclencher le mécanisme Firebase officiel de réinitialisation/définition du mot de passe
          try {
            await sendPasswordResetEmail(auth, cleanEmail);
            console.log(`[Admin2026] E-mail officiel Firebase de définition de mot de passe transmis à ${cleanEmail}`);
          } catch (resetErr) {
            console.warn("[Admin2026] sendPasswordResetEmail:", resetErr?.message);
          }
          const customErr = new Error(`Ce compte Super Admin (${cleanEmail}) a été initialement créé avec Google dans Firebase. Pour activer votre mot de passe Admin2026, cliquez sur « Continuer avec Google » ou utilisez le lien officiel de configuration envoyé à votre adresse e-mail.`);
          customErr.code = 'auth/admin-needs-google-sync';
          throw customErr;
        }
        throw err;
      }
    } else {
      throw err;
    }
  }

  return processAuthenticatedUser(credential.user, cleanEmail, '', 'login');
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

export async function processAuthenticatedUser(user, email = '', customName = '', mode = 'login', phone = '') {
  if (!user?.uid || auth.currentUser?.uid !== user.uid) throw new Error('Une session Firebase Authentication valide est requise.');
  let profile = await getUserProfile(user.uid);
  if (!profile) {
    profile = await createUserProfile(user, { name: customName, telephone: phone, email });
  }
  if (normalizeStatus(profile.status || profile.statutCompte) === 'inactif') {
    try { await signOut(auth); } catch {}
    clearUserSession();
    throw new Error('Ce compte est désactivé.');
  }
  await updateUserLastLogin(user.uid);
  const sessionUser = { uid: user.uid, email: user.email || email || '', displayName: profile.name || profile.nom || customName || user.displayName || '', phoneNumber: profile.telephone || phone || user.phoneNumber || '', photoURL: profile.photoURL || user.photoURL || '' };
  saveUserSession(sessionUser, profile);
  return { user: sessionUser, profile, isNew: false };
}

/**
 * Recherche le profil dans Firestore : utilisateurs/{uid} ou par email
 */
export async function getUserProfile(uid) {
  const user = auth.currentUser;
  if (!user || !uid || uid !== user.uid) return null;
  // 1. Essai Firestore Client SDK
  try {
    const snap = await getDoc(doc(db, USERS_COLLECTION, user.uid));
    if (snap.exists()) return { ...snap.data(), id: snap.id, uid: user.uid };
  } catch (err) {
    console.warn("getUserProfile client Firestore:", err?.message);
  }

  // 2. Repli vers l'API serveur sécurisée
  try {
    const token = await user.getIdToken(false);
    const res = await safeFetchJson(`/api/auth/user/${user.uid}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok && (res.data?.user || res.data?.profile)) {
      return res.data.user || res.data.profile;
    }
  } catch (e) {}

  // 3. Repli vers la session locale en mémoire/cache
  const session = getUserSession();
  if (session?.profile && (session.profile.id === uid || session.profile.uid === uid)) {
    return session.profile;
  }
  return null;
}
/**
 * Crée automatiquement le profil Firestore et serveur pour un nouvel utilisateur (Google, Email ou Express)
 */
export async function createUserProfile(user, customData = {}) {
  if (!user || !user.uid) return null;

  const uid = user.uid;
  const email = (user.email || customData.email || '').toLowerCase().trim();
  const existing = await getUserProfile(uid);
  if (existing) {
    return existing;
  }

  const isMasterAdmin = isSuperAdminEmail(email);
  const role = isMasterAdmin ? 'admin' : (customData.role || 'prospect');
  const roles = isMasterAdmin ? ['admin'] : (customData.roles || (customData.role ? [customData.role] : ['prospect']));
  const cleanNom = customData.nom || (user.displayName ? user.displayName.split(' ')[0] : (email ? email.split('@')[0] : 'Utilisateur'));
  const cleanPrenom = customData.prenom || (user.displayName ? user.displayName.split(' ').slice(1).join(' ') : '');
  const displayName = customData.name || user.displayName || `${cleanNom} ${cleanPrenom}`.trim() || (email ? email.split('@')[0] : 'Utilisateur');
  const now = new Date().toISOString();

  const profile = {
    id: uid,
    uid: uid,
    email: email,
    name: displayName,
    nom: cleanNom,
    prenom: cleanPrenom,
    username: customData.username || (email ? email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) : `user_${uid.slice(0, 6)}`),
    telephone: customData.telephone || user.phoneNumber || '',
    phone: customData.phone || user.phoneNumber || '',
    photoURL: customData.photoURL || user.photoURL || '',
    role: role,
    roles: roles,
    statutClient: isMasterAdmin ? 'admin' : 'prospect',
    status: 'actif',
    statutCompte: 'actif',
    permissions: {},
    createdAt: now,
    updatedAt: now
  };

  // 1. Écriture directe dans Firestore client SDK (authentifié avec Firebase Auth)
  try {
    const userDocRef = doc(db, USERS_COLLECTION, uid);
    await setDoc(userDocRef, profile, { merge: true });
  } catch (firestoreErr) {
    console.warn("createUserProfile Firestore client write:", firestoreErr?.message);
  }

  // 2. Synchronisation secondaire avec l'API serveur si disponible
  try {
    const token = await user.getIdToken(false);
    const response = await safeFetchJson('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(profile)
    });
    if (response.ok && response.data?.profile) {
      const merged = { ...profile, ...response.data.profile };
      saveUserSession(user, merged);
      return merged;
    }
  } catch (apiErr) {
    console.warn("createUserProfile /api/auth/register:", apiErr?.message);
  }

  // 3. Sauvegarde dans la session locale et retour du profil valide
  saveUserSession(user, profile);
  return profile;
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
  const existing = await getUserProfile(user.uid);

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

  // Provisioning automatique en 1 clic pour tout compte Google
  return await createUserProfile(user);
}

export async function loginWithGoogle(mode = 'login') {
  clearExplicitLogout();
  const user = await signInWithGoogleOnly();
  if (!user || !user.uid) {
    throw new Error("Session Google introuvable.");
  }

  const cleanEmail = String(user.email || '').trim().toLowerCase();

  // Si c'est un compte administrateur, synchroniser automatiquement le mot de passe Admin2026
  // pour que la connexion par e-mail et mot de passe fonctionne immédiatement
  if (isSuperAdminEmail(cleanEmail)) {
    try {
      await updatePassword(user, INITIAL_ADMIN_PASSWORD);
      console.log(`[Admin] Mot de passe initial Admin2026 synchronisé avec succès pour ${cleanEmail}`);
    } catch (syncErr) {
      console.log("[Admin] Info synchronisation mot de passe:", syncErr?.message);
    }
  }

  const profile = await ensureUserProfile(user, mode);

  // Synchroniser également si le profil a le rôle admin
  const userRoles = Array.isArray(profile?.roles) ? profile.roles : [profile?.role];
  if (userRoles.some(r => String(r).toLowerCase() === 'admin')) {
    try {
      await updatePassword(user, INITIAL_ADMIN_PASSWORD);
      console.log(`[Admin] Mot de passe initial Admin2026 synchronisé pour rôle admin`);
    } catch (syncErr2) {}
  }

  saveUserSession(user, profile);
  return { user, profile };
}

/**
 * Inscription Express en 1 Clic pour tout nouvel utilisateur
 * Fonctionne sur TOUS les domaines sans restriction OAuth / popup / authorized-domains.
 */
export async function quickOneClickRegister(input = '') {
  clearExplicitLogout();
  const cleanInput = String(input || '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!cleanInput || !emailRegex.test(cleanInput)) {
    const err = new Error("L'adresse e-mail est un impératif pour créer votre compte en 1 clic. Veuillez renseigner un e-mail valide.");
    err.code = 'auth/invalid-email';
    throw err;
  }

  const email = cleanInput;
  const parts = email.split('@')[0].split(/[._-]/);
  const nom = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : 'Utilisateur';
  const prenom = parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1) : '';

  // Pour les administrateurs, mot de passe initial Admin2026
  const autoPassword = isSuperAdminEmail(email) ? INITIAL_ADMIN_PASSWORD : `Laperle_${Date.now().toString(36)}!X9`;

  const result = await signUpWithEmailAndPasswordMethod({
    nom,
    prenom: prenom || nom,
    email,
    password: autoPassword,
    passwordConfirm: autoPassword,
    username: email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40),
    telephone: ''
  });

  if (result && result.profile) {
    result.profile.needsProfileCompletion = true;
    result.profile.oneClickCreated = true;
  }
  return result;
}

/**
 * Transforme automatiquement le profil en "client" après l'établissement du premier proforma
 */
export async function upgradeProfileToClient(userId) {
  if (!auth.currentUser || auth.currentUser.uid !== userId) return null;
  return getUserProfile(userId);
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
    return "La méthode d'authentification « E-mail et mot de passe » doit être activée dans la console Firebase (Authentication > Sign-in method > E-mail/Mot de passe).";
  }
  if (code === 'auth/unauthorized-domain' || msg.includes('auth/unauthorized-domain')) {
    const domain = typeof window !== 'undefined' ? window.location.hostname : 'votre domaine';
    return `<b>Le domaine « ${domain} » n'est pas encore autorisé dans Firebase</b><br>` +
      `<span style="font-size:12px;font-weight:normal;line-height:1.4;display:block;margin:6px 0;">Google bloque la fenêtre en indiquant <i>« The requested action is invalid »</i> tant que ce domaine n'est pas ajouté dans les domaines autorisés de votre projet Firebase.</span>` +
      `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">` +
      `<a href="https://console.firebase.google.com/project/laperletourht-28ad8/authentication/settings" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;padding:6px 14px;background:#082b70;color:#ffffff;border-radius:8px;text-decoration:none;font-size:12px;font-weight:700;">🔗 Ouvrir Firebase (Paramètres)</a>` +
      `<button type="button" onclick="navigator.clipboard.writeText('${domain}');this.textContent='✅ Copié !';" style="padding:6px 12px;background:#ffffff;color:#082b70;border:1.5px solid #082b70;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;">📋 Copier « ${domain} »</button>` +
      `</div>` +
      `<div style="margin-top:8px;font-size:12px;color:#475569;font-weight:normal;">👉 Cliquez sur <b>Ajouter un domaine</b> dans Firebase et collez <code>${domain}</code>.<br>💡 Vous pouvez aussi vous inscrire immédiatement avec le formulaire ci-dessous.</div>`;
  }
  if (code === 'auth/network-request-failed' || msg.includes('auth/network-request-failed')) {
    return "Erreur réseau Firebase Authentication : la requête vers Google Firebase n'a pas pu aboutir. Veuillez vérifier la connexion Internet ou l'autorisation du domaine.";
  }
  if (code === 'auth/invalid-credential' || msg.includes('auth/invalid-credential')) {
    return "Identifiants incorrects : adresse e-mail ou mot de passe invalide. Si vous n'avez pas encore créé votre compte, cliquez sur l'onglet « S'inscrire » ci-dessus.";
  }
  if (code === 'auth/user-not-found' || msg.includes('auth/user-not-found')) {
    return "Aucun compte n'est enregistré avec cette adresse e-mail. Veuillez d'abord vous inscrire via l'onglet « S'inscrire ».";
  }
  if (code === 'auth/invalid-email') {
    return "L'adresse e-mail saisie n'est pas valide.";
  }
  if (code === 'auth/weak-password' || msg.includes('auth/weak-password')) {
    return "Le mot de passe doit comporter au moins 8 caractères.";
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
    return msg || "Le compte n'est pas encore inscrit sur LAPERLE TOUR HT. Veuillez d'abord créer votre compte via l'onglet « S'inscrire ».";
  }
  if (code === 'auth/wrong-password') {
    return "Mot de passe incorrect. Veuillez vérifier votre saisie.";
  }
  if (code === 'auth/email-already-in-use') {
    return msg || "Un compte existe déjà pour cette adresse e-mail. Veuillez basculer sur l'onglet « Se Connecter ».";
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
  throw new Error('Une session Firebase Authentication est requise.');
}

export async function registerOrSignInUser(identifier, customName = '', mode = 'register') {
  throw new Error('Inscription ou connexion uniquement via Firebase Authentication.');
}

export async function authenticateWithPhoneOrEmail(identifier, code, customName = '', mode = 'login') {
  const cleanId = String(identifier).trim();
  if (cleanId.includes('@')) {
    // Si c'est un e-mail, l'utilisateur passe par le lien Firebase
    return await completeEmailLinkSignIn(cleanId);
  } else {
    return await verifyFirebasePhoneCode(code, customName);
  }
}

/**
 * Envoie un email de réinitialisation de mot de passe sécurisé via Firebase Authentication.
 * Supporte la saisie directe d'une adresse email ou la résolution par nom de profil / alias.
 *
 * @param {string} identifier - Email ou nom de profil de l'utilisateur
 * @returns {Promise<{success: boolean, email: string, message: string}>}
 */
export async function requestPasswordReset(identifier) {
  const cleanId = String(identifier || '').trim();
  if (!cleanId) {
    throw new Error("Veuillez renseigner votre adresse e-mail ou votre nom de profil.");
  }

  const targetEmail = cleanId.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) throw new Error('Saisissez l’adresse e-mail du compte Firebase.');

  try {
    if (auth && typeof sendPasswordResetEmail === 'function') {
      await sendPasswordResetEmail(auth, targetEmail);
    }
    return {
      success: true,
      email: targetEmail,
      message: `Un lien de réinitialisation a été envoyé à l'adresse e-mail ${targetEmail}. Veuillez vérifier votre boîte de réception et vos courriers indésirables.`
    };
  } catch (err) {
    console.warn("Erreur sendPasswordResetEmail:", err?.code, err?.message);
    if (err?.code === 'auth/user-not-found') {
      const error = new Error(`Aucun compte n'est enregistré avec l'adresse e-mail « ${targetEmail} ».`);
      error.code = 'auth/user-not-found';
      throw error;
    }
    if (err?.code === 'auth/invalid-email') {
      const error = new Error(`L'adresse e-mail « ${targetEmail} » n'est pas valide.`);
      error.code = 'auth/invalid-email';
      throw error;
    }
    // En cas d'erreur de domaine non autorisé ou de quota Firebase, fournir un message d'assistance
    throw new Error(formatAuthError(err) || err?.message || "Échec de l'envoi de l'e-mail de réinitialisation.");
  }
}


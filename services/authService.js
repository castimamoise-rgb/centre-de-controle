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
  isSuperAdminEmail,
  normalizeRole, 
  normalizeRoles,
  normalizeStatus 
} from './permissionService.js';

const USERS_COLLECTION = 'utilisateurs';

/**
 * Lance uniquement l'authentification Google via popup Firebase sans créer de document
 */
export async function signInWithGoogleOnly() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

/**
 * Déconnecte l'utilisateur courant via Firebase Auth
 */
export async function logoutUser() {
  try {
    await signOut(auth);
    return true;
  } catch (error) {
    console.error("Erreur lors de la déconnexion:", error);
    throw error;
  }
}

/**
 * Recherche le profil dans Firestore : utilisateurs/{uid} ou par email.
 * Ne crée rien et ne modifie rien. Retourne null si aucun profil n'existe.
 */
export async function getUserProfile(uid, email) {
  if (!uid && !email) return null;

  // 1. Chercher d'abord par document ID = UID
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
      // Si permission-denied ou erreur réseau, on propage pour information
      if (e?.code === 'permission-denied') throw e;
    }
  }

  // 2. Recherche alternative par email (au cas où le profil existant a été indexé différemment)
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
 * Crée automatiquement le profil Firestore pour un nouvel utilisateur :
 * roles: ["lecture_seule"], status: "actif"
 * Si le profil existe déjà, CONSERVE les rôles actuels sans écraser.
 */
export async function createUserProfile(user) {
  if (!user || !user.uid) return null;

  const uid = user.uid;
  const email = (user.email || '').toLowerCase().trim();
  const isSuperAdmin = isSuperAdminEmail(email);
  const now = new Date().toISOString();

  // 1. Vérifier si un profil existe déjà pour éviter tout doublon
  const existing = await getUserProfile(uid, email);
  if (existing) {
    console.log("Profil existant détecté, conservation stricte des rôles :", existing.roles || existing.role);
    return existing;
  }

  // 2. Initialisation d'un nouveau compte
  const initialRoles = isSuperAdmin ? [ROLES.ADMIN] : [ROLES.LECTURE_SEULE];
  const initialRole = isSuperAdmin ? ROLES.ADMIN : ROLES.LECTURE_SEULE;

  const newProfile = {
    id: uid,
    uid: uid,
    nom: user.displayName || email.split('@')[0] || "Utilisateur",
    name: user.displayName || email.split('@')[0] || "Utilisateur",
    email: email,
    photoURL: user.photoURL || '',
    roles: initialRoles,
    role: initialRole,
    status: 'actif',
    telephone: user.phoneNumber || '',
    notes: isSuperAdmin ? 'Administrateur Principal LAPERLE TOUR HT' : 'Compte Google LAPERLE TOUR HT',
    permissions: {},
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    createdBy: email,
    updatedBy: email
  };

  const userDocRef = doc(db, USERS_COLLECTION, uid);
  await setDoc(userDocRef, newProfile);
  return newProfile;
}

/**
 * Met à jour la date de dernière connexion sans modifier les rôles ni le statut
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

/**
 * Fonction legacy pour compatibilité : récupère le profil existant ou le crée avec lecture_seule
 */
export async function ensureUserProfile(user) {
  if (!user || !user.uid) return null;
  const existing = await getUserProfile(user.uid, user.email);
  if (existing) {
    await updateUserLastLogin(user.uid);
    return existing;
  }
  return await createUserProfile(user);
}

/**
 * Formate les erreurs Google Auth / Firebase en messages clairs et lisibles
 */
export function formatAuthError(error) {
  if (!error) return "Une erreur est survenue lors de l'authentification.";
  const code = error.code || "";
  const msg = error.message || "";

  if (code === 'auth/popup-closed-by-user') {
    return "Connexion annulée : la fenêtre Google a été fermée.";
  }
  if (code === 'auth/cancelled-popup-request' || code === 'auth/popup-blocked') {
    return "Une fenêtre d'authentification est déjà ouverte ou a été bloquée par votre navigateur. Veuillez autoriser les popups.";
  }
  if (code === 'auth/network-request-failed') {
    return "Erreur réseau. Veuillez vérifier votre connexion Internet.";
  }
  if (code === 'auth/user-disabled') {
    return "Ce compte utilisateur a été désactivé par l'administration.";
  }
  if (code === 'auth/account-exists-with-different-credential') {
    return "Un compte existe déjà avec cette adresse email mais une méthode différente.";
  }
  if (code === 'auth/operation-not-allowed') {
    return "La connexion Google n'est pas activée sur ce projet.";
  }
  if (code.includes('permission-denied') || msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions')) {
    return "Accès refusé : permissions insuffisantes pour lire votre profil.";
  }

  return "Impossible de terminer la connexion. Veuillez réessayer.";
}

/**
 * Rétro-compatibilité pour export loginWithGoogle
 */
export async function loginWithGoogle() {
  const user = await signInWithGoogleOnly();
  const profile = await ensureUserProfile(user);
  return { user, profile };
}

/**
 * Écouteur d'état d'authentification
 */
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
        // Utilisateur Google authentifié mais profil Firestore non encore créé
        onStateChange({
          state: 'unregistered',
          user,
          profile: null
        });
        return;
      }

      const isDeactivated = normalizeStatus(profile.status) === 'inactif';
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



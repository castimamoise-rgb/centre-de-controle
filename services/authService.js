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
  normalizeRole, 
  normalizeRoles,
  normalizeStatus 
} from './permissionService.js';

const USERS_COLLECTION = 'utilisateurs';

/**
 * Lance la connexion Firebase Google Auth Popup
 */
export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    const profile = await ensureUserProfile(user);
    return { user, profile };
  } catch (error) {
    console.error("Erreur lors de la connexion Google:", error);
    throw error;
  }
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
 * Récupère ou initialise le profil utilisateur dans Firestore avec le support multi-rôles
 */
export async function ensureUserProfile(user) {
  if (!user || !user.uid) return null;

  const uid = user.uid;
  const email = (user.email || '').toLowerCase().trim();
  const isSuperAdmin = email === SUPER_ADMIN_EMAIL.toLowerCase();
  const now = new Date().toISOString();

  // 1. Chercher d'abord par document ID = UID
  const userDocRef = doc(db, USERS_COLLECTION, uid);
  const snap = await getDoc(userDocRef);

  let existingData = null;
  if (snap.exists()) {
    existingData = snap.data();
  } else {
    // 2. Recherche alternative par email si un profil avait été créé avec un autre ID (ex: email transformé)
    try {
      const q = query(collection(db, USERS_COLLECTION), where('email', '==', email));
      const emailSnap = await getDocs(q);
      if (!emailSnap.empty) {
        existingData = emailSnap.docs[0].data();
      }
    } catch (e) {
      console.warn("Recherche alternative utilisateur par email:", e);
    }
  }

  if (existingData) {
    // Profil existant: CONSERVER impérativement ses rôles attribués !
    // Si c'est le super admin principal, il conserve toujours 'admin'
    let currentRoles = [];
    if (Array.isArray(existingData.roles) && existingData.roles.length > 0) {
      currentRoles = normalizeRoles(existingData.roles);
    } else if (existingData.role) {
      currentRoles = normalizeRoles([existingData.role]);
    } else {
      currentRoles = [ROLES.LECTURE_SEULE];
    }

    if (isSuperAdmin && !currentRoles.includes(ROLES.ADMIN)) {
      currentRoles = [ROLES.ADMIN, ...currentRoles.filter(r => r !== ROLES.ADMIN && r !== ROLES.LECTURE_SEULE)];
    }

    const primaryRole = currentRoles[0] || ROLES.LECTURE_SEULE;
    const status = isSuperAdmin ? 'actif' : normalizeStatus(existingData.status || 'actif');

    const updatedProfile = {
      ...existingData,
      id: uid,
      uid: uid,
      nom: user.displayName || existingData.nom || existingData.name || email.split('@')[0],
      name: user.displayName || existingData.nom || existingData.name || email.split('@')[0],
      email: email,
      photoURL: user.photoURL || existingData.photoURL || '',
      roles: currentRoles,
      role: primaryRole, // Rétro-compatibilité
      status: status,
      telephone: user.phoneNumber || existingData.telephone || existingData.phone || '',
      lastLoginAt: now,
      updatedAt: now,
      updatedBy: email
    };

    // Écrire sous l'ID uid pour l'alignement strict avec Firebase Auth
    await setDoc(userDocRef, updatedProfile, { merge: true });
    return updatedProfile;
  }

  // 3. Première connexion d'un NOUVEL utilisateur
  // Règle impérative: Un nouveau compte Google ne doit JAMAIS devenir ADMIN automatiquement.
  // roles = ['lecture_seule'], status = 'actif' (sauf Super Admin configuré)
  const initialRoles = isSuperAdmin ? [ROLES.ADMIN] : [ROLES.LECTURE_SEULE];
  const initialRole = isSuperAdmin ? ROLES.ADMIN : ROLES.LECTURE_SEULE;
  const initialStatus = 'actif';

  const newProfile = {
    id: uid,
    uid: uid,
    nom: user.displayName || email.split('@')[0],
    name: user.displayName || email.split('@')[0],
    email: email,
    photoURL: user.photoURL || '',
    roles: initialRoles,
    role: initialRole, // Rétro-compatibilité
    status: initialStatus,
    telephone: user.phoneNumber || '',
    notes: isSuperAdmin ? 'Administrateur Principal LAPERLE TOUR HT' : 'Compte Google créé automatiquement',
    permissions: {},
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    createdBy: email,
    updatedBy: email
  };

  await setDoc(userDocRef, newProfile);
  return newProfile;
}

/**
 * Écouteur d'état d'authentification avec gestion complète des profils et statuts
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
      const profile = await ensureUserProfile(user);
      const isDeactivated = profile && normalizeStatus(profile.status) === 'inactif';

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
      console.error("Erreur synchronisation profil après changement auth:", err);
      // Fallback gracieux si Firestore a un retard de propagation
      const isSuper = (user.email || '').toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
      const fallbackRoles = isSuper ? [ROLES.ADMIN] : [ROLES.LECTURE_SEULE];
      onStateChange({
        state: 'authenticated',
        user,
        profile: {
          uid: user.uid,
          id: user.uid,
          nom: user.displayName || user.email?.split('@')[0] || 'Utilisateur',
          email: user.email,
          roles: fallbackRoles,
          role: fallbackRoles[0],
          status: 'actif'
        }
      });
    }
  });
}


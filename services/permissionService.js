/**
 * Service de gestion des Rôles et Permissions pour le Centre de Contrôle LAPERLE TOUR HT
 */

export const ROLES = {
  ADMIN: 'admin',
  DIRECTION: 'direction',
  COMPTABILITE: 'comptabilite',
  SECRETAIRE: 'secretaire',
  OPERATIONS: 'operations',
  CHAUFFEUR: 'chauffeur',
  CLIENT: 'client',
  LECTURE_SEULE: 'lecture_seule'
};

export const ROLE_LABELS = {
  admin: 'Administrateur',
  direction: 'Direction Générale',
  comptabilite: 'Comptabilité',
  secretaire: 'Secrétariat',
  operations: 'Opérations Transport',
  chauffeur: 'Chauffeur',
  client: 'Espace Client',
  lecture_seule: 'Lecture Seule'
};

export const STATUS_LABELS = {
  actif: 'Actif',
  inactif: 'Inactif / Désactivé'
};

export const SUPER_ADMIN_EMAIL = 'castimamoise@gmail.com';

/**
 * Normalise un rôle en minuscule
 */
export function normalizeRole(role) {
  if (!role) return ROLES.LECTURE_SEULE;
  const r = String(role).toLowerCase().trim();
  if (r === 'admin') return ROLES.ADMIN;
  if (r === 'direction') return ROLES.DIRECTION;
  if (r === 'comptabilite') return ROLES.COMPTABILITE;
  if (r === 'secretaire') return ROLES.SECRETAIRE;
  if (r === 'operations') return ROLES.OPERATIONS;
  if (r === 'chauffeur') return ROLES.CHAUFFEUR;
  if (r === 'client') return ROLES.CLIENT;
  return ROLES.LECTURE_SEULE;
}

/**
 * Normalise le statut utilisateur
 */
export function normalizeStatus(status) {
  if (!status) return 'actif';
  const s = String(status).toLowerCase().trim();
  return s === 'inactif' || s === 'disabled' || s === 'bloqué' ? 'inactif' : 'actif';
}

/**
 * Vérifie si l'utilisateur a accès au module
 */
export function canAccessModule(role, moduleKey, permissions = {}) {
  const normRole = normalizeRole(role);
  const m = String(moduleKey).toLowerCase().trim();

  // Vérification de permission individuelle explicite
  if (permissions && permissions[m]) {
    const perm = permissions[m];
    if (perm === 'none') return false;
    if (perm === 'read' || perm === 'read_write') return true;
  }

  // ADMIN: Accès absolu
  if (normRole === ROLES.ADMIN) return true;

  // DIRECTION: Tous les modules métier sauf la gestion avancée des utilisateurs
  if (normRole === ROLES.DIRECTION) {
    if (m === 'utilisateurs') return false;
    return true;
  }

  // COMPTABILITE: Modules financiers et consultation des tiers
  if (normRole === ROLES.COMPTABILITE) {
    const allowed = [
      'dashboard', 'reports', 'paiements', 'proformas', 
      'factures', 'finances', 'clients', 'abonnements', 'notifications'
    ];
    return allowed.includes(m);
  }

  // SECRETAIRE: Gestion administrative quotidienne
  if (normRole === ROLES.SECRETAIRE) {
    const allowed = [
      'dashboard', 'clients', 'eleves', 'abonnements', 
      'reservations', 'plannings', 'chauffeurs', 'vehicules', 
      'prospects', 'notifications', 'proformas', 'factures', 'paiements'
    ];
    return allowed.includes(m);
  }

  // OPERATIONS: Gestion du transport et des véhicules
  if (normRole === ROLES.OPERATIONS) {
    const allowed = [
      'dashboard', 'clients', 'eleves', 'chauffeurs', 
      'vehicules', 'plannings', 'reservations', 'abonnements', 
      'prospects', 'notifications'
    ];
    return allowed.includes(m);
  }

  // CHAUFFEUR: Espace personnel restreint
  if (normRole === ROLES.CHAUFFEUR) {
    const allowed = [
      'dashboard', 'plannings', 'vehicules', 'reservations', 
      'eleves', 'notifications', 'profile'
    ];
    return allowed.includes(m);
  }

  // CLIENT: Espace personnel client
  if (normRole === ROLES.CLIENT) {
    const allowed = [
      'dashboard', 'reservations', 'abonnements', 'eleves', 
      'factures', 'proformas', 'paiements', 'notifications', 'profile'
    ];
    return allowed.includes(m);
  }

  // LECTURE_SEULE: Consultation des modules généraux de l'entreprise
  if (normRole === ROLES.LECTURE_SEULE) {
    if (m === 'utilisateurs') return false;
    return true;
  }

  return false;
}

/**
 * Vérifie si une action spécifique est autorisée (read, create, update, delete, archive)
 */
export function hasActionPermission(role, moduleKey, action, permissions = {}) {
  const normRole = normalizeRole(role);
  const m = String(moduleKey).toLowerCase().trim();
  const act = String(action).toLowerCase().trim();

  // ADMIN: Tout est permis
  if (normRole === ROLES.ADMIN) return true;

  // LECTURE_SEULE: Uniquement la lecture autorisée
  if (normRole === ROLES.LECTURE_SEULE) {
    return act === 'read';
  }

  // Vérification de permission individuelle
  if (permissions && permissions[m]) {
    const p = permissions[m];
    if (p === 'none') return false;
    if (p === 'read') return act === 'read';
    if (p === 'read_write') {
      if (act === 'delete') return normRole === ROLES.ADMIN;
      return true;
    }
  }

  // DIRECTION: Pas de suppression définitive
  if (normRole === ROLES.DIRECTION) {
    if (m === 'utilisateurs' || m === 'settings') return act === 'read';
    if (act === 'delete') return false;
    return true;
  }

  // COMPTABILITE: Écritures autorisées sur finances, proformas, factures, paiements
  if (normRole === ROLES.COMPTABILITE) {
    if (['paiements', 'proformas', 'factures', 'finances'].includes(m)) {
      if (act === 'delete') return false;
      return true;
    }
    if (['clients', 'abonnements'].includes(m)) {
      return act === 'read';
    }
    return act === 'read';
  }

  // SECRETAIRE: Écritures autorisées sur dossiers administratifs
  if (normRole === ROLES.SECRETAIRE) {
    const writeAllowed = ['clients', 'eleves', 'abonnements', 'reservations', 'plannings', 'prospects', 'notifications', 'proformas'];
    if (writeAllowed.includes(m)) {
      if (act === 'delete') return false;
      return true;
    }
    if (['vehicules', 'chauffeurs', 'factures', 'paiements'].includes(m)) {
      return act === 'read';
    }
    return act === 'read';
  }

  // OPERATIONS: Écritures transport
  if (normRole === ROLES.OPERATIONS) {
    const writeAllowed = ['clients', 'eleves', 'chauffeurs', 'vehicules', 'plannings', 'reservations', 'abonnements', 'prospects', 'notifications'];
    if (writeAllowed.includes(m)) {
      if (act === 'delete') return false;
      return true;
    }
    return act === 'read';
  }

  // CHAUFFEUR: Mise à jour uniquement du statut de son planning (ex: 'Terminé')
  if (normRole === ROLES.CHAUFFEUR) {
    if (m === 'plannings' && act === 'update') return true;
    return act === 'read';
  }

  // CLIENT: Peut créer des réservations et consulter ses pièces
  if (normRole === ROLES.CLIENT) {
    if (m === 'reservations' && act === 'create') return true;
    return act === 'read';
  }

  return false;
}

/**
 * Filtre les données pour les rôles à visibilité restreinte (CHAUFFEUR et CLIENT)
 */
export function filterDataForUser(moduleKey, items, userProfile) {
  if (!Array.isArray(items)) return [];
  if (!userProfile) return items;

  const normRole = normalizeRole(userProfile.role);
  const m = String(moduleKey).toLowerCase().trim();

  // Pour ADMIN, DIRECTION, COMPTABILITE, OPERATIONS, SECRETAIRE, LECTURE_SEULE:
  // Pas de restriction d'isolation au niveau utilisateur individuel
  if (![ROLES.CHAUFFEUR, ROLES.CLIENT].includes(normRole)) {
    return items;
  }

  const userEmail = (userProfile.email || '').toLowerCase();
  const userName = (userProfile.nom || userProfile.name || '').toLowerCase();
  const userPhone = (userProfile.telephone || '').replace(/[^0-9]/g, '');
  const userUid = userProfile.uid || userProfile.id || '';

  // Filtrage strict pour CHAUFFEUR
  if (normRole === ROLES.CHAUFFEUR) {
    if (m === 'chauffeurs') {
      return items.filter(c => {
        const cEmail = (c.email || '').toLowerCase();
        const cName = (c.name || c.nom || '').toLowerCase();
        const cPhone = (c.phone || '').replace(/[^0-9]/g, '');
        return cEmail === userEmail || (userName && cName.includes(userName)) || (userPhone && cPhone && cPhone === userPhone);
      });
    }

    if (m === 'vehicules') {
      return items.filter(v => {
        const dName = (v.driver || '').toLowerCase();
        return userName && dName.includes(userName);
      });
    }

    if (m === 'plannings' || m === 'reservations') {
      return items.filter(p => {
        const pDriver = (p.driver || p.chauffeur || '').toLowerCase();
        return userName && pDriver.includes(userName);
      });
    }

    if (m === 'eleves') {
      // Les passagers sur les circuits assignés
      return items.filter(el => {
        const route = (el.route || '').toLowerCase();
        return route.length > 0;
      });
    }

    return [];
  }

  // Filtrage strict pour CLIENT
  if (normRole === ROLES.CLIENT) {
    if (m === 'clients') {
      return items.filter(c => {
        const cEmail = (c.email || '').toLowerCase();
        const cName = (c.name || c.nom || '').toLowerCase();
        const cPhone = (c.phone || '').replace(/[^0-9]/g, '');
        return cEmail === userEmail || (userName && cName.includes(userName)) || (userPhone && cPhone && cPhone === userPhone);
      });
    }

    if (m === 'eleves') {
      return items.filter(el => {
        const pName = (el.client || el.parent || '').toLowerCase();
        return userName && pName.includes(userName);
      });
    }

    if (m === 'abonnements' || m === 'reservations' || m === 'paiements' || m === 'factures' || m === 'proformas') {
      return items.filter(doc => {
        const cName = (doc.client || '').toLowerCase();
        const cEmail = (doc.email || '').toLowerCase();
        return (userName && cName.includes(userName)) || (userEmail && cEmail === userEmail);
      });
    }

    return [];
  }

  return items;
}

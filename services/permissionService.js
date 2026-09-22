/**
 * Service de gestion des Rôles et Permissions pour le Centre de Contrôle LAPERLE TOUR HT
 * Système Multi-Rôles avec permissions cumulatives
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
export const SUPER_ADMIN_EMAILS = [
  'castimamoise@gmail.com',
  'castimaklik@gmail.com',
  'laperletourht@gmail.com',
  'aperletourht@gmail.com'
];
export const SUPER_ADMIN_PHONES = [
  '+509 4440 8687',
  '+50944408687',
  '50944408687',
  '44408687',
  '4440-8687'
];

export function isSuperAdminEmail(email) {
  if (!email) return false;
  const e = String(email).toLowerCase().trim();
  return SUPER_ADMIN_EMAILS.includes(e) || e === SUPER_ADMIN_EMAIL.toLowerCase() || e === 'castimaklik@gmail.com';
}

export function isSuperAdminIdentifier(val) {
  if (!val) return false;
  if (isSuperAdminEmail(val)) return true;
  const digits = String(val).replace(/\D/g, '');
  if (digits.length >= 8 && digits.endsWith('44408687')) return true;
  return false;
}

/**
 * Normalise un rôle unique en minuscule
 */
export function normalizeRole(role) {
  if (!role) return ROLES.LECTURE_SEULE;
  const r = String(role).toLowerCase().trim();
  if (r === 'admin' || r === 'administrateur') return ROLES.ADMIN;
  if (r === 'direction') return ROLES.DIRECTION;
  if (r === 'comptabilite' || r === 'comptabilité') return ROLES.COMPTABILITE;
  if (r === 'secretaire' || r === 'secrétaire' || r === 'secrétariat') return ROLES.SECRETAIRE;
  if (r === 'operations' || r === 'opérations') return ROLES.OPERATIONS;
  if (r === 'chauffeur') return ROLES.CHAUFFEUR;
  if (r === 'client') return ROLES.CLIENT;
  return ROLES.LECTURE_SEULE;
}

/**
 * Normalise un ensemble de rôles (tableau ou objet profil)
 * Règle impérative : Si un rôle métier est attribué, lecture_seule est automatiquement retiré.
 */
export function normalizeRoles(rolesInput, singleRoleFallback = null) {
  let list = [];

  if (Array.isArray(rolesInput)) {
    list = rolesInput;
  } else if (rolesInput && typeof rolesInput === 'object') {
    if (Array.isArray(rolesInput.roles) && rolesInput.roles.length > 0) {
      list = rolesInput.roles;
    } else if (rolesInput.role) {
      list = [rolesInput.role];
    }
  } else if (typeof rolesInput === 'string' && rolesInput.trim().length > 0) {
    list = [rolesInput];
  }

  // Fallback si la liste est vide
  if (list.length === 0 && singleRoleFallback) {
    list = Array.isArray(singleRoleFallback) ? singleRoleFallback : [singleRoleFallback];
  }

  // Normalisation individuelle et déduplication
  const validRoles = Object.values(ROLES);
  const normalized = Array.from(new Set(
    list
      .map(r => normalizeRole(r))
      .filter(r => validRoles.includes(r))
  ));

  // Si l'utilisateur possède au moins un rôle métier (autre que lecture_seule),
  // on retire impérativement 'lecture_seule'.
  const businessRoles = normalized.filter(r => r !== ROLES.LECTURE_SEULE);
  if (businessRoles.length > 0) {
    return businessRoles;
  }

  // Si aucun rôle métier n'est défini, le rôle par défaut est lecture_seule
  return [ROLES.LECTURE_SEULE];
}

/**
 * Normalise le statut utilisateur
 */
export function normalizeStatus(status) {
  if (!status) return 'actif';
  const s = String(status).toLowerCase().trim();
  return s === 'inactif' || s === 'disabled' || s === 'bloqué' || s === 'suspendu' ? 'inactif' : 'actif';
}

export const BUSINESS_ROLES = [
  ROLES.ADMIN,
  ROLES.DIRECTION,
  ROLES.COMPTABILITE,
  ROLES.SECRETAIRE,
  ROLES.OPERATIONS,
  ROLES.CHAUFFEUR,
  ROLES.CLIENT
];

/**
 * Vérifie si l'utilisateur possède au moins un rôle métier actif
 */
export function hasBusinessRole(rolesOrUser) {
  const roles = normalizeRoles(rolesOrUser);
  return roles.some(r => BUSINESS_ROLES.includes(r));
}

/**
 * Vérifie l'accès d'un rôle individuel à un module
 */
function roleCanAccessModule(normRole, m) {
  if (normRole === ROLES.ADMIN) return true;

  if (normRole === ROLES.DIRECTION) {
    return m !== 'utilisateurs';
  }

  if (normRole === ROLES.COMPTABILITE) {
    const allowed = [
      'dashboard', 'reports', 'paiements', 'proformas', 
      'factures', 'finances', 'clients', 'abonnements', 'notifications'
    ];
    return allowed.includes(m);
  }

  if (normRole === ROLES.SECRETAIRE) {
    const allowed = [
      'dashboard', 'clients', 'eleves', 'abonnements', 
      'reservations', 'plannings', 'chauffeurs', 'vehicules', 
      'prospects', 'notifications', 'proformas', 'factures', 'paiements', 'utilisateurs'
    ];
    return allowed.includes(m);
  }

  if (normRole === ROLES.OPERATIONS) {
    const allowed = [
      'dashboard', 'clients', 'eleves', 'chauffeurs', 
      'vehicules', 'plannings', 'reservations', 'abonnements', 
      'prospects', 'notifications'
    ];
    return allowed.includes(m);
  }

  if (normRole === ROLES.CHAUFFEUR) {
    const allowed = [
      'dashboard', 'plannings', 'vehicules', 'reservations', 
      'eleves', 'notifications', 'profile'
    ];
    return allowed.includes(m);
  }

  if (normRole === ROLES.CLIENT) {
    const allowed = [
      'dashboard', 'reservations', 'abonnements', 'eleves', 
      'factures', 'proformas', 'paiements', 'notifications', 'profile'
    ];
    return allowed.includes(m);
  }

  if (normRole === ROLES.LECTURE_SEULE) {
    // Un utilisateur avec uniquement lecture_seule ne voit PAS le Dashboard et ne voit AUCUN module métier.
    // Il voit uniquement son profil.
    return m === 'profile' || m === 'profil';
  }

  return false;
}

/**
 * Vérifie si l'utilisateur (avec ses multi-rôles) a accès au module
 * Les permissions sont cumulatives sur l'ensemble de ses rôles.
 */
export function canAccessModule(rolesOrUser, moduleKey, permissions = {}) {
  const roles = normalizeRoles(rolesOrUser);
  const m = String(moduleKey).toLowerCase().trim();

  // Permission individuelle restrictive explicite
  if (permissions && permissions[m]) {
    const perm = permissions[m];
    if (perm === 'none') return false;
    if (perm === 'read' || perm === 'read_write') return true;
  }

  // Si l'un des rôles autorise le module, accès accordé
  return roles.some(role => roleCanAccessModule(role, m));
}

/**
 * Vérifie l'action autorisée pour un rôle unique
 */
function roleHasAction(normRole, m, act) {
  if (normRole === ROLES.ADMIN) return true;

  if (normRole === ROLES.LECTURE_SEULE) {
    return act === 'read';
  }

  if (normRole === ROLES.DIRECTION) {
    if (m === 'utilisateurs' || m === 'settings') return act === 'read';
    if (act === 'delete') return false;
    return true;
  }

  if (normRole === ROLES.COMPTABILITE) {
    if (['paiements', 'proformas', 'factures', 'finances'].includes(m)) {
      if (act === 'delete') return false;
      return true;
    }
    if (['clients', 'abonnements', 'dashboard', 'reports'].includes(m)) {
      return act === 'read';
    }
    return act === 'read';
  }

  if (normRole === ROLES.SECRETAIRE) {
    const writeAllowed = [
      'clients', 'eleves', 'abonnements', 'reservations', 
      'plannings', 'prospects', 'notifications', 'proformas', 'utilisateurs'
    ];
    if (writeAllowed.includes(m)) {
      if (act === 'delete') return false;
      return true;
    }
    if (['vehicules', 'chauffeurs', 'factures', 'paiements'].includes(m)) {
      return act === 'read';
    }
    return act === 'read';
  }

  if (normRole === ROLES.OPERATIONS) {
    const writeAllowed = [
      'clients', 'eleves', 'chauffeurs', 'vehicules', 
      'plannings', 'reservations', 'abonnements', 'prospects', 'notifications'
    ];
    if (writeAllowed.includes(m)) {
      if (act === 'delete') return false;
      return true;
    }
    return act === 'read';
  }

  if (normRole === ROLES.CHAUFFEUR) {
    if (m === 'plannings' && act === 'update') return true;
    return act === 'read';
  }

  if (normRole === ROLES.CLIENT) {
    if (m === 'reservations' && act === 'create') return true;
    return act === 'read';
  }

  return false;
}

/**
 * Vérifie si une action spécifique est autorisée pour l'ensemble des multi-rôles
 * Les permissions sont cumulatives.
 */
export function hasActionPermission(rolesOrUser, moduleKey, action, permissions = {}) {
  const roles = normalizeRoles(rolesOrUser);
  const m = String(moduleKey).toLowerCase().trim();
  const act = String(action).toLowerCase().trim();

  // ADMIN: Niveau absolu
  if (roles.includes(ROLES.ADMIN)) return true;

  // Seul ADMIN peut supprimer définitivement
  if (act === 'delete') return false;

  // LECTURE_SEULE strict si c'est le seul rôle
  if (roles.length === 1 && roles[0] === ROLES.LECTURE_SEULE) {
    return act === 'read';
  }

  // Vérification de permission individuelle
  if (permissions && permissions[m]) {
    const p = permissions[m];
    if (p === 'none') return false;
    if (p === 'read') return act === 'read';
    if (p === 'read_write') {
      return act !== 'delete';
    }
  }

  // Cumulative : si N'IMPORTE QUEL rôle autorise l'action, l'action est autorisée
  return roles.some(role => roleHasAction(role, m, act));
}

/**
 * Filtre les données pour les rôles à visibilité restreinte (CHAUFFEUR et CLIENT)
 * Si l'utilisateur possède un rôle administratif ou opérationnel (ex: operations, secretaire),
 * il accède aux données globales sans restriction.
 */
export function filterDataForUser(moduleKey, items, userProfile) {
  if (!Array.isArray(items)) return [];
  if (!userProfile) return items;

  const roles = normalizeRoles(userProfile);
  const m = String(moduleKey).toLowerCase().trim();

  // Si l'utilisateur possède ADMIN, DIRECTION, COMPTABILITE, OPERATIONS, SECRETAIRE ou LECTURE_SEULE
  // alors aucune restriction d'isolation individuelle n'est appliquée
  const hasManagementRole = roles.some(r => [
    ROLES.ADMIN, 
    ROLES.DIRECTION, 
    ROLES.COMPTABILITE, 
    ROLES.OPERATIONS, 
    ROLES.SECRETAIRE, 
    ROLES.LECTURE_SEULE
  ].includes(r));

  if (hasManagementRole) {
    return items;
  }

  const isChauffeur = roles.includes(ROLES.CHAUFFEUR);
  const isClient = roles.includes(ROLES.CLIENT);

  const userEmail = (userProfile.email || '').toLowerCase();
  const userName = (userProfile.nom || userProfile.name || '').toLowerCase();
  const userPhone = (userProfile.telephone || '').replace(/[^0-9]/g, '');
  const userUid = userProfile.uid || userProfile.id || '';

  // Filtrage strict pour CHAUFFEUR uniquement
  if (isChauffeur && !isClient) {
    if (m === 'chauffeurs') {
      return items.filter(c => {
        const cEmail = (c.email || '').toLowerCase();
        const cName = (c.name || c.nom || '').toLowerCase();
        const cPhone = (c.phone || '').replace(/[^0-9]/g, '');
        return c.chauffeurId === userUid || cEmail === userEmail || (userName && cName.includes(userName)) || (userPhone && cPhone && cPhone === userPhone);
      });
    }

    if (m === 'vehicules') {
      return items.filter(v => {
        const dName = (v.driver || '').toLowerCase();
        return v.chauffeurId === userUid || (userName && dName.includes(userName));
      });
    }

    if (m === 'plannings' || m === 'reservations') {
      return items.filter(p => {
        const pDriver = (p.driver || p.chauffeur || '').toLowerCase();
        return p.chauffeurId === userUid || (userName && pDriver.includes(userName));
      });
    }

    if (m === 'eleves') {
      return items.filter(el => {
        const route = (el.route || '').toLowerCase();
        return el.chauffeurId === userUid || route.length > 0;
      });
    }

    return [];
  }

  // Filtrage strict pour CLIENT uniquement
  if (isClient && !isChauffeur) {
    if (m === 'clients') {
      return items.filter(c => {
        const cEmail = (c.email || '').toLowerCase();
        const cName = (c.name || c.nom || '').toLowerCase();
        const cPhone = (c.phone || '').replace(/[^0-9]/g, '');
        return c.clientId === userUid || cEmail === userEmail || (userName && cName.includes(userName)) || (userPhone && cPhone && cPhone === userPhone);
      });
    }

    if (m === 'eleves') {
      return items.filter(el => {
        const pName = (el.client || el.parent || '').toLowerCase();
        return el.clientId === userUid || (userName && pName.includes(userName));
      });
    }

    if (['abonnements', 'reservations', 'paiements', 'factures', 'proformas'].includes(m)) {
      return items.filter(doc => {
        const cName = (doc.client || '').toLowerCase();
        const cEmail = (doc.email || '').toLowerCase();
        return doc.clientId === userUid || (userName && cName.includes(userName)) || (userEmail && cEmail === userEmail);
      });
    }

    return [];
  }

  return items;
}


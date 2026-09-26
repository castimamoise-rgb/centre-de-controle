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
  PROSPECT: 'prospect',
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
  prospect: 'Prospect',
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
  if (r === 'prospect') return ROLES.PROSPECT;
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
  ROLES.CLIENT,
  ROLES.PROSPECT
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
      'dashboard', 'reports', 'clients', 'eleves', 'abonnements', 
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

  if (normRole === ROLES.PROSPECT) {
    // Le PROSPECT peut voir uniquement son propre profil et créer une réservation
    return m === 'profile' || m === 'profil' || m === 'reservations';
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

  if (normRole === ROLES.PROSPECT) {
    if (m === 'reservations' && (act === 'create' || act === 'read')) return true;
    if ((m === 'profile' || m === 'profil') && (act === 'read' || act === 'update')) return true;
    return false;
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
  if (!userProfile) return [];

  const roles = normalizeRoles(userProfile);
  const m = String(moduleKey).toLowerCase().trim();

  // 1. ADMIN & DIRECTION : Vue globale complète de l'entreprise
  if (roles.includes(ROLES.ADMIN) || roles.includes(ROLES.DIRECTION)) {
    return items;
  }

  // 2. COMPTABILITE : Gestion financière, facturation, paiements et clients
  if (roles.includes(ROLES.COMPTABILITE)) {
    // Interdiction d'accès aux modules hors comptabilité
    if (['utilisateurs', 'settings', 'vehicules', 'chauffeurs'].includes(m)) {
      return [];
    }
    return items;
  }

  // 3. SECRÉTAIRE :
  // "le secretaire ne voit pas la finance globale de lentreprise ,mais peut voir le rapport journalier et hebdomadaire"
  if (roles.includes(ROLES.SECRETAIRE)) {
    // Interdiction formelle et absolue des finances globales de l'entreprise
    if (m === 'finances' || m === 'expenses' || m === 'settings') {
      return [];
    }
    // Tous les modules opérationnels & commerciaux sont visibles pour le travail de secrétariat
    return items;
  }

  // 4. OPÉRATIONS TRANSPORT :
  if (roles.includes(ROLES.OPERATIONS)) {
    // Pas d'accès aux finances de l'entreprise ni aux comptes utilisateurs
    if (['finances', 'expenses', 'utilisateurs', 'settings', 'factures', 'proformas', 'paiements'].includes(m)) {
      return [];
    }
    return items;
  }

  // Données d'identité de l'utilisateur pour le filtrage strict
  const userEmail = (userProfile.email || '').toLowerCase().trim();
  const userName = (userProfile.nom || userProfile.name || '').toLowerCase().trim();
  const userPrenom = (userProfile.prenom || '').toLowerCase().trim();
  const userUsername = (userProfile.username || '').toLowerCase().trim();
  const userPhone = (userProfile.telephone || userProfile.phone || '').replace(/[^0-9]/g, '');
  const userUid = userProfile.uid || userProfile.id || '';

  // Helper pour vérifier si un document appartient à ce CLIENT
  function matchesClientDoc(doc) {
    if (!doc) return false;
    // 1. Concordance directe sur les identifiants UID / ID
    if (userUid && (doc.clientId === userUid || doc.uid === userUid || doc.id === userUid)) return true;
    // 2. Concordance sur l'adresse e-mail
    if (userEmail) {
      const docEmail = String(doc.email || doc.clientEmail || '').toLowerCase().trim();
      if (docEmail && docEmail === userEmail) return true;
    }
    // 3. Concordance sur le numéro de téléphone
    if (userPhone && userPhone.length >= 8) {
      const docPhone = String(doc.phone || doc.telephone || '').replace(/[^0-9]/g, '');
      if (docPhone && (docPhone === userPhone || docPhone.endsWith(userPhone) || userPhone.endsWith(docPhone))) return true;
    }
    // 4. Concordance sur le Nom / Nom de profil
    const docClient = String(doc.client || doc.name || doc.nom || doc.parent || '').toLowerCase().trim();
    if (docClient) {
      if (userName && (docClient === userName || docClient.includes(userName) || userName.includes(docClient))) return true;
      if (userPrenom && userPrenom.length >= 3 && docClient.includes(userPrenom)) return true;
      if (userUsername && docClient.includes(userUsername)) return true;
    }
    return false;
  }

  // Helper pour vérifier si un document est attribué à ce CHAUFFEUR
  function matchesChauffeurDoc(doc) {
    if (!doc) return false;
    // 1. Concordance directe sur les identifiants chauffeurId / driverId
    if (userUid && (doc.chauffeurId === userUid || doc.driverId === userUid || doc.uid === userUid || doc.id === userUid)) return true;
    // 2. Concordance sur l'adresse e-mail
    if (userEmail) {
      const docEmail = String(doc.email || '').toLowerCase().trim();
      if (docEmail && docEmail === userEmail) return true;
    }
    // 3. Concordance sur le téléphone
    if (userPhone && userPhone.length >= 8) {
      const docPhone = String(doc.phone || doc.telephone || '').replace(/[^0-9]/g, '');
      if (docPhone && (docPhone === userPhone || docPhone.endsWith(userPhone) || userPhone.endsWith(docPhone))) return true;
    }
    // 4. Concordance sur le champ chauffeur / driver
    const docDriver = String(doc.driver || doc.chauffeur || doc.name || doc.nom || '').toLowerCase().trim();
    if (docDriver) {
      if (userName && (docDriver === userName || docDriver.includes(userName) || userName.includes(docDriver))) return true;
      if (userPrenom && userPrenom.length >= 3 && docDriver.includes(userPrenom)) return true;
    }
    return false;
  }

  // 5. CHAUFFEUR : voit UNIQUEMENT les courses et véhicules qui lui sont attribués
  if (roles.includes(ROLES.CHAUFFEUR)) {
    if (['plannings', 'reservations', 'vehicules', 'chauffeurs'].includes(m)) {
      return items.filter(matchesChauffeurDoc);
    }
    if (m === 'eleves') {
      return items.filter(el => matchesChauffeurDoc(el) || (el.route && el.route.length > 0 && matchesChauffeurDoc({ driver: el.driver })));
    }
    if (m === 'notifications') {
      return items.filter(n => matchesChauffeurDoc(n) || n.targetUid === userUid || n.forRole === 'chauffeur');
    }
    // Aucun accès aux finances, factures, proformas, clients généraux, etc.
    return [];
  }

  // 6. CLIENT : voit UNIQUEMENT ce qui lui est attribué (Factures, Réservations, Abonnements, etc.)
  // "par exemple un client ne peux pas voir la facture ou la reservation dun autre client ni la finance de lentreprise"
  if (roles.includes(ROLES.CLIENT)) {
    if (['reservations', 'abonnements', 'eleves', 'factures', 'proformas', 'paiements', 'clients'].includes(m)) {
      return items.filter(matchesClientDoc);
    }
    if (m === 'notifications') {
      return items.filter(n => matchesClientDoc(n) || n.targetUid === userUid || n.forRole === 'client');
    }
    // Aucune finance d'entreprise, aucun autre client, aucun véhicule, chauffeur, utilisateur
    return [];
  }

  // 7. PROSPECT : voit UNIQUEMENT ses propres réservations et son profil
  if (roles.includes(ROLES.PROSPECT)) {
    if (m === 'reservations') {
      return items.filter(matchesClientDoc);
    }
    return [];
  }

  // 8. LECTURE_SEULE strict : aucun accès aux modules métier
  return [];
}


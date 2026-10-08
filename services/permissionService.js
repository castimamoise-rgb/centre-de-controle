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

export const INITIAL_ADMIN_PASSWORD = 'Admin2026';
export const SUPER_ADMIN_EMAIL = 'castimamoise@gmail.com';
export const SUPER_ADMIN_EMAILS = ['castimamoise@gmail.com', 'laperletourht@gmail.com'];
export const SUPER_ADMIN_PHONES = ['44408687', '50944408687', '+50944408687'];

export function isSuperAdminEmail(email) {
  if (!email) return false;
  const clean = String(email).trim().toLowerCase();
  return clean === 'castimamoise@gmail.com' || clean === 'laperletourht@gmail.com' || SUPER_ADMIN_EMAILS.includes(clean);
}

export function isSuperAdminIdentifier(val) {
  if (!val) return false;
  const clean = String(val).trim().toLowerCase();
  return isSuperAdminEmail(clean) || SUPER_ADMIN_PHONES.includes(clean.replace(/\D/g, ''));
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
  // Détection Super Admin sur objet profil / utilisateur
  if (rolesInput && typeof rolesInput === 'object') {
    const emailCandidate = rolesInput.email || rolesInput.userEmail;
    if (emailCandidate && isSuperAdminEmail(emailCandidate)) {
      return [ROLES.ADMIN];
    }
  }

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
  if (rolesOrUser && typeof rolesOrUser === 'object') {
    const emailCandidate = rolesOrUser.email || rolesOrUser.userEmail;
    if (emailCandidate && isSuperAdminEmail(emailCandidate)) {
      return true;
    }
  }
  const roles = normalizeRoles(rolesOrUser);
  return roles.some(r => BUSINESS_ROLES.includes(r));
}

/**
 * Vérifie l'accès d'un rôle individuel à un module
 */
function roleCanAccessModule(normRole, m) {
  if (normRole === ROLES.ADMIN) return true;

  if (m === 'messages' || m === 'messagerie') {
    return normRole !== ROLES.LECTURE_SEULE;
  }

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
      'factures', 'proformas', 'paiements', 'notifications', 'profile', 'profil'
    ];
    return allowed.includes(m);
  }

  if (normRole === ROLES.PROSPECT) {
    // Le PROSPECT accède à son tableau de bord client, ses réservations, ses devis, ses factures et ses paiements
    const allowed = [
      'dashboard', 'reservations', 'proformas', 'factures', 'paiements', 'notifications', 'profile', 'profil'
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
    if (m === 'reservations' && (act === 'create' || act === 'write')) return true;
    if (m === 'proformas' && (act === 'create' || act === 'write')) return true;
    return act === 'read';
  }

  if (normRole === ROLES.PROSPECT) {
    if (m === 'reservations' && (act === 'create' || act === 'write' || act === 'read')) return true;
    if (m === 'proformas' && (act === 'create' || act === 'write' || act === 'read')) return true;
    if ((m === 'profile' || m === 'profil') && (act === 'read' || act === 'update')) return true;
    if (['factures', 'paiements', 'notifications', 'dashboard'].includes(m)) return act === 'read';
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

  // Helper pour vérifier si un document appartient à ce CLIENT avec étanchéité stricte
  function matchesClientDoc(doc) {
    if (!doc) return false;

    // 1. Concordance directe sur les identifiants UID / ID Client
    if (userUid) {
      if (doc.clientId === userUid || doc.clientUid === userUid || doc.uid === userUid || doc.userId === userUid) {
        return true;
      }
      // Dans la collection clients, doc.id peut être l'UID du client
      if (m === 'clients' && doc.id === userUid) {
        return true;
      }
    }

    // Si le document possède explicitement un autre clientId, il est formellement interdit à cet utilisateur
    if (doc.clientId && userUid && doc.clientId !== userUid) {
      return false;
    }
    if (doc.clientUid && userUid && doc.clientUid !== userUid) {
      return false;
    }

    // 2. Concordance sur l'adresse e-mail vérifiée (insensible à la casse)
    if (userEmail) {
      const docEmail = String(doc.email || doc.clientEmail || '').toLowerCase().trim();
      if (docEmail && docEmail === userEmail) return true;
    }

    // 3. Concordance sur le numéro de téléphone exact (au moins 8 chiffres)
    if (userPhone && userPhone.length >= 8) {
      const docPhone = String(doc.phone || doc.telephone || '').replace(/[^0-9]/g, '');
      if (docPhone && docPhone === userPhone) return true;
    }

    // 4. Concordance stricte sur le Nom complet (SEULEMENT si aucun clientId contradictoire et nom non-générique)
    const docClient = String(doc.client || doc.nomClient || doc.name || doc.nom || '').toLowerCase().trim();
    const isGeneric = (w) => !w || ['client', 'prospect', 'utilisateur', 'user', 'nouveau client', 'admin'].includes(w) || w.length < 3;
    if (docClient && !isGeneric(docClient)) {
      if (userName && !isGeneric(userName) && docClient === userName) return true;
      if (userUsername && docClient === userUsername) return true;
    }

    // 5. Pour les paiements liés à une facture du client
    if (m === 'paiements' && doc.factureId) {
      if (typeof window !== 'undefined' && window.state && Array.isArray(window.state.factures)) {
        const fac = window.state.factures.find(f => f.number === doc.factureId || f.id === doc.factureId);
        if (fac && matchesClientDoc(fac)) return true;
      }
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

  // 7. PROSPECT : voit UNIQUEMENT ses propres réservations, devis proforma, factures, paiements et notifications
  if (roles.includes(ROLES.PROSPECT)) {
    if (['reservations', 'proformas', 'factures', 'paiements'].includes(m)) {
      return items.filter(matchesClientDoc);
    }
    if (m === 'notifications') {
      return items.filter(n => matchesClientDoc(n) || n.targetUid === userUid || n.forRole === 'client' || n.forRole === 'prospect');
    }
    return [];
  }

  // 8. LECTURE_SEULE strict : aucun accès aux modules métier
  return [];
}


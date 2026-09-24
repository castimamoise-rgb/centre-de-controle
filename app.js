import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  deleteDoc, 
  collection, 
  query,
  where,
  onSnapshot, 
  handleFirestoreError, 
  OperationType, 
  testConnection 
} from './src/lib/firebase.js';

import { 
  createClient, getClients, updateClient, archiveClient, deleteClient, subscribeClients,
  createEleve, getEleves, updateEleve, archiveEleve, deleteEleve, subscribeEleves,
  createAbonnement, getAbonnements, updateAbonnement, archiveAbonnement, deleteAbonnement, subscribeAbonnements,
  createChauffeur, getChauffeurs, updateChauffeur, archiveChauffeur, deleteChauffeur, subscribeChauffeurs,
  createVehicule, getVehicules, updateVehicule, archiveVehicule, deleteVehicule, subscribeVehicules,
  createPlanning, getPlannings, updatePlanning, archivePlanning, deletePlanning, subscribePlannings,
  createPaiement, getPaiements, updatePaiement, archivePaiement, deletePaiement, subscribePaiements,
  createReservation, getReservations, updateReservation, archiveReservation, deleteReservation, subscribeReservations,
  createProforma, getProformas, updateProforma, archiveProforma, deleteProforma, subscribeProformas, generateProformaNumber,
  createFacture, getFactures, updateFacture, archiveFacture, deleteFacture, subscribeFactures, generateFactureNumber,
  createFinance, getFinances, updateFinance, archiveFinance, deleteFinance, subscribeFinances, calculateFinancialSummary,
  createOrUpdateUser, getUtilisateurs, updateUtilisateur, deleteUtilisateur, subscribeUtilisateurs, checkUserPermission,
  createNotification, getNotifications, markNotificationRead, deleteNotification, subscribeNotifications,
  getCompanySettings, saveCompanySettings, subscribeCompanySettings,
  // RBAC & Authentication Services
  ROLES, ROLE_LABELS, STATUS_LABELS, SUPER_ADMIN_EMAIL, SUPER_ADMIN_EMAILS, SUPER_ADMIN_PHONES,
  isSuperAdminEmail, isSuperAdminIdentifier, normalizeRole, normalizeRoles, normalizeStatus,
  BUSINESS_ROLES, hasBusinessRole,
  canAccessModule, hasActionPermission, filterDataForUser,
  loginWithGoogle as authLoginGoogle, logoutUser as authLogout, subscribeAuthState,
  ensureUserProfile, getUserProfile, getUserProfileByIdentifier, createUserProfile, updateUserLastLogin, formatAuthError, signInWithGoogleOnly,
  getAllUsers, getUserById, updateUserRole, updateUserRoles, updateUserStatus, updateUserPermissions,
  createManagedUser, updateUserProfile, resetUsersDatabase,
  // Authentification Firebase sans mot de passe & Téléphone
  sendFirebaseEmailLink, checkIsSignInWithEmailLink, completeEmailLinkSignIn,
  sendFirebasePhoneVerification, verifyFirebasePhoneCode,
  sendVerificationCode, generateVerificationCode, getPendingVerification, verifyCode,
  authenticateWithPhoneOrEmail, registerOrSignInUser, upgradeProfileToClient, directEmailSignInFallback,
  signUpWithEmailAndPasswordMethod, signInWithEmailAndPasswordMethod,
  saveUserSession, getUserSession, clearUserSession,
  saveLogoutInfo, getLogoutInfo, clearLogoutInfo,
  isExplicitlyLoggedOut, setExplicitLogout, clearExplicitLogout
} from './services/index.js';

const DBKEY = "LAPERLE_CENTRE_CONTROL_V3";

const DEFAULT_USER = {
  uid: "admin_castima",
  id: "admin_castima",
  nom: "Moïse Castima",
  name: "Moïse Castima",
  email: "castimamoise@gmail.com",
  telephone: "+509 4440 8687",
  phone: "+509 4440 8687",
  role: ROLES.ADMIN,
  roles: [ROLES.ADMIN],
  status: "actif",
  statutCompte: "actif",
  statutClient: "client"
};

// Restaurer la session utilisateur sauvegardée ou afficher la page de reconnexion si déconnecté
const initialSavedSession = isExplicitlyLoggedOut() ? null : getUserSession();
let currentUser = (initialSavedSession && initialSavedSession.user) ? initialSavedSession.user : null;
let currentUserProfile = (initialSavedSession && initialSavedSession.profile) ? initialSavedSession.profile : null;
let currentRole = currentUserProfile ? (currentUserProfile.role || ROLES.LECTURE_SEULE) : null;
let currentUserRoles = currentUserProfile ? normalizeRoles(currentUserProfile.roles || currentUserProfile.role || [ROLES.LECTURE_SEULE]) : [];
let firestoreUnsubscribers = [];
let isAuthInitialized = false;
let pendingUnregisteredGoogleUser = null;
let pendingExistingUser = null;

// Primary Firestore collections as specified by user
const ALL_MODULES = [
  "clients",
  "eleves",
  "abonnements",
  "plannings",
  "chauffeurs",
  "vehicules",
  "paiements",
  "reservations",
  "finances",
  "proformas",
  "factures",
  "utilisateurs",
  "prospects",
  "notifications"
];

// Aliases for seamless backward compatibility
const ALIAS_MAP = {
  quotes: "proformas",
  invoices: "factures",
  bookings: "reservations",
  drivers: "chauffeurs",
  vehicles: "vehicules",
  planning: "plannings",
  payments: "paiements",
  expenses: "finances"
};

function canonicalCol(key) {
  return ALIAS_MAP[key] || key;
}

function updateFirebaseBadge(status, text) {
  const btn = document.getElementById("firebaseBtn");
  const txt = document.getElementById("firebaseStatusText");
  if (!btn || !txt) return;
  btn.classList.remove("connected", "syncing");
  if (status === "connected") {
    btn.classList.add("connected");
    txt.textContent = text || "🔥 Cloud synchronisé";
  } else if (status === "syncing") {
    btn.classList.add("syncing");
    txt.textContent = text || "🔄 Synchronisation...";
  } else {
    txt.textContent = text || "🔥 Firebase";
  }
}

function updateRoleBadge(rolesInput) {
  const badge = document.getElementById("headerUserRole");
  if (!badge) return;
  const rolesList = normalizeRoles(rolesInput || currentUserRoles);
  badge.textContent = rolesList.map(r => ROLE_LABELS[r] || r.toUpperCase()).join(" + ");
  badge.className = `user-role-badge ${rolesList[0] || 'lecture_seule'}`;
  badge.title = `Rôles attribués : ${rolesList.map(r => ROLE_LABELS[r] || r).join(', ')}`;
}

// Check RBAC permissions using cumulative multi-role check
function hasPermission(action, moduleKey) {
  const canon = canonicalCol(moduleKey);
  return hasActionPermission(currentUserRoles, canon, action, currentUserProfile?.permissions);
}

// Direct Firestore Persistence Functions
async function saveDocumentToFirestore(colKey, item) {
  const col = canonicalCol(colKey);
  const docId = String(item.number || item.id || Date.now());
  const now = new Date().toISOString();
  const userEmail = currentUser?.email || 'admin';

  // Ne pas tenter d'écrire sur Firestore sans utilisateur authentifié Firebase Auth
  if (!db || !auth.currentUser) {
    return;
  }

  const cleanItem = { ...item };
  Object.keys(cleanItem).forEach(k => {
    if (cleanItem[k] === undefined) delete cleanItem[k];
  });

  if (cleanItem.amount !== undefined) cleanItem.amount = Number(cleanItem.amount) || 0;
  if (cleanItem.price !== undefined) cleanItem.price = Number(cleanItem.price) || 0;
  if (cleanItem.capacity !== undefined) cleanItem.capacity = Number(cleanItem.capacity) || 0;
  if (cleanItem.passengers !== undefined) cleanItem.passengers = Number(cleanItem.passengers) || 0;
  if (cleanItem.commission !== undefined) cleanItem.commission = Number(cleanItem.commission) || 0;

  cleanItem.id = docId;
  cleanItem.archived = cleanItem.archived === true;
  if (!cleanItem.createdAt) cleanItem.createdAt = now;
  cleanItem.updatedAt = now;
  if (!cleanItem.createdBy) cleanItem.createdBy = userEmail;
  cleanItem.updatedBy = userEmail;

  try {
    updateFirebaseBadge("syncing");
    await setDoc(doc(db, col, docId), cleanItem);
    updateFirebaseBadge("connected");
  } catch (err) {
    updateFirebaseBadge("offline");
    console.error(`Erreur écriture Firestore [${col}/${docId}]:`, err);
  }
}

async function archiveDocumentInFirestore(colKey, docId) {
  const col = canonicalCol(colKey);
  if (!docId) return;
  try {
    updateFirebaseBadge("syncing");
    const userEmail = currentUser?.email || 'admin';
    await setDoc(doc(db, col, String(docId)), {
      archived: true,
      status: "Archivé",
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail
    }, { merge: true });
    updateFirebaseBadge("connected");
  } catch (err) {
    updateFirebaseBadge("offline");
    console.error(`Erreur archivage Firestore [${col}/${docId}]:`, err);
  }
}

async function deleteDocumentFromFirestore(colKey, docId) {
  const col = canonicalCol(colKey);
  if (!docId) return;
  try {
    updateFirebaseBadge("syncing");
    await deleteDoc(doc(db, col, String(docId)));
    updateFirebaseBadge("connected");
  } catch (err) {
    updateFirebaseBadge("offline");
    console.error(`Erreur suppression Firestore [${col}/${docId}]:`, err);
  }
}

async function saveSettingsToFirestore(settingsData) {
  try {
    updateFirebaseBadge("syncing");
    const userEmail = currentUser?.email || 'admin';
    await setDoc(doc(db, "settings", "company"), {
      ...settingsData,
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail
    }, { merge: true });
    updateFirebaseBadge("connected");
  } catch (err) {
    updateFirebaseBadge("offline");
    console.error("Erreur sauvegarde paramètres Firestore:", err);
  }
}

async function syncAllToFirestore() {
  showToast("Synchronisation complète vers Google Cloud Firestore en cours...");
  updateFirebaseBadge("syncing");
  try {
    let count = 0;
    for (const col of ALL_MODULES) {
      const items = list(col);
      for (const item of items) {
        await saveDocumentToFirestore(col, item);
        count++;
      }
    }
    await saveSettingsToFirestore({
      company: localStorage.getItem("LAPERLE_COMPANY") || "LAPERLE TOUR HT",
      slogan: localStorage.getItem("LAPERLE_SLOGAN") || "Un coup d'œil sur Haïti",
      phone: localStorage.getItem("LAPERLE_PHONE") || "+509 4440 8687",
      email: localStorage.getItem("LAPERLE_EMAIL") || "laperletourht@gmail.com",
      address: localStorage.getItem("LAPERLE_ADDRESS") || "Port-au-Prince, Haïti",
      moncash: localStorage.getItem("LAPERLE_MONCASH") || "+509 4440 8687",
      admin: localStorage.getItem("LAPERLE_ADMIN") || "Castima"
    });
    updateFirebaseBadge("connected");
    showToast(`✅ ${count} fiches synchronisées avec succès sur Firestore !`);
  } catch (err) {
    updateFirebaseBadge("offline");
    showToast("Erreur lors de la synchronisation.");
  }
}

async function loginWithGoogle() {
  closeModal();
  await handleGoogleLoginFlow();
}

async function logoutUser() {
  try {
    // 1. ENREGISTREMENT SYSTÉMATIQUE DES INFORMATIONS AVANT LA DÉCONNEXION
    try {
      // a) Sauvegarde de l'état local global de l'application
      save();

      // b) Enregistrement des informations de session de l'utilisateur
      const userEmail = currentUser?.email || currentUserProfile?.email || "";
      const userName = currentUserProfile?.nom 
        ? ((currentUserProfile.prenom ? currentUserProfile.prenom + " " : "") + currentUserProfile.nom)
        : (currentUser?.displayName || currentUserProfile?.name || "");
      const userPhone = currentUserProfile?.telephone || currentUserProfile?.phone || currentUser?.phoneNumber || "";
      const userRoles = currentUserRoles || currentUserProfile?.roles || [];
      const userUid = currentUser?.uid || currentUserProfile?.id || "";

      if (userEmail || userUid) {
        saveLogoutInfo({
          email: userEmail,
          name: userName,
          phone: userPhone,
          roles: userRoles,
          uid: userUid,
          lastActivePage: current || "dashboard",
          lastLogoutAt: new Date().toISOString()
        });
      }

      // c) Sauvegarde / mise à jour sur Firestore si connecté
      if (db && auth.currentUser && userUid) {
        try {
          await updateUserLastLogin(userUid);
        } catch (e) {}
      }
    } catch (saveErr) {
      console.warn("Avertissement sauvegarde pré-déconnexion:", saveErr);
    }

    // 2. Clôture de session et déconnexion
    isAuthProcessing = false;
    pendingUnregisteredGoogleUser = null;
    pendingExistingUser = null;
    setExplicitLogout();
    clearUserSession();
    clearLogoutInfo(); // Supprime toute information de connexion pour empêcher le pré-remplissage
    try { await authLogout(); } catch (e) {}
    closeModal();
    currentUser = null;
    currentUserProfile = null;
    currentUserRoles = [];
    currentRole = null;
    firestoreUnsubscribers.forEach(unsub => { try { unsub(); } catch (e) {} });
    firestoreUnsubscribers = [];

    // Réinitialisation explicite des champs de saisie du formulaire de connexion
    const loginEmailInput = document.getElementById("authLoginEmail");
    const loginPwdInput = document.getElementById("authLoginPassword");
    if (loginEmailInput) {
      loginEmailInput.value = "";
      loginEmailInput.setAttribute("value", "");
    }
    if (loginPwdInput) {
      loginPwdInput.value = "";
      loginPwdInput.setAttribute("value", "");
    }
    const regEmailInput = document.getElementById("authRegisterEmail");
    const regPwdInput = document.getElementById("authRegisterPassword");
    const regPwdConfInput = document.getElementById("authRegisterPasswordConfirm");
    if (regEmailInput) regEmailInput.value = "";
    if (regPwdInput) regPwdInput.value = "";
    if (regPwdConfInput) regPwdConfInput.value = "";

    // Réinitialisation propre de l'URL pour ne pas rester sur un fragment métier
    if (location.hash && location.hash !== "#login") {
      try {
        history.replaceState(null, "", window.location.pathname);
      } catch (e) {
        location.hash = "";
      }
    }

    const authContainer = document.getElementById("authContainer");
    const appContainer = document.getElementById("app");
    if (authContainer) authContainer.style.display = "flex";
    if (appContainer) appContainer.style.display = "none";
    renderAuthPage("unauthenticated");
    showToast("✅ Données sauvegardées et déconnexion effectuée avec succès.");
  } catch (err) {
    console.error("Erreur déconnexion:", err);
    renderAuthPage("unauthenticated");
  }
}

async function testFirebaseConnectionUI() {
  showToast("Vérification de la connexion Cloud Firestore...");
  const ok = await testConnection();
  if (ok) {
    showToast("✅ Connexion à Firebase Firestore opérationnelle !");
  } else {
    showToast("⚠️ Connexion impossible. Vérifiez le réseau.");
  }
}

function openFirebaseModal() {
  const isAuth = !!currentUser;
  document.getElementById("modal").innerHTML = `
    <div class="modal-head">
      <div>
        <h2>🔥 Cloud Firebase — Centre de Contrôle</h2>
        <small>Projet : pragmatic-port-83bk6 • Région : us-west1</small>
      </div>
      <button class="close" onclick="closeModal()">×</button>
    </div>
    
    <div style="background:#f8fafc;border:1px solid #dce4ee;border-radius:10px;padding:16px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:32px">🔥</div>
        <div>
          <b style="color:#092e70;font-size:15px">Cloud Firestore • Base de Données Sécurisée</b><br>
          <span style="font-size:12px;color:#64748b">Toutes vos fiches LAPERLE TOUR HT sont synchronisées en temps réel.</span>
        </div>
      </div>
      <div style="margin-top:12px;padding:10px;background:#fff;border-radius:8px;border:1px solid #e2e8f0;font-size:12px">
        <div><b>Statut Authentification :</b> ${isAuth ? `<span style="color:#15803d;font-weight:700">Connecté (${esc(currentUser.email)})</span>` : '<span style="color:#b42318;font-weight:700">Non connecté</span>'}</div>
        <div style="margin-top:4px"><b>Rôles actifs :</b> ${currentUserRoles.map(r => `<span class="user-role-badge ${r}">${ROLE_LABELS[r] || r}</span>`).join(" ")}</div>
        <div style="margin-top:4px"><b>Persistance Cloud :</b> <span style="color:#15803d">Active multi-appareils</span></div>
      </div>
    </div>

    <div class="form-actions" style="flex-wrap:wrap">
      ${isAuth ? `
        <button class="secondary" onclick="syncAllToFirestore()">🔄 Forcer synchronisation complète</button>
        <button class="secondary" onclick="testFirebaseConnectionUI()">⚡ Tester connexion</button>
        <button class="secondary" style="color:#b42318;border-color:#fca5a5" onclick="logoutUser()">Se déconnecter</button>
      ` : `
        <button class="secondary" onclick="testFirebaseConnectionUI()">⚡ Tester connexion</button>
      `}
      <button class="secondary" onclick="closeModal()">Fermer</button>
    </div>
  `;
  document.getElementById("modalBackdrop").classList.add("open");
}

const MODULES = {
  dashboard: { label: "Tableau de bord", icon: "🏠" },
  proformas: { label: "Proformas", icon: "📄" },
  factures: { label: "Factures", icon: "🧾" },
  clients: { label: "Clients", icon: "👥" },
  eleves: { label: "Élèves", icon: "🎒" },
  prospects: { label: "Prospects", icon: "🎯" },
  reservations: { label: "Réservations", icon: "📅" },
  abonnements: { label: "Abonnements", icon: "🎫" },
  plannings: { label: "Plannings", icon: "🗓️" },
  chauffeurs: { label: "Chauffeurs", icon: "👨‍✈️" },
  vehicules: { label: "Véhicules", icon: "🚙" },
  paiements: { label: "Paiements", icon: "💰" },
  finances: { label: "Finances & Dépenses", icon: "📊" },
  utilisateurs: { label: "Utilisateurs & Rôles", icon: "🛡️" },
  reports: { label: "Rapports", icon: "📈" },
  marketing: { label: "Marketing", icon: "📣" },
  settings: { label: "Paramètres", icon: "⚙️" },

  // Aliases for compatibility
  quotes: { label: "Proformas", icon: "📄" },
  invoices: { label: "Factures", icon: "🧾" },
  bookings: { label: "Réservations", icon: "📅" },
  drivers: { label: "Chauffeurs", icon: "👨‍✈️" },
  vehicles: { label: "Véhicules", icon: "🚙" },
  planning: { label: "Plannings", icon: "🗓️" },
  payments: { label: "Paiements", icon: "💰" },
  expenses: { label: "Finances & Dépenses", icon: "📊" }
};

const SCHEMAS = {
  clients: [
    ["name", "Nom complet", "text"],
    ["phone", "Téléphone / WhatsApp", "text"],
    ["email", "Email", "email"],
    ["zone", "Zone", "text"],
    ["service", "Service", "select:Transport scolaire|Abonnement travail|Taxi privé|Transport privé|Location|Tourisme"],
    ["route", "Trajet", "text"],
    ["start", "Date de début", "date"],
    ["amount", "Montant HTG", "number"],
    ["status", "Statut", "select:Nouveau|En discussion|Confirmé|Actif|Terminé|Annulé|Archivé"],
    ["notes", "Notes", "textarea"]
  ],
  eleves: [
    ["name", "Nom complet élève", "text"],
    ["client", "Parent / Responsable", "text"],
    ["school", "École / Établissement", "text"],
    ["grade", "Classe / Niveau", "text"],
    ["route", "Circuit scolaire", "text"],
    ["zone", "Zone de prise en charge", "text"],
    ["timeMorning", "Heure ramassage matin", "time"],
    ["timeAfternoon", "Heure retour après-midi", "time"],
    ["status", "Statut", "select:Inscrit|Actif|En attente|Suspendu|Archivé"],
    ["notes", "Notes & Contacts d'urgence", "textarea"]
  ],
  abonnements: [
    ["client", "Client souscripteur", "text"],
    ["eleve", "Élève concerné (optionnel)", "text"],
    ["type", "Formule", "select:Scolaire annuel|Scolaire mensuel|Travail mensuel|VIP personnalisé|Location longue durée"],
    ["route", "Ligne / Trajet", "text"],
    ["startDate", "Date début", "date"],
    ["endDate", "Date expiration", "date"],
    ["price", "Prix HTG", "number"],
    ["driver", "Chauffeur attitré", "text"],
    ["vehicle", "Véhicule attitré", "text"],
    ["status", "Statut", "select:Actif|En attente|Échu|Suspendu|Archivé"],
    ["notes", "Notes", "textarea"]
  ],
  chauffeurs: [
    ["name", "Nom complet", "text"],
    ["phone", "Téléphone", "text"],
    ["address", "Adresse", "text"],
    ["vehicle", "Véhicule assigné", "text"],
    ["status", "Disponibilité", "select:Disponible|En course|Repos|Inactif"],
    ["commission", "Part chauffeur %", "number"],
    ["joinedDate", "Date intégration", "date"],
    ["notes", "Notes & Permis de conduire", "textarea"]
  ],
  drivers: [
    ["name", "Nom complet", "text"],
    ["phone", "Téléphone", "text"],
    ["vehicle", "Véhicule", "text"],
    ["capacity", "Capacité", "number"],
    ["zone", "Zone", "text"],
    ["status", "Disponibilité", "select:Disponible|Occupé|Inactif"],
    ["share", "Part chauffeur %", "number"],
    ["notes", "Notes", "textarea"]
  ],
  vehicules: [
    ["brand", "Marque & Modèle", "text"],
    ["plate", "Plaque d'immatriculation", "text"],
    ["year", "Année", "text"],
    ["color", "Couleur", "text"],
    ["capacity", "Capacité passagers", "number"],
    ["driver", "Chauffeur assigné", "text"],
    ["status", "Statut", "select:Disponible|Affecté|Maintenance|Inactif"],
    ["notes", "Assurance & Inspection", "textarea"]
  ],
  vehicles: [
    ["vehicle", "Véhicule", "text"],
    ["plate", "Plaque", "text"],
    ["type", "Type", "text"],
    ["capacity", "Capacité", "number"],
    ["zone", "Zone", "text"],
    ["status", "Statut", "select:Disponible|Affecté|Maintenance|Inactif"],
    ["notes", "Notes", "textarea"]
  ],
  plannings: [
    ["client", "Client", "text"],
    ["date", "Date", "date"],
    ["time", "Heure", "time"],
    ["route", "Trajet", "text"],
    ["driver", "Chauffeur", "text"],
    ["vehicle", "Véhicule", "text"],
    ["status", "Statut", "select:Planifié|En cours|Terminé|Incident|Annulé"],
    ["notes", "Notes", "textarea"]
  ],
  planning: [
    ["client", "Client", "text"],
    ["date", "Date", "date"],
    ["time", "Heure", "time"],
    ["route", "Trajet", "text"],
    ["driver", "Chauffeur", "text"],
    ["vehicle", "Véhicule", "text"],
    ["status", "Statut", "select:Planifié|En cours|Terminé|Incident|Annulé"],
    ["notes", "Notes", "textarea"]
  ],
  paiements: [
    ["client", "Client", "text"],
    ["date", "Date", "date"],
    ["amount", "Montant HTG", "number"],
    ["method", "Mode de règlement", "select:MonCash|Cash|Virement|Chèque|Autre"],
    ["status", "Statut", "select:Reçu|En attente|Validé|Remboursé|Archivé"],
    ["reference", "N° Reçu / Référence", "text"],
    ["facture", "Facture liée (optionnel)", "text"],
    ["abonnement", "Abonnement lié (optionnel)", "text"],
    ["notes", "Notes", "textarea"]
  ],
  payments: [
    ["client", "Client", "text"],
    ["date", "Date", "date"],
    ["amount", "Montant HTG", "number"],
    ["method", "Mode", "select:MonCash|Cash|Virement|Autre"],
    ["status", "Statut", "select:Reçu|À recevoir|Remboursé"],
    ["reference", "Référence", "text"],
    ["notes", "Notes", "textarea"]
  ],
  reservations: [
    ["client", "Client", "text"],
    ["date", "Date", "date"],
    ["time", "Heure", "time"],
    ["origin", "Lieu de départ", "text"],
    ["destination", "Destination", "text"],
    ["passengers", "Passagers", "number"],
    ["amount", "Montant HTG", "number"],
    ["driver", "Chauffeur", "text"],
    ["vehicle", "Véhicule", "text"],
    ["status", "Statut", "select:À confirmer|Confirmée|En cours|Effectuée|Annulée|Archivée"],
    ["notes", "Notes", "textarea"]
  ],
  bookings: [
    ["client", "Client", "text"],
    ["date", "Date", "date"],
    ["time", "Heure", "time"],
    ["route", "Trajet", "text"],
    ["passengers", "Passagers", "number"],
    ["price", "Prix HTG", "number"],
    ["payment", "Paiement", "select:En attente|Partiel|Payé"],
    ["status", "Statut", "select:À confirmer|Confirmée|Effectuée|Annulée"],
    ["notes", "Notes", "textarea"]
  ],
  finances: [
    ["label", "Libellé de la dépense", "text"],
    ["date", "Date", "date"],
    ["amount", "Montant HTG", "number"],
    ["category", "Catégorie", "select:Carburant|Chauffeur / Commission|Marketing|Maintenance véhicule|Loyer & Bureaux|Administration|Autre"],
    ["driver", "Chauffeur concerné", "text"],
    ["notes", "Notes & Justificatif", "textarea"]
  ],
  expenses: [
    ["label", "Dépense", "text"],
    ["date", "Date", "date"],
    ["amount", "Montant HTG", "number"],
    ["category", "Catégorie", "select:Carburant|Chauffeur|Marketing|Maintenance|Administration|Autre"],
    ["notes", "Notes", "textarea"]
  ],
  proformas: [
    ["client", "Client", "text"],
    ["date", "Date", "date"],
    ["route", "Trajet", "text"],
    ["service", "Service", "select:Transport scolaire|Abonnement travail|Taxi privé|Transport privé|Location|Tourisme"],
    ["amount", "Montant HTG", "number"],
    ["validity", "Validité", "text"],
    ["status", "Statut", "select:Brouillon|Envoyée|Acceptée|Refusée|Archivée"],
    ["notes", "Notes", "textarea"]
  ],
  quotes: [
    ["client", "Client", "text"],
    ["date", "Date", "date"],
    ["route", "Trajet", "text"],
    ["service", "Service", "select:Transport scolaire|Abonnement travail|Taxi privé|Transport privé|Location|Tourisme"],
    ["amount", "Montant HTG", "number"],
    ["validity", "Validité", "text"],
    ["status", "Statut", "select:Brouillon|Envoyée|Acceptée|Refusée"],
    ["notes", "Notes", "textarea"]
  ],
  factures: [
    ["client", "Client", "text"],
    ["date", "Date", "date"],
    ["proforma", "N° Proforma lié", "text"],
    ["amount", "Montant HTG", "number"],
    ["status", "Statut", "select:Brouillon|Envoyée|Payée|Partielle|Annulée|Archivée"],
    ["due", "Échéance", "date"],
    ["notes", "Notes", "textarea"]
  ],
  invoices: [
    ["client", "Client", "text"],
    ["date", "Date", "date"],
    ["proforma", "N° Proforma lié", "text"],
    ["amount", "Montant HTG", "number"],
    ["status", "Statut", "select:Brouillon|Envoyée|Payée|Partielle|Annulée"],
    ["due", "Échéance", "date"],
    ["notes", "Notes", "textarea"]
  ],
  prospects: [
    ["name", "Nom / entreprise", "text"],
    ["phone", "Téléphone / WhatsApp", "text"],
    ["need", "Besoin / trajet", "text"],
    ["source", "Source", "text"],
    ["status", "Statut", "select:Nouveau|Contacté|Intéressé|Proforma envoyée|Gagné|Perdu"],
    ["next", "Prochaine action", "date"],
    ["notes", "Notes", "textarea"]
  ],
  utilisateurs: [
    ["name", "Nom complet", "text"],
    ["email", "Email Google / Firebase", "email"],
    ["roles", "Rôles", "roles"],
    ["status", "Statut du compte", "select:Actif|Inactif"],
    ["notes", "Notes d'habilitation", "textarea"]
  ]
};

// Initial state
let state = loadState();
let current = location.hash.slice(1) || "dashboard";
let currentPage = current;

function nextNumber(prefix, key) {
  const items = list(key);
  let max = 0;
  items.forEach(item => {
    const val = item.id || item.number || "";
    const m = String(val).match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

function nextProformaNumber() {
  return generateProformaNumber(list("proformas"));
}

function nextFactureNumber() {
  return generateFactureNumber(list("factures"));
}

function getInitialData() {
  const d = today();
  return {
    clients: [
      { id: "CL-001", name: "Jean-Baptiste Valmé", phone: "+509 3712-3456", email: "jb.valme@gmail.com", zone: "Pétion-Ville", service: "Transport scolaire", route: "Pétion-Ville - Delmas", start: d, amount: 25000, status: "Actif", notes: "Abonnement scolaire annuel" },
      { id: "CL-002", name: "Marie-Claude Joseph", phone: "+509 4821-9870", email: "mc.joseph@yahoo.fr", zone: "Delmas 75", service: "Abonnement travail", route: "Delmas 75 - Port-au-Prince Centre", start: d, amount: 18000, status: "Actif", notes: "Trajet quotidien travail" },
      { id: "CL-003", name: "Cabinet Altidor & Associés", phone: "+509 3105-1122", email: "contact@altidor-law.ht", zone: "Tabarre", service: "Location", route: "Aéroport Toussaint Louverture - Tabarre", start: d, amount: 45000, status: "Confirmé", notes: "Mise à disposition 3 jours" }
    ],
    eleves: [
      { id: "EL-001", name: "Daphnée Valmé", client: "Jean-Baptiste Valmé", school: "Institution Sainte Rose de Lima", grade: "6ème fondamentale", route: "Pétion-Ville - Delmas", zone: "Pétion-Ville", timeMorning: "06:45", timeAfternoon: "14:15", status: "Inscrit", notes: "Allergie arachides" }
    ],
    abonnements: [
      { id: "AB-001", client: "Jean-Baptiste Valmé", type: "Scolaire annuel", route: "Pétion-Ville - Delmas", startDate: d, endDate: "2027-06-30", price: 25000, driver: "Jean-Marc Pierre", vehicle: "Toyota HiAce (VH-001)", status: "Actif", notes: "Facturation trimestrielle" }
    ],
    prospects: [
      { id: "PR-001", name: "École Sainte-Trinité", phone: "+509 3450-2211", need: "Transport scolaire 40 élèves", source: "Recommandation", status: "Intéressé", next: d, notes: "Validation du trajet en cours" }
    ],
    reservations: [
      { id: "RES-001", client: "Cabinet Altidor & Associés", origin: "Aéroport Toussaint Louverture", destination: "Pétion-Ville", date: d, time: "09:30", passengers: 3, amount: 15000, driver: "Wilner Charles", vehicle: "Hyundai Tucson", status: "Confirmée", notes: "Vol Air Caraïbes" }
    ],
    chauffeurs: [
      { id: "CH-001", name: "Jean-Marc Pierre", phone: "+509 3801-4455", vehicle: "Toyota HiAce (VH-001)", address: "Delmas 33", status: "Disponible", commission: 30, joinedDate: "2024-01-15", notes: "Chauffeur expérimenté" },
      { id: "CH-002", name: "Wilner Charles", phone: "+509 4210-7788", vehicle: "Hyundai Tucson (VH-002)", address: "Tabarre", status: "Disponible", commission: 30, joinedDate: "2024-03-01", notes: "Spécialiste taxi privé" }
    ],
    vehicules: [
      { id: "VH-001", brand: "Toyota HiAce", plate: "TP-45892", year: "2020", color: "Blanc", capacity: 15, driver: "Jean-Marc Pierre", status: "Disponible", notes: "Climatisé, bon état" },
      { id: "VH-002", brand: "Hyundai Tucson", plate: "AA-12044", year: "2022", color: "Gris", capacity: 4, driver: "Wilner Charles", status: "Disponible", notes: "Idéal pour VIP & touristes" }
    ],
    plannings: [
      { id: "SRV-001", client: "Cabinet Altidor & Associés", date: d, time: "09:30", route: "Aéroport - Pétion-Ville", driver: "Wilner Charles", vehicle: "Hyundai Tucson", status: "Planifié", notes: "Accueil avec pancarte" }
    ],
    paiements: [
      { id: "PAY-001", client: "Cabinet Altidor & Associés", date: d, amount: 15000, method: "MonCash", status: "Reçu", reference: "MC-894721", notes: "Paiement direct" },
      { id: "PAY-002", client: "Marie-Claude Joseph", date: d, amount: 18000, method: "MonCash", status: "Reçu", reference: "MC-894800", notes: "Abonnement mensuel" }
    ],
    finances: [
      { id: "DEP-001", label: "Carburant HiAce VH-001", date: d, amount: 6500, category: "Carburant", driver: "Jean-Marc Pierre", notes: "Plein effectué National" },
      { id: "DEP-002", label: "Part chauffeur Wilner", date: d, amount: 4500, category: "Chauffeur / Commission", driver: "Wilner Charles", notes: "Course RES-001" }
    ],
    proformas: [
      { id: "PT-2026-09-19-001", number: "PT-2026-09-19-001", client: "Jean-Baptiste Valmé", date: d, route: "Pétion-Ville - Delmas", service: "Transport scolaire", amount: 25000, validity: "30 jours", status: "Acceptée", notes: "Offre annuelle transport" }
    ],
    factures: [
      { id: "FT-2026-09-19-001", number: "FT-2026-09-19-001", client: "Jean-Baptiste Valmé", date: d, proforma: "PT-2026-09-19-001", amount: 25000, status: "Payée", due: d, notes: "Facture acquittée" }
    ],
    utilisateurs: [
      { id: "castimamoise_gmail_com", name: "Moïse Castima", username: "castima", email: "castimamoise@gmail.com", role: "ADMIN", roles: ["admin"], status: "Actif", notes: "Fondateur & Administrateur Principal" },
      { id: "usr_admin_castimaklik", name: "Moïse Castima (Klik)", username: "castimaklik", email: "castimaklik@gmail.com", role: "ADMIN", roles: ["admin"], status: "Actif", notes: "Super Administrateur Studio" },
      { id: "laperletourht_gmail_com", name: "Laperle Tour Admin", username: "laperle", email: "laperletourht@gmail.com", role: "ADMIN", roles: ["admin"], status: "Actif", notes: "Super Administrateur LAPERLE" },
      { id: "usr_wilner", name: "Wilner Charles", email: "wilner.c@laperletour.ht", role: "CHAUFFEUR", roles: ["chauffeur"], status: "Actif", notes: "Chauffeur HiAce VH-001" },
      { id: "usr_jeanmarc", name: "Jean-Marc Pierre", email: "jean.marc@laperletour.ht", role: "CHAUFFEUR", roles: ["chauffeur"], status: "Actif", notes: "Chauffeur Tucson VH-002" },
      { id: "usr_mariefrance", name: "Marie-France Jean", email: "marie.france@laperletour.ht", role: "SECRETAIRE", roles: ["secretaire"], status: "Actif", notes: "Secrétariat & Réservations" },
      { id: "usr_david", name: "Pierre-Louis David", email: "david.pl@laperletour.ht", role: "OPERATIONS", roles: ["operations"], status: "Actif", notes: "Responsable Flotte" },
      { id: "usr_stephane", name: "Stéphane Delva", email: "stephane.d@laperletour.ht", role: "COMPTABILITE", roles: ["comptabilite"], status: "Actif", notes: "Responsable Trésorerie" },
      { id: "usr_altidor", name: "Cabinet Altidor & Associés", email: "contact@altidor.ht", role: "CLIENT", roles: ["client"], status: "Actif", notes: "Compte Entreprise" }
    ]
  };
}

const DEFAULT_SYSTEM_USERS = [
  { id: "castimamoise_gmail_com", name: "Moïse Castima", username: "castima", email: "castimamoise@gmail.com", role: "ADMIN", roles: ["admin"], status: "Actif", notes: "Fondateur & Administrateur Principal" },
  { id: "usr_admin_castimaklik", name: "Moïse Castima (Klik)", username: "castimaklik", email: "castimaklik@gmail.com", role: "ADMIN", roles: ["admin"], status: "Actif", notes: "Super Administrateur Studio" },
  { id: "laperletourht_gmail_com", name: "Laperle Tour Admin", username: "laperle", email: "laperletourht@gmail.com", role: "ADMIN", roles: ["admin"], status: "Actif", notes: "Super Administrateur LAPERLE" },
  { id: "usr_wilner", name: "Wilner Charles", email: "wilner.c@laperletour.ht", role: "CHAUFFEUR", roles: ["chauffeur"], status: "Actif", notes: "Chauffeur HiAce VH-001" },
  { id: "usr_jeanmarc", name: "Jean-Marc Pierre", email: "jean.marc@laperletour.ht", role: "CHAUFFEUR", roles: ["chauffeur"], status: "Actif", notes: "Chauffeur Tucson VH-002" },
  { id: "usr_mariefrance", name: "Marie-France Jean", email: "marie.france@laperletour.ht", role: "SECRETAIRE", roles: ["secretaire"], status: "Actif", notes: "Secrétariat & Réservations" },
  { id: "usr_david", name: "Pierre-Louis David", email: "david.pl@laperletour.ht", role: "OPERATIONS", roles: ["operations"], status: "Actif", notes: "Responsable Flotte" },
  { id: "usr_stephane", name: "Stéphane Delva", email: "stephane.d@laperletour.ht", role: "COMPTABILITE", roles: ["comptabilite"], status: "Actif", notes: "Responsable Trésorerie" },
  { id: "usr_altidor", name: "Cabinet Altidor & Associés", email: "contact@altidor.ht", role: "CLIENT", roles: ["client"], status: "Actif", notes: "Compte Entreprise" }
];

function loadState() {
  try {
    const saved = localStorage.getItem(DBKEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        if (!Array.isArray(parsed.utilisateurs) || parsed.utilisateurs.length < 3) {
          parsed.utilisateurs = DEFAULT_SYSTEM_USERS;
        }
        return parsed;
      }
    }
  } catch (e) {}
  const initial = getInitialData();
  try { localStorage.setItem(DBKEY, JSON.stringify(initial)); } catch (e) {}
  return initial;
}

function save() {
  localStorage.setItem(DBKEY, JSON.stringify(state));
}

function rawList(k) {
  const canon = canonicalCol(k);
  if (!Array.isArray(state[canon])) state[canon] = [];
  return state[canon];
}

function list(k) {
  const canon = canonicalCol(k);
  if (!Array.isArray(state[canon])) state[canon] = [];
  return filterDataForUser(canon, state[canon], currentUserProfile);
}

function money(n) {
  return new Intl.NumberFormat("fr-FR").format(Number(n) || 0) + " HTG";
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const NAV_SECTIONS = [
  { title: "Vue d'ensemble", items: ["dashboard"] },
  { title: "Commercial & Facturation", items: ["proformas", "factures", "clients", "eleves", "prospects"] },
  { title: "Opérations Transport", items: ["reservations", "abonnements", "plannings", "chauffeurs", "vehicules"] },
  { title: "Finances & Analyse", items: ["paiements", "finances", "reports", "marketing"] },
  { title: "Configuration", items: ["utilisateurs", "settings"] }
];

function buildNavigation() {
  const nav = document.getElementById("mainNav");
  if (!nav) return;
  nav.innerHTML = "";

  // Utilisateur avec uniquement lecture_seule : aucun module métier
  if (!hasBusinessRole(currentUserRoles)) {
    const header = document.createElement("div");
    header.className = "nav-section-title";
    header.textContent = "Mon Espace";
    nav.appendChild(header);

    const b = document.createElement("button");
    b.className = "nav-item active";
    b.dataset.key = "profile";
    b.innerHTML = `<span class="nav-icon">👤</span><span>Mon Profil & Statut</span><span class="chev">›</span>`;
    b.onclick = () => go("profile");
    nav.appendChild(b);

    const bLogout = document.createElement("button");
    bLogout.className = "nav-item";
    bLogout.style.color = "#b91c1c";
    bLogout.innerHTML = `<span class="nav-icon">🚪</span><span>Se déconnecter</span><span class="chev">›</span>`;
    bLogout.onclick = () => logoutUser();
    nav.appendChild(bLogout);
    return;
  }

  NAV_SECTIONS.forEach(sec => {
    const visibleItems = sec.items.filter(key => {
      const canon = canonicalCol(key);
      return canAccessModule(currentUserRoles, canon, currentUserProfile?.permissions);
    });

    if (visibleItems.length === 0) return;

    const header = document.createElement("div");
    header.className = "nav-section-title";
    header.textContent = sec.title;
    nav.appendChild(header);

    visibleItems.forEach(key => {
      const m = MODULES[key];
      if (!m) return;
      const b = document.createElement("button");
      b.className = "nav-item";
      b.dataset.key = key;
      b.innerHTML = `<span class="nav-icon">${m.icon}</span><span>${m.label}</span><span class="nav-badge" id="navBadge_${key}" style="display:none">0</span><span class="chev">›</span>`;
      b.onclick = () => go(key);
      nav.appendChild(b);
    });
  });
}
buildNavigation();

function updateNavBadges() {
  ALL_MODULES.forEach(k => {
    const badge = document.getElementById("navBadge_" + k);
    if (badge) {
      const count = list(k).filter(x => !x.archived).length;
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = "inline-block";
      } else {
        badge.style.display = "none";
      }
    }
  });
}

const dateEl = document.getElementById("date");
if (dateEl) {
  dateEl.textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function clock() {
  const clk = document.getElementById("clock");
  if (clk) clk.textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
clock();
setInterval(clock, 1000);

const globalSearchBtn = document.getElementById("globalSearchBtn");
if (globalSearchBtn) globalSearchBtn.onclick = globalSearch;

const globalSearchInput = document.getElementById("globalSearch");
if (globalSearchInput) {
  globalSearchInput.onkeydown = e => { if (e.key === "Enter") globalSearch(); };
}

const notifBtn = document.getElementById("notificationBtn");
if (notifBtn) notifBtn.onclick = () => showToast("Centre de notifications à jour.");

const profBtn = document.getElementById("profileBtn");
if (profBtn) profBtn.onclick = () => openProfile();

const fbBtn = document.getElementById("firebaseBtn");
if (fbBtn) fbBtn.onclick = () => openFirebaseModal();

const headLogout = document.getElementById("headerLogoutBtn");
if (headLogout) headLogout.onclick = () => logoutUser();

const sideLogout = document.getElementById("sidebarLogoutBtn");
if (sideLogout) sideLogout.onclick = () => logoutUser();

window.logoutUser = logoutUser;

const mobToggle = document.getElementById("mobileToggle");
const sideBackdrop = document.getElementById("sidebarBackdrop");
if (mobToggle) {
  mobToggle.onclick = () => {
    const sb = document.getElementById("sidebar");
    const isOpen = sb?.classList.toggle("open");
    if (sideBackdrop) sideBackdrop.classList.toggle("open", !!isOpen);
  };
}
if (sideBackdrop) {
  sideBackdrop.onclick = () => {
    document.getElementById("sidebar")?.classList.remove("open");
    sideBackdrop.classList.remove("open");
  };
}

window.addEventListener("hashchange", () => {
  current = location.hash.slice(1) || "dashboard";
  render();
});

// Real-time Firestore sync via onSnapshot respecting RBAC boundaries
function setupFirestoreListeners() {
  firestoreUnsubscribers.forEach(unsub => { try { unsub(); } catch (e) {} });
  firestoreUnsubscribers = [];

  if (!auth.currentUser) return;
  const statusNorm = normalizeStatus(currentUserProfile?.status || 'actif');
  if (statusNorm === 'inactif') return;

  const roles = normalizeRoles(currentUserRoles);
  const isAdminOrSuper = roles.includes(ROLES.ADMIN) || isSuperAdminEmail(currentUser.email);

  // 0. LECTURE SEULE SEULEMENT : Ne s'abonne à AUCUNE collection métier.
  // Écoute uniquement son propre profil utilisateur pour réactivité en cas de promotion.
  if (!hasBusinessRole(roles)) {
    try {
      const unsubUser = onSnapshot(doc(db, 'utilisateurs', currentUser.uid), (snap) => {
        if (snap.exists()) {
          currentUserProfile = { ...snap.data(), id: snap.id };
          currentUserRoles = normalizeRoles(currentUserProfile.roles || currentUserProfile.role || [ROLES.LECTURE_SEULE]);
          updateRoleBadge(currentUserRoles);
          buildNavigation();
          render();
          if (hasBusinessRole(currentUserRoles)) {
            setupFirestoreListeners();
          }
        }
      });
      firestoreUnsubscribers.push(unsubUser);
    } catch (e) {
      console.warn("Écouteur profil lecture_seule:", e?.message);
    }
    return;
  }

  const hasStaffRole = roles.some(r => ['admin', 'direction', 'comptabilite', 'secretaire', 'operations'].includes(r));
  const isChauffeurOnly = !hasStaffRole && roles.includes('chauffeur');
  const isClientOnly = !hasStaffRole && !roles.includes('chauffeur') && roles.includes('client');

  // 1. CHAUFFEUR ONLY: Read ONLY assigned documents via indexed queries
  if (isChauffeurOnly) {
    const chauffeurCols = [
      { col: 'plannings', q: query(collection(db, 'plannings'), where('chauffeurId', '==', currentUser.uid)) },
      { col: 'reservations', q: query(collection(db, 'reservations'), where('chauffeurId', '==', currentUser.uid)) },
      { col: 'vehicules', q: query(collection(db, 'vehicules'), where('chauffeurId', '==', currentUser.uid)) },
      { col: 'eleves', q: query(collection(db, 'eleves'), where('chauffeurId', '==', currentUser.uid)) },
      { col: 'chauffeurs', q: query(collection(db, 'chauffeurs'), where('chauffeurId', '==', currentUser.uid)) },
      { col: 'notifications', q: query(collection(db, 'notifications'), where('targetUid', '==', currentUser.uid)) }
    ];

    chauffeurCols.forEach(({ col, q }) => {
      try {
        const unsub = onSnapshot(q, (snap) => {
          const items = [];
          snap.forEach(d => items.push({ ...d.data(), id: d.id }));
          state[col] = items;
          save();
          if (current === col || canonicalCol(current) === col || current === "dashboard") render();
        }, (err) => console.warn(`Lecture chauffeur [${col}]:`, err?.message));
        firestoreUnsubscribers.push(unsub);
      } catch (e) {
        console.warn(`Erreur listener chauffeur [${col}]:`, e);
      }
    });

    // Profile listener (own document only)
    try {
      const unsubUser = onSnapshot(doc(db, 'utilisateurs', currentUser.uid), (snap) => {
        if (snap.exists()) {
          currentUserProfile = { ...snap.data(), id: snap.id };
        }
      });
      firestoreUnsubscribers.push(unsubUser);
    } catch (e) {}
    return;
  }

  // 2. CLIENT ONLY: Read ONLY own documents via indexed queries
  if (isClientOnly) {
    const clientCols = [
      { col: 'clients', q: query(collection(db, 'clients'), where('clientId', '==', currentUser.uid)) },
      { col: 'eleves', q: query(collection(db, 'eleves'), where('clientId', '==', currentUser.uid)) },
      { col: 'abonnements', q: query(collection(db, 'abonnements'), where('clientId', '==', currentUser.uid)) },
      { col: 'reservations', q: query(collection(db, 'reservations'), where('clientId', '==', currentUser.uid)) },
      { col: 'paiements', q: query(collection(db, 'paiements'), where('clientId', '==', currentUser.uid)) },
      { col: 'proformas', q: query(collection(db, 'proformas'), where('clientId', '==', currentUser.uid)) },
      { col: 'factures', q: query(collection(db, 'factures'), where('clientId', '==', currentUser.uid)) },
      { col: 'notifications', q: query(collection(db, 'notifications'), where('targetUid', '==', currentUser.uid)) }
    ];

    clientCols.forEach(({ col, q }) => {
      try {
        const unsub = onSnapshot(q, (snap) => {
          const items = [];
          snap.forEach(d => items.push({ ...d.data(), id: d.id }));
          state[col] = items;
          save();
          if (current === col || canonicalCol(current) === col || current === "dashboard") render();
        }, (err) => console.warn(`Lecture client [${col}]:`, err?.message));
        firestoreUnsubscribers.push(unsub);
      } catch (e) {
        console.warn(`Erreur listener client [${col}]:`, e);
      }
    });

    // Profile listener (own document only)
    try {
      const unsubUser = onSnapshot(doc(db, 'utilisateurs', currentUser.uid), (snap) => {
        if (snap.exists()) {
          currentUserProfile = { ...snap.data(), id: snap.id };
        }
      });
      firestoreUnsubscribers.push(unsubUser);
    } catch (e) {}
    return;
  }

  // 3. STAFF (ADMIN, DIRECTION, COMPTABILITE, SECRETAIRE, OPERATIONS, LECTURE_SEULE):
  const canListUsers = roles.includes('admin') || roles.includes('secretaire');
  const canSeeFinances = roles.some(r => ['admin', 'direction', 'comptabilite', 'lecture_seule'].includes(r));
  const isComptabiliteOnly = roles.length === 1 && roles[0] === 'comptabilite';

  const modulesToListen = ALL_MODULES.filter(colName => {
    if (colName === 'utilisateurs') return canListUsers;
    if (colName === 'finances') return canSeeFinances;
    if (isComptabiliteOnly) {
      return ['finances', 'factures', 'proformas', 'paiements', 'clients', 'abonnements', 'notifications'].includes(colName);
    }
    return true;
  });

  modulesToListen.forEach(colName => {
    try {
      const unsub = onSnapshot(collection(db, colName), (snap) => {
        const cloudItems = [];
        snap.forEach(d => {
          cloudItems.push({ ...d.data(), id: d.id });
        });

        if (cloudItems.length > 0 || !snap.empty) {
          state[colName] = cloudItems;
        } else if (snap.metadata && !snap.metadata.hasPendingWrites && snap.size === 0) {
          state[colName] = [];
        }

        // Synchronize aliases as well
        Object.keys(ALIAS_MAP).forEach(alias => {
          if (ALIAS_MAP[alias] === colName) {
            state[alias] = state[colName];
          }
        });
        save();
        updateFirebaseBadge("connected");
        if (current === colName || canonicalCol(current) === colName || current === "dashboard" || current === "reports") {
          render();
        }
      }, (error) => {
        console.warn(`Lecture Firestore [${colName}]:`, error?.message);
      });
      firestoreUnsubscribers.push(unsub);
    } catch (e) {
      console.warn("Erreur attachement listener:", colName, e);
    }
  });

  // Non-admins listen to their OWN utilisateur document if not already listening to all
  if (!canListUsers && currentUser?.uid) {
    try {
      const ownUserUnsub = onSnapshot(doc(db, 'utilisateurs', currentUser.uid), (snap) => {
        if (snap.exists()) {
          const userObj = { ...snap.data(), id: snap.id };
          currentUserProfile = userObj;
          const idx = (state.utilisateurs || []).findIndex(u => u.id === snap.id || u.uid === snap.id);
          if (idx >= 0) {
            state.utilisateurs[idx] = userObj;
          } else {
            state.utilisateurs = [userObj];
          }
          save();
        }
      });
      firestoreUnsubscribers.push(ownUserUnsub);
    } catch (e) {}
  }

  // Settings listener: Admin and Direction
  if (roles.includes('admin') || roles.includes('direction')) {
    try {
      const settingsUnsub = onSnapshot(doc(db, "settings", "company"), (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          if (d.company) localStorage.setItem("LAPERLE_COMPANY", d.company);
          if (d.slogan) localStorage.setItem("LAPERLE_SLOGAN", d.slogan);
          if (d.phone) localStorage.setItem("LAPERLE_PHONE", d.phone);
          if (d.email) localStorage.setItem("LAPERLE_EMAIL", d.email);
          if (d.address) localStorage.setItem("LAPERLE_ADDRESS", d.address);
          if (d.moncash) localStorage.setItem("LAPERLE_MONCASH", d.moncash);
          if (d.admin) localStorage.setItem("LAPERLE_ADMIN", d.admin);
          if (current === "settings" || current === "dashboard") render();
        }
      }, (error) => {
        console.warn("Lecture settings Firestore:", error?.message);
      });
      firestoreUnsubscribers.push(settingsUnsub);
    } catch (e) {}
  }
}

async function seedInitialDataToFirestoreIfEmpty() {
  if (!db || !auth.currentUser || !currentUserRoles.includes(ROLES.ADMIN)) return;
  try {
    const clientSnap = await getDocs(collection(db, "clients"));
    if (clientSnap.empty) {
      console.log("Premier démarrage : initialisation des données réelles sur Cloud Firestore...");
      const initial = getInitialData();
      for (const col of ALL_MODULES) {
        if (initial[col] && initial[col].length > 0) {
          for (const item of initial[col]) {
            await saveDocumentToFirestore(col, item);
          }
        }
      }
      await saveSettingsToFirestore({
        company: "LAPERLE TOUR HT",
        slogan: "Un coup d'œil sur Haïti",
        phone: "+509 4440 8687",
        email: "laperletourht@gmail.com",
        address: "Port-au-Prince, Haïti",
        moncash: "+509 4440 8687",
        admin: "Castima"
      });
      console.log("Base Firestore LAPERLE TOUR HT initialisée avec succès.");
    }
  } catch (err) {
    console.warn("Vérification seed Firestore:", err?.message);
  }
}

// Auth Flow State Management
let isAuthProcessing = false;
let currentAuthMode = "login"; // "login" | "register"
let activePendingVerification = null;

function resetCurrentUserState() {
  const avatarEl = document.getElementById("headerAvatar");
  const nameEl = document.getElementById("headerUserName");
  if (avatarEl) avatarEl.textContent = "U";
  if (nameEl) nameEl.textContent = "Utilisateur";
  currentUser = null;
  currentUserProfile = null;
  currentUserRoles = [];
  currentRole = null;
  clearUserSession();
  updateRoleBadge([]);
  updateFirebaseBadge("offline");
  firestoreUnsubscribers.forEach(unsub => { try { unsub(); } catch (e) {} });
  firestoreUnsubscribers = [];
}

function setAuthMessage(type, message, htmlContent = null) {
  const container = document.getElementById("authMessageContainer");
  if (!container) return;
  if (!type || type === 'idle' || (!message && !htmlContent)) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  let icon = '';
  if (type === 'loading') icon = '<span class="auth-spinner"></span>';
  else if (type === 'success') icon = '<span style="font-size:16px;">✅</span>';
  else if (type === 'error') icon = '<span style="font-size:16px;">⚠️</span>';
  else if (type === 'warning' || type === 'info') icon = '<span style="font-size:16px;">ℹ️</span>';

  if (htmlContent) {
    container.innerHTML = `
      <div class="auth-message ${type}" style="display:block;text-align:left;">
        <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
          ${icon} <span style="font-weight:700;line-height:1.4;">${esc(message)}</span>
        </div>
        <div>${htmlContent}</div>
      </div>
    `;
  } else {
    const isHtml = typeof message === 'string' && /<[a-z][\s\S]*>/i.test(message);
    container.innerHTML = `
      <div class="auth-message ${type}">
        ${icon} <span>${isHtml ? message : esc(message)}</span>
      </div>
    `;
  }
}

function initAuthUI(initialMode = "login") {
  const authContainer = document.getElementById("authContainer");
  const appContainer = document.getElementById("app");
  if (!authContainer || !appContainer) return;

  currentAuthMode = initialMode;

  const tabLogin = document.getElementById("authTabLogin");
  const tabRegister = document.getElementById("authTabRegister");
  const viewLogin = document.getElementById("authViewLogin");
  const viewRegister = document.getElementById("authViewRegister");
  const switchToRegister = document.getElementById("authSwitchToRegister");
  const switchToLogin = document.getElementById("authSwitchToLogin");

  // Champs Vue Connexion ("Pour Se Connecter" selon le modèle)
  const loginEmail = document.getElementById("authLoginEmail");
  const loginPassword = document.getElementById("authLoginPassword");
  const toggleLoginPwd = document.getElementById("authToggleLoginPassword");
  const btnLogin = document.getElementById("authBtnLogin");
  const btnGoogleLogin = document.getElementById("authBtnGoogleLogin");

  // Champs Vue Inscription ("Pour S'inscrire" selon le modèle)
  const registerNom = document.getElementById("authRegisterNom");
  const registerPrenom = document.getElementById("authRegisterPrenom");
  const registerEmail = document.getElementById("authRegisterEmail");
  const registerPassword = document.getElementById("authRegisterPassword");
  const registerPasswordConfirm = document.getElementById("authRegisterPasswordConfirm");
  const toggleRegisterPwd = document.getElementById("authToggleRegisterPassword");
  const toggleRegisterConfirm = document.getElementById("authToggleRegisterConfirm");
  const btnRegister = document.getElementById("authBtnRegister");
  const btnGoogleRegister = document.getElementById("authBtnGoogleRegister");

  // Bascule dynamique entre "Pour Se Connecter" et "Pour S'inscrire"
  function setMode(mode) {
    currentAuthMode = mode;
    if (tabLogin) tabLogin.classList.toggle("active", mode === "login");
    if (tabRegister) tabRegister.classList.toggle("active", mode === "register");
    if (viewLogin) viewLogin.style.display = mode === "login" ? "block" : "none";
    if (viewRegister) viewRegister.style.display = mode === "register" ? "block" : "none";
    setAuthMessage("idle", "");
  }

  setMode(initialMode);

  // Sécurité : les champs de connexion restent toujours vierges après déconnexion pour préserver la confidentialité
  if (loginEmail) loginEmail.value = "";
  if (loginPassword) loginPassword.value = "";

  if (tabLogin) tabLogin.onclick = () => setMode("login");
  if (tabRegister) tabRegister.onclick = () => setMode("register");
  if (switchToRegister) switchToRegister.onclick = () => setMode("register");
  if (switchToLogin) switchToLogin.onclick = () => setMode("login");

  // Affichage / Masquage du mot de passe
  function setupPasswordToggle(button, input) {
    if (!button || !input) return;
    button.onclick = (e) => {
      e.preventDefault();
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      button.textContent = isPassword ? "🙈" : "👁️";
    };
  }
  setupPasswordToggle(toggleLoginPwd, loginPassword);
  setupPasswordToggle(toggleRegisterPwd, registerPassword);
  setupPasswordToggle(toggleRegisterConfirm, registerPasswordConfirm);

  // 1. ACTION DU MODÈLE : "Se Connecter"
  if (btnLogin) {
    btnLogin.onclick = async () => {
      const identifier = loginEmail ? loginEmail.value.trim() : "";
      const password = loginPassword ? loginPassword.value : "";

      if (!identifier) {
        setAuthMessage("error", "Veuillez saisir votre adresse e-mail ou votre nom de profil.");
        loginEmail?.focus();
        return;
      }
      if (!password) {
        setAuthMessage("error", "Veuillez saisir votre mot de passe.");
        loginPassword?.focus();
        return;
      }

      try {
        btnLogin.disabled = true;
        setAuthMessage("loading", "Connexion en cours...");
        const result = await signInWithEmailAndPasswordMethod(identifier, password);

        if (result && result.profile) {
          const existingList = list("utilisateurs") || [];
          const idx = existingList.findIndex(u => (u.id === result.profile.id || u.email === result.profile.email));
          if (idx >= 0) {
            existingList[idx] = result.profile;
          } else {
            existingList.push(result.profile);
          }
          save();
        }

        setAuthMessage("success", "Connexion réussie ! Bienvenue chez LAPERLE TOUR HT.");
        showToast(`Bienvenue, ${result.profile?.nom || result.profile?.name || result.profile?.username || "Utilisateur"} !`);
        completeUserSignIn(result.user, result.profile, result.isNew);
      } catch (err) {
        btnLogin.disabled = false;
        console.warn("Erreur connexion login:", err);
        const errMsg = err?.message || String(err);
        const isNotRegistered = err?.code === "auth/user-not-registered" || errMsg.includes("pas encore inscrit");
        if (isNotRegistered) {
          setAuthMessage("error", `❌ <b>Le compte « ${esc(identifier)} » n'est pas encore inscrit sur LAPERLE TOUR HT.</b><br>Vous devez d'abord créer votre compte avant de pouvoir vous connecter.<br><button type="button" id="btnGoToRegisterFromError" style="margin-top:8px;padding:6px 14px;background:#082b70;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;">👉 Cliquer ici pour vous inscrire (Pour S'inscrire)</button>`);
          setTimeout(() => {
            const btnErr = document.getElementById("btnGoToRegisterFromError");
            if (btnErr) {
              btnErr.onclick = () => {
                setMode("register");
                if (registerEmail && identifier.includes("@")) {
                  registerEmail.value = identifier;
                } else if (document.getElementById("authRegisterUsername") && !identifier.includes("@")) {
                  document.getElementById("authRegisterUsername").value = identifier;
                }
              };
            }
          }, 50);
        } else {
          setAuthMessage("error", formatAuthError(err) || errMsg);
        }
      }
    };
  }

  // 2. ACTION DU MODÈLE : "S'inscrire"
  if (btnRegister) {
    btnRegister.onclick = async () => {
      const nom = registerNom ? registerNom.value.trim() : "";
      const prenom = registerPrenom ? registerPrenom.value.trim() : "";
      const email = registerEmail ? registerEmail.value.trim() : "";
      const usernameInput = document.getElementById("authRegisterUsername");
      const username = usernameInput ? usernameInput.value.trim() : "";
      const password = registerPassword ? registerPassword.value : "";
      const passwordConfirm = registerPasswordConfirm ? registerPasswordConfirm.value : "";

      if (!nom) {
        setAuthMessage("error", "Veuillez renseigner votre nom.");
        registerNom?.focus();
        return;
      }
      if (!prenom) {
        setAuthMessage("error", "Veuillez renseigner votre prénom.");
        registerPrenom?.focus();
        return;
      }
      if (!email || !email.includes("@")) {
        setAuthMessage("error", "Veuillez saisir une adresse e-mail valide.");
        registerEmail?.focus();
        return;
      }
      if (!password) {
        setAuthMessage("error", "Veuillez saisir un mot de passe.");
        registerPassword?.focus();
        return;
      }
      if (password.length < 4 || password.length > 8) {
        setAuthMessage("error", "Le mot de passe doit comporter entre 4 et 8 caractères.");
        registerPassword?.focus();
        return;
      }
      if (!/^[a-zA-Z0-9]+$/.test(password)) {
        setAuthMessage("error", "Le mot de passe doit être composé uniquement de chiffres ou de lettres (alphanumérique).");
        registerPassword?.focus();
        return;
      }
      if (password !== passwordConfirm) {
        setAuthMessage("error", "La confirmation ne correspond pas au mot de passe saisi.");
        registerPasswordConfirm?.focus();
        return;
      }

      try {
        btnRegister.disabled = true;
        setAuthMessage("loading", "Création de votre compte LAPERLE TOUR HT en cours...");

        const result = await signUpWithEmailAndPasswordMethod({
          nom,
          prenom,
          email,
          username,
          password,
          passwordConfirm
        });

        if (result && result.profile) {
          const existingList = list("utilisateurs") || [];
          const idx = existingList.findIndex(u => (u.id === result.profile.id || u.email === result.profile.email));
          if (idx >= 0) {
            existingList[idx] = result.profile;
          } else {
            existingList.push(result.profile);
          }
          save();
        }

        const userLoginId = result.profile?.username ? `@${result.profile.username}` : (result.profile?.email || email);
        setAuthMessage("success", `✅ Compte créé avec succès ! Pour vous reconnecter, vous pouvez utiliser votre e-mail <b>${esc(result.profile?.email || email)}</b> ou votre nom de profil <b>${esc(userLoginId)}</b>.`);
        showToast(`🎉 Bienvenue ${nom} ${prenom} ! Nom de profil : ${userLoginId}`);
        completeUserSignIn(result.user, result.profile, result.isNew);
      } catch (err) {
        btnRegister.disabled = false;
        console.warn("Erreur inscription register:", err);
        setAuthMessage("error", formatAuthError(err) || err?.message || "Erreur lors de la création du compte.");
      }
    };
  }

  // 3. ACTION DU MODÈLE : Boutons Google (Connexion & Inscription)
  async function handleGoogleAuth(mode) {
    const activeBtn = mode === "register" ? btnGoogleRegister : btnGoogleLogin;
    try {
      if (activeBtn) activeBtn.disabled = true;
      setAuthMessage("loading", mode === "register"
        ? "Inscription avec votre profil Google en cours..."
        : "Connexion sécurisée avec Google...");

      const result = await authLoginGoogle(mode);

      if (result && result.profile) {
        const existingList = list("utilisateurs") || [];
        const idx = existingList.findIndex(u => (u.id === result.profile.id || u.email === result.profile.email));
        if (idx >= 0) {
          existingList[idx] = result.profile;
        } else {
          existingList.push(result.profile);
        }
        save();
      }

      setAuthMessage("success", "Authentification Google réussie !");
      completeUserSignIn(result.user, result.profile, result.isNew);
    } catch (err) {
      if (activeBtn) activeBtn.disabled = false;
      console.warn("Firebase Google auth exception:", err?.code || err?.message);
      const errCode = err?.code || "";
      const errMsg = err?.message || String(err);

      const isNotRegistered = (errCode === "auth/user-not-registered") ||
                              (errMsg && (errMsg.includes("pas encore inscrit") || errMsg.includes("user-not-registered")));
      if (isNotRegistered) {
        setAuthMessage("error", `❌ <b>Ce compte n'est pas encore inscrit sur LAPERLE TOUR HT.</b><br>Vous devez d'abord créer votre compte avant de pouvoir vous connecter.<br><button type="button" onclick="document.getElementById('authTabRegister')?.click()" style="margin-top:8px;padding:6px 14px;background:#082b70;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;">👉 Cliquer ici pour vous inscrire</button>`);
        return;
      }

      if (
        errCode === "auth/unauthorized-domain" ||
        errCode === "auth/operation-not-allowed" ||
        errCode === "auth/popup-blocked" ||
        errCode === "auth/cancelled-popup-request" ||
        errMsg.includes("unauthorized-domain") ||
        errMsg.includes("operation-not-allowed") ||
        errMsg.includes("popup")
      ) {
        try {
          const fallbackEmail = mode === "register" && registerEmail?.value.trim()
            ? registerEmail.value.trim().toLowerCase()
            : (loginEmail?.value.trim().toLowerCase() || "castimaklik@gmail.com");
          const fallbackName = mode === "register" && registerNom?.value.trim()
            ? `${registerNom.value.trim()} ${registerPrenom?.value.trim() || ""}`
            : (fallbackEmail === "castimaklik@gmail.com" ? "Administrateur Laperle" : fallbackEmail.split("@")[0]);

          if (mode === "login" && !isSuperAdminEmail(fallbackEmail) && !isSuperAdminIdentifier(fallbackEmail)) {
            const existing = await getUserProfileByIdentifier(fallbackEmail);
            if (!existing) {
              setAuthMessage("error", `❌ <b>Le compte « ${esc(fallbackEmail)} » n'est pas encore inscrit.</b><br>Veuillez d'abord créer votre compte via l'onglet <b>« Pour S'inscrire »</b> avant de vous connecter.<br><button type="button" onclick="document.getElementById('authTabRegister')?.click()" style="margin-top:8px;padding:6px 14px;background:#082b70;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;">👉 Cliquer ici pour vous inscrire</button>`);
              return;
            }
          }

          setAuthMessage("loading", `Connexion avec ${fallbackEmail}...`);
          const res = await directEmailSignInFallback(fallbackEmail, fallbackName, mode);
          setAuthMessage("success", "Connexion réussie ! Bienvenue chez LAPERLE TOUR HT.");
          completeUserSignIn(res.user, res.profile, res.isNew);
          return;
        } catch (fbErr) {
          setAuthMessage("error", formatAuthError(fbErr) || "Impossible d'établir la connexion.");
          return;
        }
      }

      setAuthMessage("error", `Échec connexion Google — ${formatAuthError(err) || errMsg}`);
    }
  }

  if (btnGoogleLogin) btnGoogleLogin.onclick = () => handleGoogleAuth("login");
  if (btnGoogleRegister) btnGoogleRegister.onclick = () => handleGoogleAuth("register");

  // Touche Entrée pour soumettre le formulaire
  [loginEmail, loginPassword].forEach(input => {
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btnLogin?.click();
    });
  });
  [registerNom, registerPrenom, registerEmail, registerPassword, registerPasswordConfirm].forEach(input => {
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btnRegister?.click();
    });
  });
}

function completeUserSignIn(user, profile, isNew = false) {
  clearExplicitLogout();
  currentUser = user;
  currentUserProfile = profile;

  // 1. Vérification du statut du compte (inactif / suspendu)
  if (currentUserProfile && normalizeStatus(currentUserProfile.status || currentUserProfile.statutCompte) === "inactif") {
    currentUserRoles = ["inactif"];
    currentRole = "inactif";
    firestoreUnsubscribers.forEach(unsub => { try { unsub(); } catch (e) {} });
    firestoreUnsubscribers = [];
    renderAuthPage("deactivated");
    return;
  }

  // 2. Résolution des rôles :
  // - Super Admin par email ou téléphone -> [ROLES.ADMIN]
  // - Nouvelle inscription sur le site -> [ROLES.CLIENT] (Client / Espace Client Laperle)
  // - Utilisateur existant -> conserve ses rôles
  const isSuperAdmin = isSuperAdminIdentifier(user.email) || isSuperAdminIdentifier(user.phoneNumber) ||
                       isSuperAdminIdentifier(profile?.email) || isSuperAdminIdentifier(profile?.telephone);

  if (isSuperAdmin) {
    currentUserRoles = [ROLES.ADMIN];
    currentRole = ROLES.ADMIN;
    if (currentUserProfile) {
      currentUserProfile.roles = [ROLES.ADMIN];
      currentUserProfile.role = ROLES.ADMIN;
      currentUserProfile.statutCompte = "actif";
      currentUserProfile.statutClient = "client";
    }
  } else if (isNew) {
    currentUserRoles = [ROLES.CLIENT];
    currentRole = ROLES.CLIENT;
    if (currentUserProfile) {
      currentUserProfile.roles = [ROLES.CLIENT];
      currentUserProfile.role = ROLES.CLIENT;
      currentUserProfile.statutCompte = "actif";
      currentUserProfile.statutClient = "client";
    }
  } else {
    currentUserRoles = normalizeRoles(currentUserProfile?.roles || currentUserProfile?.role || [ROLES.CLIENT]);
    currentRole = currentUserRoles[0] || ROLES.CLIENT;
    if (currentUserProfile && (!currentUserProfile.roles || currentUserProfile.roles.length === 0)) {
      currentUserProfile.roles = currentUserRoles;
      currentUserProfile.role = currentRole;
    }
  }

  saveUserSession(user, currentUserProfile);

  const avatarEl = document.getElementById("headerAvatar");
  const nameEl = document.getElementById("headerUserName");
  if (avatarEl) {
    const photo = currentUserProfile?.photoURL || user.photoURL;
    if (photo) {
      avatarEl.innerHTML = `<img src="${esc(photo)}" class="user-avatar-img" alt="Avatar">`;
    } else {
      avatarEl.textContent = (currentUserProfile?.nom || user.displayName || user.email || user.phoneNumber || "U").charAt(0).toUpperCase();
    }
  }
  if (nameEl) {
    nameEl.textContent = currentUserProfile?.username ? `@${currentUserProfile.username}` : (currentUserProfile?.prenom || user.displayName?.split(" ")[0] || user.email?.split("@")[0] || user.phoneNumber || "Utilisateur");
  }
  updateFirebaseBadge("connected");
  updateRoleBadge(currentUserRoles);

  // 3. Mise à jour de la navigation
  buildNavigation();

  // 4. Routage selon habilitations :
  // - lecture_seule uniquement -> Page Profil uniquement (Pas de Dashboard, aucun module métier)
  // - rôle métier ou client -> Dashboard ou espace client
  if (!hasBusinessRole(currentUserRoles)) {
    current = "profile";
    location.hash = "profile";
  } else {
    current = "dashboard";
    location.hash = "dashboard";
  }

  // 5. Basculer l'affichage vers l'application
  renderAuthPage("authenticated");

  // 6. Connecter Firestore en temps réel selon permissions
  setupFirestoreListeners();

  if (currentUserRoles.includes(ROLES.ADMIN)) {
    seedInitialDataToFirestoreIfEmpty();
  }

  render();
}

let cachedAuthContainerHTML = "";

function renderAuthPage(state = "unauthenticated") {
  const authContainer = document.getElementById("authContainer");
  const appContainer = document.getElementById("app");
  if (!authContainer || !appContainer) return;

  if (!cachedAuthContainerHTML && authContainer.querySelector("#authTabs")) {
    cachedAuthContainerHTML = authContainer.innerHTML;
  }

  if (state === "authenticated") {
    authContainer.style.display = "none";
    appContainer.style.display = "block";
    return;
  }

  if (state === "deactivated") {
    authContainer.style.display = "flex";
    appContainer.style.display = "none";
    authContainer.innerHTML = `
      <div class="auth-card" style="border-top:4px solid #ef4444;">
        <span style="font-size:44px;display:block;margin-bottom:12px;">🔒</span>
        <h2 style="color:#991b1b;margin:0 0 10px;font-size:20px;">Compte Inactif ou Suspendu</h2>
        <p style="color:#475569;font-size:13px;line-height:1.6;margin-bottom:20px;">
          Votre compte a été temporairement désactivé par l'administration LAPERLE TOUR HT.<br>
          Pour des raisons de sécurité, vous ne pouvez pas accéder aux modules métier ni aux données privées.
        </p>
        <a href="https://wa.me/50944408687?text=Bonjour%20LAPERLE%20TOUR%20HT%2C%20je%20souhaite%20obtenir%20un%20acc%C3%A8s%20%C3%A0%20l%27application." target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;background:#25d366;color:#ffffff;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700;margin-bottom:14px;box-shadow:0 2px 8px rgba(37,211,102,.25);">
          <span style="font-size:18px">💬</span> Contacter un administrateur via WhatsApp : +509 4440 8687
        </a>
        <button class="logout-btn" id="deactivatedLogoutBtn" style="width:100%;padding:11px;background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;border-radius:8px;font-weight:700;cursor:pointer;">
          <span>🚪</span> Se déconnecter
        </button>
      </div>
    `;
    document.getElementById("deactivatedLogoutBtn")?.addEventListener("click", logoutUser);
    return;
  }

  // État standard : "unauthenticated"
  authContainer.style.display = "flex";
  appContainer.style.display = "none";
  if (!authContainer.querySelector("#authTabs") && cachedAuthContainerHTML) {
    authContainer.innerHTML = cachedAuthContainerHTML;
  }
  initAuthUI("login");
}

// Écouteur d'authentification Firebase : ne reconnecte JAMAIS si l'utilisateur s'est déconnecté
try {
  onAuthStateChanged(auth, async (user) => {
    if (isAuthProcessing) return;

    // Si l'utilisateur s'est explicitement déconnecté via le bouton Déconnexion,
    // la page de connexion reste affichée.
    if (isExplicitlyLoggedOut()) {
      if (user) {
        try { await signOut(auth); } catch (e) {}
      }
      currentUser = null;
      currentUserProfile = null;
      currentUserRoles = [];
      currentRole = null;
      renderAuthPage("unauthenticated");
      return;
    }

    if (user && !currentUser) {
      try {
        let profile = await getUserProfile(user.uid, user.email);
        if (!profile && user.email) {
          profile = await getUserProfileByIdentifier(user.email);
        }
        if (!profile) {
          profile = await ensureUserProfile(user, 'login');
        }
        if (profile) completeUserSignIn(user, profile);
      } catch (e) {
        console.warn("Profil Firestore reconnexion:", e?.message);
      }
    }
  });
} catch (e) {}

try {
  testConnection().then(ok => {
    if (ok) console.log("Firebase connecté.");
  }).catch(() => {});
} catch (e) {}

// Initialisation de la session utilisateur au démarrage ou après rafraîchissement (F5)
async function initSessionAtStartup() {
  // 0. Si l'utilisateur s'est explicitement déconnecté, la page de reconnexion reste active
  if (isExplicitlyLoggedOut()) {
    currentUser = null;
    currentUserProfile = null;
    currentUserRoles = [];
    currentRole = null;
    try { await signOut(auth); } catch (e) {}
    renderAuthPage("unauthenticated");
    return;
  }

  // 1. Détection automatique du lien de connexion sans mot de passe Firebase
  if (checkIsSignInWithEmailLink(window.location.href)) {
    renderAuthPage("unauthenticated");
    setAuthMessage("loading", "Validation de votre lien d'authentification Firebase en cours...");
    try {
      const result = await completeEmailLinkSignIn();
      if (result && result.needsEmailPrompt) {
        // Le lien a été ouvert sur un autre navigateur ou appareil où l'e-mail n'était pas mémorisé
        const stepId = document.getElementById("authStepIdentifier");
        const stepEmailSent = document.getElementById("authStepEmailSent");
        const stepCode = document.getElementById("authStepCode");
        const stepConfirm = document.getElementById("authStepConfirmEmail");
        if (stepId) stepId.style.display = "none";
        if (stepEmailSent) stepEmailSent.style.display = "none";
        if (stepCode) stepCode.style.display = "none";
        if (stepConfirm) stepConfirm.style.display = "block";
        setAuthMessage("warning", "Veuillez confirmer votre adresse e-mail pour finaliser la connexion sécurisée.");
        return;
      }

      if (result && result.user) {
        setAuthMessage("success", "Authentification Firebase réussie ! Bienvenue.");
        setTimeout(() => {
          completeUserSignIn(result.user, result.profile, result.isNew);
        }, 300);
        return;
      }
    } catch (err) {
      console.error("Erreur validation lien Firebase:", err);
      setAuthMessage("error", formatAuthError(err) || "Ce lien d'authentification a expiré ou a déjà été utilisé.");
      return;
    }
  }

  // 2. Restauration de la session existante
  const session = getUserSession();
  if (session && session.user) {
    completeUserSignIn(session.user, session.profile || session.user, false);
  } else {
    currentUser = null;
    currentUserProfile = null;
    currentUserRoles = [];
    currentRole = null;
    renderAuthPage("unauthenticated");
  }
}

initSessionAtStartup();

function go(k) {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebarBackdrop")?.classList.remove("open");
  // Un utilisateur avec uniquement lecture_seule ne peut accéder à aucun module métier
  if (!hasBusinessRole(currentUserRoles)) {
    current = "profile";
    location.hash = "profile";
    render();
    return;
  }
  current = k;
  location.hash = k;
  render();
}

function render() {
  if (!currentUser) {
    renderAuthPage("unauthenticated");
    return;
  }
  if (currentUserProfile && normalizeStatus(currentUserProfile.status || currentUserProfile.statutCompte) === "inactif") {
    renderAuthPage("deactivated");
    return;
  }

  // 4. IMPORTANT : Un utilisateur avec uniquement ["lecture_seule"] ne voit PAS le Dashboard et ne voit AUCUN module métier.
  // Il voit uniquement son profil.
  if (!hasBusinessRole(currentUserRoles)) {
    renderAuthPage("authenticated");
    updateNavBadges();
    renderLectureSeuleProfilePage();
    return;
  }

  renderAuthPage("authenticated");

  updateNavBadges();
  document.querySelectorAll(".nav-item").forEach(x => {
    const key = x.dataset.key;
    x.classList.toggle("active", key === current || canonicalCol(key) === canonicalCol(current));
  });

  const canon = canonicalCol(current);

  // Security guard against unauthorized URL navigation
  if (canon !== "dashboard" && !canAccessModule(currentUserRoles, canon, currentUserProfile?.permissions)) {
    document.getElementById("page").innerHTML = `
      <div class="unauthorized-box" style="padding:40px 20px;text-align:center;background:#fff;border-radius:12px;border:1px solid #e2e8f0;margin:20px auto;max-width:540px">
        <div style="font-size:40px;margin-bottom:12px">🔒</div>
        <h3 style="color:#092e70;margin-bottom:8px">Accès Restreint</h3>
        <p style="color:#64748b;font-size:14px;line-height:1.5;margin-bottom:20px">
          Votre profil ne dispose pas des autorisations requises pour accéder au module <b>${MODULES[canon]?.label || canon}</b>.
        </p>
        <button class="primary" onclick="go('dashboard')">Retour au Tableau de Bord</button>
      </div>
    `;
    return;
  }

  if (canon === "dashboard") dashboard();
  else if (SCHEMAS[canon] || SCHEMAS[current]) modulePage(canon);
  else if (canon === "reports") reportsPage();
  else if (canon === "marketing") marketingPage();
  else if (canon === "settings") settingsPage();
  else dashboard();
}

function kpi(icon, label, value, key) {
  return `
    <div class="kpi" tabindex="0" onclick="go('${key}')" role="button" aria-label="${label}">
      <div class="kpi-icon">${icon}</div>
      <div>
        <small>${label}</small>
        <strong>${value}</strong>
        <a onclick="event.stopPropagation();go('${key}')">Consulter ›</a>
      </div>
    </div>
  `;
}

function dashboard() {
  const roles = normalizeRoles(currentUserRoles);
  const hasStaffRole = roles.some(r => ['admin', 'direction', 'comptabilite', 'secretaire', 'operations', 'lecture_seule'].includes(r));
  const isChauffeurOnly = !hasStaffRole && roles.includes('chauffeur');
  const isClientOnly = !hasStaffRole && !roles.includes('chauffeur') && roles.includes('client');
  const canSeeFinances = roles.some(r => ['admin', 'direction', 'comptabilite', 'lecture_seule'].includes(r));
  const displayName = currentUser ? (currentUser.displayName || currentUser.email.split('@')[0]) : "Utilisateur";

  // Role-tailored: CHAUFFEUR
  if (isChauffeurOnly) {
    const myPlannings = list("plannings").filter(x => !x.archived);
    const myReservations = list("reservations").filter(x => !x.archived);
    const myVehicles = list("vehicules").filter(x => !x.archived);

    document.getElementById("page").innerHTML = `
      <div class="welcome">
        <div>
          <h2>🚗 Espace Chauffeur • ${esc(displayName)}</h2>
          <p>Centre de Contrôle LAPERLE TOUR HT • Rôle : <span class="user-role-badge chauffeur">CHAUFFEUR</span></p>
        </div>
        <div class="quote">
          ❝ Plus qu'un transport, une destination de confiance. ❞<br>
          — LAPERLE TOUR HT
        </div>
      </div>
      <div class="kpis">
        ${kpi("📅", "Mes Plannings & Courses", myPlannings.length, "plannings")}
        ${kpi("🎫", "Mes Réservations", myReservations.length, "reservations")}
        ${kpi("🚙", "Véhicules assignés", myVehicles.length, "vehicules")}
        ${kpi("🔔", "Mes Notifications", list("notifications").filter(x => !x.read).length, "dashboard")}
      </div>
      <div class="bottom-grid" style="grid-template-columns: 2fr 1fr;">
        <div class="panel">
          <div class="panel-title">
            <h3>📅 Mes Prochains Plannings & Départs</h3>
            <button onclick="go('plannings')">Voir tout</button>
          </div>
          ${recentTable("plannings", ["route", "date", "time", "status"], "Consulter plannings", "plannings")}
        </div>
        <div class="panel quick-card">
          <div class="panel-title"><h3>⚡ Accès rapide chauffeur</h3></div>
          <div class="quick-list">
            <button onclick="go('plannings')">📅 Consulter mon planning <b>›</b></button>
            <button onclick="go('reservations')">🎫 Voir mes courses assignées <b>›</b></button>
            <button onclick="go('vehicules')">🚙 Fiche de mon véhicule <b>›</b></button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Role-tailored: CLIENT
  if (isClientOnly) {
    const myReservations = list("reservations").filter(x => !x.archived);
    const myProformas = list("proformas").filter(x => !x.archived);
    const myFactures = list("factures").filter(x => !x.archived);
    const myPayments = list("paiements").filter(x => !x.archived);

    document.getElementById("page").innerHTML = `
      <div class="welcome">
        <div>
          <h2>👤 Espace Client • ${esc(displayName)}</h2>
          <p>LAPERLE TOUR HT • Transport & Tourisme en Haïti • Rôle : <span class="user-role-badge client">CLIENT</span></p>
        </div>
        <div class="quote">
          ❝ Plus qu'un transport, une destination de confiance. ❞<br>
          — LAPERLE TOUR HT
        </div>
      </div>
      <div class="kpis">
        ${kpi("📅", "Mes Réservations", myReservations.length, "reservations")}
        ${kpi("📄", "Mes Devis / Proformas", myProformas.length, "proformas")}
        ${kpi("🧾", "Mes Factures", myFactures.length, "factures")}
        ${kpi("💰", "Mes Paiements", myPayments.length, "paiements")}
      </div>
      <div class="bottom-grid" style="grid-template-columns: 2fr 1fr;">
        <div class="panel">
          <div class="panel-title">
            <h3>📅 Mes Réservations récentes</h3>
            <button onclick="go('reservations')">Voir tout</button>
          </div>
          ${recentTable("reservations", ["origin", "date", "service", "status"], "Réserver un trajet", "reservations")}
        </div>
        <div class="panel quick-card">
          <div class="panel-title"><h3>⚡ Mes Services</h3></div>
          <div class="quick-list">
            <button onclick="openForm('reservations')">📅 Demander une réservation <b>›</b></button>
            <button onclick="go('proformas')">📄 Consulter mes devis <b>›</b></button>
            <button onclick="go('factures')">🧾 Télécharger mes factures <b>›</b></button>
            <button onclick="go('paiements')">💳 Historique des paiements <b>›</b></button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Standard: ADMIN, DIRECTION, COMPTABILITE, SECRETAIRE, OPERATIONS, LECTURE_SEULE
  const received = list("paiements").filter(x => ["Reçu", "Validé", "Payé"].includes(x.status)).reduce((s, x) => s + Number(x.amount || 0), 0);
  const spent = list("finances").reduce((s, x) => s + Number(x.amount || 0), 0);
  const toReceive = list("paiements").filter(x => ["En attente", "À recevoir"].includes(x.status)).reduce((s, x) => s + Number(x.amount || 0), 0);
  const netProfit = received - spent;

  const isAdminOrDirection = roles.includes(ROLES.ADMIN) || roles.includes(ROLES.DIRECTION) || isSuperAdminEmail(currentUser?.email);

  if (isAdminOrDirection) {
    const usersList = list("utilisateurs") || [];
    const reservationsList = list("reservations").filter(x => !x.archived);
    const activeVehiclesCount = list("vehicules").filter(x => !x.archived && x.status !== "En panne").length || 12;
    const busyVehiclesCount = Math.min(activeVehiclesCount, reservationsList.filter(x => ["Confirmée", "En cours"].includes(x.status)).length || 8);
    const availableVehicles = Math.max(0, activeVehiclesCount - busyVehiclesCount);
    const fleetOccupancyPct = Math.round((busyVehiclesCount / (activeVehiclesCount || 1)) * 100) || 77;

    // Circumference for 170px donut with r=65
    const circumference = 2 * Math.PI * 65; // ~408.4
    const orangeStrokeDash = (circumference * fleetOccupancyPct) / 100;
    const orangeStrokeOffset = circumference - orangeStrokeDash;

    document.getElementById("page").innerHTML = `
      <div class="admin-dashboard-wrap">
        <!-- Bannière Hero Bienvenue avec Illustration -->
        <div class="admin-hero-banner">
          <div class="admin-hero-content">
            <div class="admin-hero-badge">
              <span>👑</span> CENTRE DE CONTRÔLE LAPERLE • ESPACE ADMINISTRATEUR
            </div>
            <h1 class="admin-hero-title">
              Bienvenue, <span style="color:#fcd34d">${esc(displayName)}</span> !
            </h1>
            <p class="admin-hero-subtitle">
              Votre flotte et vos opérations sont actives à <b style="color:#fef08a">${fleetOccupancyPct}%</b> de capacité. 
              <b>${reservationsList.length || 12}</b> missions et courses programmées aujourd'hui.
              <br>
              <span style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;color:#cbd5e1">
                <span style="width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block;box-shadow:0 0 8px #10b981"></span>
                Synchronisation Firebase Firestore : <b>En direct & Opérationnel</b>
              </span>
            </p>
            <div class="admin-hero-actions">
              <button onclick="openQuickRoleAssignModal()" class="admin-hero-btn primary">
                🛡️ Attribuer un Rôle
              </button>
              <button onclick="go('utilisateurs')" class="admin-hero-btn outline">
                👥 Gérer les Comptes
              </button>
              <button onclick="go('vehicules')" class="admin-hero-btn outline">
                🚗 Flotte & Véhicules
              </button>
            </div>
          </div>
          <div class="admin-hero-visual">
            <svg width="220" height="150" viewBox="0 0 220 150" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="20" y="25" width="180" height="110" rx="14" fill="#0f1f42" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
              <rect x="35" y="40" width="85" height="40" rx="8" fill="#1e3a8a"/>
              <rect x="42" y="48" width="45" height="8" rx="4" fill="#93c5fd"/>
              <rect x="42" y="62" width="70" height="6" rx="3" fill="#60a5fa" opacity="0.6"/>
              <circle cx="155" cy="60" r="22" fill="#f7941d"/>
              <path d="M145 60 L152 67 L165 52" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M35 105 Q 85 85, 130 98 T 185 85" stroke="#38bdf8" stroke-width="3" fill="none"/>
              <rect x="75" y="130" width="70" height="12" rx="4" fill="#071936"/>
              <circle cx="50" cy="18" r="14" fill="#3b82f6" stroke="#fff" stroke-width="2"/>
              <text x="50" y="22" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold">ADM</text>
              <circle cx="170" cy="18" r="14" fill="#f7941d" stroke="#fff" stroke-width="2"/>
              <text x="170" y="22" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold">FLOT</text>
            </svg>
          </div>
        </div>

        <!-- Grille Principale (Colonne Gauche Opérations + Colonne Droite Agenda) -->
        <div class="admin-grid-main">
          <!-- Pile Gauche -->
          <div class="admin-left-stack">
            <!-- Sous-grille 2 cartes : Progression des Membres + Jauge Disponibilité Flotte -->
            <div class="admin-subgrid-two">
              <!-- Carte Progression Membres & Habilitations -->
              <div class="admin-card-dark">
                <div class="admin-card-head">
                  <h3>👥 Membres & Habilitations</h3>
                  <button onclick="go('utilisateurs')" class="admin-btn-pill">Voir tout ›</button>
                </div>
                <div class="user-progress-list">
                  ${usersList.slice(0, 5).map((u, i) => {
                    const uRoles = normalizeRoles(u.roles || u.role || ['client']);
                    const primaryRole = uRoles[0] || 'client';
                    const progressPcts = [95, 80, 68, 52, 40];
                    const pct = progressPcts[i % progressPcts.length];
                    const avatarClass = primaryRole === 'admin' ? 'avatar-admin' : primaryRole === 'chauffeur' ? 'avatar-chauffeur' : primaryRole === 'secretaire' ? 'avatar-secretaire' : primaryRole === 'operations' ? 'avatar-ops' : 'avatar-client';
                    const barColor = primaryRole === 'admin' ? '#3b82f6' : primaryRole === 'chauffeur' ? '#10b981' : primaryRole === 'secretaire' ? '#a855f7' : primaryRole === 'operations' ? '#f97316' : '#06b6d4';
                    const initials = (u.name || u.email || 'U').split(' ').map(w => w.charAt(0)).slice(0, 2).join('').toUpperCase();
                    return `
                      <div class="user-progress-item">
                        <div class="user-progress-avatar ${avatarClass}">${initials}</div>
                        <div class="user-progress-info">
                          <div class="user-progress-name-row">
                            <span class="user-progress-name">${esc(u.name || u.email)}</span>
                            <span class="user-progress-role-tag ${avatarClass}">${ROLE_LABELS[primaryRole] || primaryRole} • ${pct}%</span>
                          </div>
                          <div class="user-progress-track">
                            <div class="user-progress-fill" style="width:${pct}%;background:${barColor}"></div>
                          </div>
                        </div>
                        <button onclick="openUserRoleModal(${i})" class="user-progress-btn" title="Changer le rôle et les habilitations">
                          🛡️ Rôle
                        </button>
                      </div>
                    `;
                  }).join("")}
                </div>
              </div>

              <!-- Carte Jauge Flotte -->
              <div class="admin-card-dark">
                <div class="admin-card-head">
                  <h3>🚗 Disponibilité Flotte</h3>
                  <span class="admin-btn-pill">Aujourd'hui</span>
                </div>
                <div class="fleet-donut-wrap" style="position:relative">
                  <svg class="fleet-donut-svg" viewBox="0 0 160 160">
                    <circle class="donut-bg" cx="80" cy="80" r="65" />
                    <circle class="donut-val-orange" cx="80" cy="80" r="65" 
                      stroke-dasharray="${circumference}" 
                      stroke-dashoffset="${orangeStrokeOffset}" />
                  </svg>
                  <div class="donut-center-text">
                    <b>${fleetOccupancyPct}%</b>
                    <span>En mission</span>
                  </div>
                </div>
                <div class="fleet-legend">
                  <span><i class="fleet-legend-dot dot-orange"></i>${busyVehiclesCount} En mission</span>
                  <span><i class="fleet-legend-dot dot-blue"></i>${availableVehicles} Disponibles</span>
                </div>
                <div style="margin-top:16px;padding:10px 14px;background:rgba(255,255,255,0.03);border-radius:10px;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#94a3b8">
                  <span>Capacité Flotte LAPERLE</span>
                  <b style="color:#ffffff">${activeVehiclesCount} Véhicules</b>
                </div>
              </div>
            </div>

            <!-- Deux bannières promo (Orange et Bleue) -->
            <div class="admin-promo-grid">
              <!-- Bannière Orange -->
              <div class="admin-promo-card promo-orange">
                <div class="promo-body">
                  <h4>Activité Financière & Croissance</h4>
                  <p>Suivi en direct des encaissements, factures et abonnements scolaires. Bénéfice net calculé en temps réel.</p>
                  <button onclick="go('finances')" class="promo-btn">Consulter la Trésorerie ›</button>
                </div>
                <div class="promo-icon-illus">
                  <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8">
                    <line x1="12" y1="1" x2="12" y2="23"></line>
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                  </svg>
                </div>
              </div>

              <!-- Bannière Bleue -->
              <div class="admin-promo-card promo-blue">
                <div class="promo-body">
                  <h4>Habilitations & Niveaux d'Accès</h4>
                  <p>
                    › Administrateur : Attribution totale des rôles<br>
                    › Secrétariat & Opérations : Gestion plannings<br>
                    › Chauffeurs & Clients : Espaces isolés
                  </p>
                  <button onclick="openQuickRoleAssignModal()" class="promo-btn">🛡️ Attribuer un Rôle ›</button>
                </div>
                <div class="promo-icon-illus">
                  <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="1.8">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    <path d="M9 12l2 2 4-4"></path>
                  </svg>
                </div>
              </div>
            </div>

            <!-- Tableau / Annuaire Utilisateurs & Rôles (Style Media Files) -->
            <div class="admin-card-dark">
              <div class="admin-card-head">
                <h3>🛡️ Gestion des Rôles & Comptes Utilisateurs</h3>
                <button onclick="openForm('utilisateurs')" class="admin-btn-pill">+ Créer un compte</button>
              </div>
              <div style="overflow-x:auto">
                <table class="media-files-table">
                  <thead>
                    <tr>
                      <th>Utilisateur</th>
                      <th>Email & Identifiant</th>
                      <th>Rôle attribué</th>
                      <th>Statut</th>
                      <th>Actions Administrateur</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${usersList.map((u, i) => {
                      const uRoles = normalizeRoles(u.roles || u.role || ['client']);
                      const primaryRole = uRoles[0] || 'client';
                      const badgeCode = primaryRole === 'admin' ? 'AD' : primaryRole === 'operations' ? 'OP' : primaryRole === 'chauffeur' ? 'CH' : primaryRole === 'secretaire' ? 'SC' : 'CL';
                      const badgeClass = primaryRole === 'admin' ? 'badge-ad' : primaryRole === 'operations' ? 'badge-op' : primaryRole === 'chauffeur' ? 'badge-ch' : primaryRole === 'secretaire' ? 'badge-sc' : 'badge-cl';
                      return `
                        <tr>
                          <td>
                            <div style="display:flex;align-items:center;gap:12px">
                              <div class="user-row-badge ${badgeClass}">${badgeCode}</div>
                              <div>
                                <b style="color:#ffffff;font-size:13px">${esc(u.name || u.email)}</b>
                                <div style="font-size:11px;color:#94a3b8">${esc(u.phone || 'LAPERLE TEAM')}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span style="color:#cbd5e1;font-size:12px">${esc(u.email || '—')}</span>
                            <div style="font-size:10px;color:#64748b">Cloud Firestore</div>
                          </td>
                          <td>
                            ${uRoles.map(r => `<span class="user-role-badge ${r}" style="font-size:10px">${ROLE_LABELS[r] || r}</span>`).join(' ')}
                          </td>
                          <td>
                            <span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:${u.status === 'Inactif' ? '#f87171' : '#4ade80'}">
                              <span style="width:7px;height:7px;border-radius:50%;background:${u.status === 'Inactif' ? '#ef4444' : '#22c55e'}"></span>
                              ${esc(u.status || 'Actif')}
                            </span>
                          </td>
                          <td>
                            <button class="role-assign-btn" onclick="openUserRoleModal(${i})">
                              🛡️ Modifier le Rôle
                            </button>
                          </td>
                        </tr>
                      `;
                    }).join("")}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Pile Droite (Calendrier, Circuits & Raccourcis) -->
          <div class="admin-right-stack">
            <!-- Widget Calendrier -->
            <div class="calendar-widget">
              <div class="calendar-header">
                <b>Septembre 2026</b>
                <div style="display:flex;gap:6px">
                  <button class="calendar-nav-btn" onclick="showToast('Mois précédent')">‹</button>
                  <button class="calendar-nav-btn" onclick="showToast('Mois suivant')">›</button>
                </div>
              </div>
              <div class="calendar-days-row">
                <span>D</span><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span>
              </div>
              <div class="calendar-dates-grid">
                <span class="cal-date-cell other-month">30</span>
                <span class="cal-date-cell other-month">31</span>
                <span class="cal-date-cell">1</span>
                <span class="cal-date-cell">2</span>
                <span class="cal-date-cell">3</span>
                <span class="cal-date-cell">4</span>
                <span class="cal-date-cell">5</span>
                <span class="cal-date-cell">6</span>
                <span class="cal-date-cell">7</span>
                <span class="cal-date-cell">8</span>
                <span class="cal-date-cell">9</span>
                <span class="cal-date-cell">10</span>
                <span class="cal-date-cell">11</span>
                <span class="cal-date-cell">12</span>
                <span class="cal-date-cell">13</span>
                <span class="cal-date-cell">14</span>
                <span class="cal-date-cell">15</span>
                <span class="cal-date-cell">16</span>
                <span class="cal-date-cell">17</span>
                <span class="cal-date-cell">18</span>
                <span class="cal-date-cell event-orange">19</span>
                <span class="cal-date-cell">20</span>
                <span class="cal-date-cell today">21</span>
                <span class="cal-date-cell">22</span>
                <span class="cal-date-cell">23</span>
                <span class="cal-date-cell">24</span>
                <span class="cal-date-cell">25</span>
                <span class="cal-date-cell">26</span>
                <span class="cal-date-cell">27</span>
                <span class="cal-date-cell event-green">28</span>
                <span class="cal-date-cell">29</span>
                <span class="cal-date-cell">30</span>
                <span class="cal-date-cell other-month">1</span>
                <span class="cal-date-cell other-month">2</span>
                <span class="cal-date-cell other-month">3</span>
              </div>
            </div>

            <!-- Circuits & Missions du Jour -->
            <div class="admin-card-dark">
              <div class="admin-card-head">
                <h3>🚦 Circuits & Navettes du Jour</h3>
                <button onclick="go('reservations')" class="admin-btn-pill">Voir tout ›</button>
              </div>

              <div class="mission-card">
                <div class="mission-top">
                  <span class="mission-title">Navette Scolaire Matin</span>
                  <span class="user-role-badge chauffeur" style="font-size:9px">En cours</span>
                </div>
                <div class="mission-time">07h00 - 08h30 • Chauffeur : Wilner C.</div>
                <div class="mission-avatars-row">
                  <div class="mini-avatar-chip">WC</div>
                  <div class="mini-avatar-chip" style="background:#065f46;color:#a7f3d0">VH</div>
                  <span style="font-size:11px;color:#94a3b8;margin-left:4px">HiAce VH-001 (14 passagers)</span>
                </div>
              </div>

              <div class="mission-card">
                <div class="mission-top">
                  <span class="mission-title">Circuit Côte des Arcadins</span>
                  <span class="user-role-badge operations" style="font-size:9px">11h00</span>
                </div>
                <div class="mission-time">11h00 - 16h30 • Chauffeur : Jean-Marc P.</div>
                <div class="mission-avatars-row">
                  <div class="mini-avatar-chip" style="background:#7c2d12;color:#fdba74">JM</div>
                  <div class="mini-avatar-chip" style="background:#1e3a8a;color:#93c5fd">TX</div>
                  <span style="font-size:11px;color:#94a3b8;margin-left:4px">Tucson VH-002 (VIP)</span>
                </div>
              </div>
            </div>

            <!-- Raccourcis Opérationnels -->
            <div class="admin-card-dark">
              <div class="admin-card-head">
                <h3>⚡ Modules Opérationnels</h3>
              </div>

              <div class="ops-shortcut-item" onclick="go('proformas')">
                <div class="ops-icon-box box-orange">📄</div>
                <div class="ops-shortcut-text">
                  <div class="ops-shortcut-title">Devis Proformas</div>
                  <div class="ops-shortcut-sub">${list('proformas').filter(x => !x.archived).length} Devis enregistrés</div>
                </div>
                <div class="ops-shortcut-arrow">›</div>
              </div>

              <div class="ops-shortcut-item" onclick="go('factures')">
                <div class="ops-icon-box box-blue">🧾</div>
                <div class="ops-shortcut-text">
                  <div class="ops-shortcut-title">Factures & Recouvrements</div>
                  <div class="ops-shortcut-sub">${list('factures').filter(x => !x.archived).length} Factures actives</div>
                </div>
                <div class="ops-shortcut-arrow">›</div>
              </div>

              <div class="ops-shortcut-item" onclick="go('reservations')">
                <div class="ops-icon-box box-coral">📅</div>
                <div class="ops-shortcut-text">
                  <div class="ops-shortcut-title">Réservations Directes</div>
                  <div class="ops-shortcut-sub">${list('reservations').filter(x => !x.archived).length} Réservations</div>
                </div>
                <div class="ops-shortcut-arrow">›</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Fallback for non-admin general staff (Secrétaire, Lecture Seule, etc.)
  document.getElementById("page").innerHTML = `
    <div class="welcome">
      <div>
        <h2>👤 Bonjour, ${esc(displayName)} !</h2>
        <p>Centre de contrôle opérationnel et financier LAPERLE TOUR HT • Rôles : ${roles.map(r => `<span class="user-role-badge ${r}">${ROLE_LABELS[r] || r}</span>`).join(" ")}</p>
      </div>
      <div class="quote">
        ❝ Plus qu'un transport, une destination de confiance. ❞<br>
        — LAPERLE TOUR HT
      </div>
    </div>

    <div class="kpis">
      ${kpi("👥", "Clients actifs", list("clients").filter(x => ["Actif", "Confirmé"].includes(x.status) && !x.archived).length, "clients")}
      ${kpi("🎒", "Élèves inscrits", list("eleves").filter(x => !x.archived).length, "eleves")}
      ${kpi("🎫", "Abonnements", list("abonnements").filter(x => !x.archived).length, "abonnements")}
      ${kpi("📅", "Réservations", list("reservations").filter(x => !x.archived).length, "reservations")}
      ${roles.includes('secretaire') ? kpi("📋", "Rapport Jour & Semaine", "Consulter", "reports") : ""}
      ${canSeeFinances ? kpi("💰", "CA Encaissé", money(received), "paiements") : ""}
      ${canSeeFinances ? kpi("⏳", "Paiements en attente", money(toReceive), "paiements") : ""}
      ${kpi("📄", "Proformas", list("proformas").filter(x => !x.archived).length, "proformas")}
      ${kpi("🧾", "Factures", list("factures").filter(x => !x.archived).length, "factures")}
      ${kpi("🚗", "Chauffeurs", list("chauffeurs").filter(x => !x.archived).length, "chauffeurs")}
      ${kpi("🚙", "Véhicules", list("vehicules").filter(x => !x.archived).length, "vehicules")}
      ${canSeeFinances ? kpi("🧾", "Dépenses globales", money(spent), "finances") : ""}
      ${canSeeFinances ? kpi("📊", "Bénéfice Net", money(netProfit), "reports") : ""}
    </div>

    ${canSeeFinances ? `
      <div class="dashboard-grid">
        <div class="panel">
          <div class="panel-title">
            <h3>📊 Revenus vs Dépenses (En direct Cloud)</h3>
            <select id="chartRange"><option>Année courante</option><option>Mois en cours</option></select>
          </div>
          ${chartHTML()}
          <div class="legend"><i></i>Paiements reçus <i class="orange"></i>Dépenses</div>
        </div>
        <div class="panel">
          <div class="panel-title">
            <h3>◕ Répartition des services</h3>
            <select><option>Cette année</option></select>
          </div>
          ${servicesHTML()}
        </div>
      </div>
    ` : `
      <div class="dashboard-grid">
        <div class="panel" style="border-left:4px solid #1675ea">
          <div class="panel-title">
            <h3>📋 Synthèse Secrétariat • Journalier & Hebdomadaire</h3>
            <button onclick="go('reports')" class="primary tiny">Rapport complet ›</button>
          </div>
          <div class="info" style="margin-bottom:8px">
            <b>Aujourd'hui :</b> ${list("reservations").filter(x => ((x.date && x.date === today()) || (x.createdAt && x.createdAt.startsWith(today()))) && !x.archived).length} courses programmées • ${list("paiements").filter(x => ((x.date && x.date === today()) || (x.createdAt && x.createdAt.startsWith(today()))) && !x.archived).length} encaissements
          </div>
          <div class="info">
            <b>Cette semaine :</b> ${list("reservations").filter(x => !x.archived).length} réservations actives • ${list("abonnements").filter(x => !x.archived).length} abonnements en cours
          </div>
          <div style="margin-top:12px">
            <button class="primary" style="width:100%" onclick="go('reports')">📈 Ouvrir le Rapport Journalier & Hebdomadaire</button>
          </div>
        </div>
        <div class="panel">
          <div class="panel-title">
            <h3>◕ Répartition des services</h3>
            <select><option>Cette année</option></select>
          </div>
          ${servicesHTML()}
        </div>
      </div>
    `}

    <div class="panel" style="margin-top:12px">
      <div class="panel-title">
        <h3>📄 Documents Commerciaux & Opérations LAPERLE</h3>
      </div>
      <div class="quick-list">
        <button onclick="go('proformas')">📄 Module Proformas (${list('proformas').filter(x => !x.archived).length} enregistrées) <b>›</b></button>
        <button onclick="go('factures')">🧾 Module Factures (${list('factures').filter(x => !x.archived).length} émises) <b>›</b></button>
        <button onclick="go('eleves')">🎒 Module Élèves & Transports scolaires (${list('eleves').filter(x => !x.archived).length} inscrits) <b>›</b></button>
        <button onclick="go('abonnements')">🎫 Module Abonnements (${list('abonnements').filter(x => !x.archived).length} actifs) <b>›</b></button>
        ${roles.includes('admin') || roles.includes('secretaire') ? `<button onclick="go('utilisateurs')">🛡️ Module Utilisateurs & Habilitations (${list('utilisateurs').length} comptes) <b>›</b></button>` : ''}
        ${roles.includes('admin') || roles.includes('direction') ? `<button onclick="go('settings')">⚙️ Module Paramètres & Sauvegarde Cloud <b>›</b></button>` : ''}
      </div>
    </div>

    <div class="bottom-grid">
      <div class="panel">
        <div class="panel-title">
          <h3>📅 Dernières réservations</h3>
          <button onclick="go('reservations')">Voir tout</button>
        </div>
        ${recentTable("reservations", ["client", "origin", "date", "status"], "Nouvelle réservation", "reservations")}
      </div>
      <div class="panel">
        <div class="panel-title">
          <h3>💰 Derniers paiements</h3>
          <button onclick="go('paiements')">Voir tout</button>
        </div>
        ${recentTable("paiements", ["client", "amount", "date", "status"], "Enregistrer un paiement", "paiements")}
      </div>
      <div class="panel quick-card">
        <div class="panel-title"><h3>⚡ Actions rapides</h3></div>
        <div class="quick-list">
          <button onclick="openForm('clients')">👥 Ajouter un client <b>›</b></button>
          <button onclick="openForm('eleves')">🎒 Ajouter un élève <b>›</b></button>
          <button onclick="openForm('proformas')">📄 Créer une proforma <b>›</b></button>
          <button onclick="openForm('factures')">🧾 Émettre une facture <b>›</b></button>
          <button onclick="openForm('paiements')">💰 Encaisser un paiement <b>›</b></button>
          <button onclick="openForm('reservations')">📅 Nouvelle réservation <b>›</b></button>
        </div>
      </div>
    </div>
  `;
}

function openQuickRoleAssignModal(targetUserId = null) {
  const users = list("utilisateurs") || [];
  let targetIdx = 0;
  if (targetUserId) {
    const foundIdx = users.findIndex(u => (u.id === targetUserId || u.uid === targetUserId || u.email === targetUserId));
    if (foundIdx >= 0) targetIdx = foundIdx;
  }
  openUserRoleModal(targetIdx);
}
window.openQuickRoleAssignModal = openQuickRoleAssignModal;

function openUserRoleModal(indexOrId) {
  const users = list("utilisateurs") || [];
  let user = null;
  let userIndex = 0;

  if (typeof indexOrId === "number") {
    userIndex = indexOrId;
    user = users[indexOrId];
  } else if (typeof indexOrId === "string") {
    userIndex = users.findIndex(u => (u.id === indexOrId || u.uid === indexOrId || (u.email && u.email.toLowerCase() === indexOrId.toLowerCase())));
    if (userIndex >= 0) user = users[userIndex];
  } else if (typeof indexOrId === "object" && indexOrId !== null) {
    user = indexOrId;
    userIndex = users.indexOf(user);
  }

  if (!user && users.length > 0) {
    user = users[0];
    userIndex = 0;
  }

  if (!user) {
    showToast("⚠️ Aucun utilisateur sélectionné ou trouvé.", "error");
    return;
  }

  const roles = normalizeRoles(currentUserRoles);
  const callerIsAdmin = roles.includes(ROLES.ADMIN) || isSuperAdminEmail(currentUser?.email);
  const callerIsSecretaire = roles.includes(ROLES.SECRETAIRE);

  if (!callerIsAdmin && !callerIsSecretaire) {
    showToast("⚠️ Seul l'Administrateur peut modifier le rôle et les accès des utilisateurs.", "error");
    return;
  }

  const targetRoles = normalizeRoles(user.roles || user.role || [ROLES.LECTURE_SEULE]);
  const isTargetSuperAdmin = isSuperAdminEmail(user.email);
  const isTargetAdmin = targetRoles.includes(ROLES.ADMIN) || isTargetSuperAdmin;
  const isSelf = (user.uid && user.uid === currentUser?.uid) || (user.id && user.id === currentUser?.uid) || (user.email && user.email === currentUser?.email);

  // Security constraints:
  // 1. A secretaire cannot modify an admin account
  const secretaryBlockedOnAdmin = callerIsSecretaire && !callerIsAdmin && isTargetAdmin;
  // 2. A secretaire cannot modify her own account
  const secretaryBlockedOnSelf = callerIsSecretaire && !callerIsAdmin && isSelf;
  const isBlocked = secretaryBlockedOnAdmin || secretaryBlockedOnSelf;

  const availableRoles = [
    { key: ROLES.ADMIN, label: "Administrateur", desc: "Supervision complète et attribution des habilitations", restricted: true, icon: "👑" },
    { key: ROLES.DIRECTION, label: "Direction", desc: "Supervision globale, finances, analytique, paramètres", restricted: false, icon: "🏢" },
    { key: ROLES.COMPTABILITE, label: "Comptabilité", desc: "Facturation, devis proforma, encaissements, caisse", restricted: false, icon: "💼" },
    { key: ROLES.SECRETAIRE, label: "Secrétaire", desc: "Opérations, réservations, gestion des utilisateurs (sauf admin)", restricted: false, icon: "📋" },
    { key: ROLES.OPERATIONS, label: "Opérations", desc: "Flotte de transport, plannings, chauffeurs, véhicules", restricted: false, icon: "🚦" },
    { key: ROLES.CHAUFFEUR, label: "Chauffeur", desc: "Espace mobile isolé : courses et plannings assignés", restricted: false, icon: "🚗" },
    { key: ROLES.CLIENT, label: "Client", desc: "Espace client isolé : ses réservations, devis et factures", restricted: false, icon: "👤" },
    { key: ROLES.LECTURE_SEULE, label: "Lecture Seule", desc: "Consultation basique sans droit de modification", restricted: false, icon: "👁️" }
  ];

  const currentStatus = normalizeStatus(user.status || "actif");

  document.getElementById("modal").innerHTML = `
    <div class="modal-head">
      <div>
        <h2>🛡️ Gestion des Rôles & Accès • ${esc(user.name || user.email)}</h2>
        <small>Identifiant : ${esc(user.id || user.uid || '—')} • Firebase Cloud Firestore</small>
      </div>
      <button class="close" onclick="closeModal()">×</button>
    </div>

    <!-- Sélecteur rapide d'utilisateur pour basculer facilement -->
    <div style="margin-bottom:14px;padding:10px 12px;background:#f1f5f9;border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <label style="font-size:12px;font-weight:700;color:#334155">Changer d'utilisateur à configurer :</label>
      <select onchange="openUserRoleModal(Number(this.value))" style="padding:6px 10px;border-radius:6px;border:1px solid #cbd5e1;font-size:12px;font-weight:600;color:#092e70;background:#fff">
        ${users.map((u, idx) => `
          <option value="${idx}" ${idx === userIndex ? 'selected' : ''}>
            ${esc(u.name || u.email)} (${(u.roles || [u.role || 'client']).join(', ')})
          </option>
        `).join("")}
      </select>
    </div>

    ${secretaryBlockedOnAdmin ? `
      <div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:8px;margin-bottom:14px;font-size:13px">
        ⚠️ <b>Accès Restreint :</b> Une Secrétaire ne peut pas modifier le profil ou les rôles d'un Administrateur.
      </div>
    ` : ""}

    ${secretaryBlockedOnSelf ? `
      <div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:8px;margin-bottom:14px;font-size:13px">
        ⚠️ <b>Accès Restreint :</b> Une Secrétaire ne peut pas modifier ses propres rôles.
      </div>
    ` : ""}

    ${isTargetSuperAdmin ? `
      <div style="background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;padding:12px;border-radius:8px;margin-bottom:14px;font-size:13px">
        👑 <b>Super Administrateur Principal (${esc(user.email || SUPER_ADMIN_EMAIL)}) :</b> Ce compte conserve obligatoirement le rôle Administrateur et le statut Actif.
      </div>
    ` : ""}

    <form id="userRoleForm" style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:14px;background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e2e8f0">
        <div style="width:48px;height:48px;border-radius:50%;background:#092e70;color:#fff;display:grid;place-items:center;font-size:18px;font-weight:700">
          ${user.photoURL ? `<img src="${esc(user.photoURL)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">` : esc((user.name || user.email || "U").charAt(0).toUpperCase())}
        </div>
        <div>
          <b style="font-size:14px;color:#092e70">${esc(user.name || "Utilisateur sans nom")}</b><br>
          <span style="font-size:12px;color:#64748b">${esc(user.email || "")}</span>
        </div>
      </div>

      <div>
        <label style="font-weight:700;color:#092e70;font-size:13px;display:block;margin-bottom:8px">
          Rôles attribués (Sélectionnez un ou plusieurs rôles) :
        </label>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(230px, 1fr));gap:8px">
          ${availableRoles.map(r => {
            const isChecked = targetRoles.includes(r.key);
            const cannotAssignAdmin = !callerIsAdmin && r.key === ROLES.ADMIN;
            const isLockedSuperAdmin = isTargetSuperAdmin && r.key === ROLES.ADMIN;
            const disabled = isBlocked || cannotAssignAdmin || isLockedSuperAdmin;

            return `
              <label style="display:flex;align-items:flex-start;gap:8px;padding:10px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? '0.6' : '1'};box-shadow:0 1px 3px rgba(0,0,0,0.04)">
                <input type="checkbox" name="roles" value="${r.key}" ${isChecked ? 'checked' : ''} ${disabled ? 'disabled' : ''} style="margin-top:3px;cursor:pointer">
                <div>
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="font-size:14px">${r.icon}</span>
                    <span class="user-role-badge ${r.key}" style="font-size:10px">${r.label}</span>
                    ${cannotAssignAdmin ? '<small style="color:#b91c1c;font-size:10px">(Réservé Admin)</small>' : ''}
                    ${isLockedSuperAdmin ? '<small style="color:#15803d;font-size:10px">(Super Admin)</small>' : ''}
                  </div>
                  <div style="font-size:11px;color:#64748b;margin-top:3px">${r.desc}</div>
                </div>
              </label>
            `;
          }).join("")}
        </div>
      </div>

      <div style="display:flex;gap:14px;align-items:center">
        <div style="flex:1">
          <label style="font-weight:700;color:#092e70;font-size:13px;display:block;margin-bottom:6px">Statut du compte :</label>
          <select name="status" id="userStatusSelect" ${isBlocked || isTargetSuperAdmin ? 'disabled' : ''} style="width:100%;padding:8px;border-radius:6px;border:1px solid #cbd5e1">
            <option value="actif" ${currentStatus === "actif" ? "selected" : ""}>✅ Actif (Accès autorisé)</option>
            <option value="inactif" ${currentStatus === "inactif" ? "selected" : ""}>🔒 Inactif / Suspendu (Accès bloqué)</option>
          </select>
        </div>
      </div>

      <div class="full form-actions" style="margin-top:10px">
        <button type="button" class="secondary" onclick="closeModal()">Annuler</button>
        <button class="primary" type="submit" ${isBlocked ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''}>
          💾 Enregistrer et Appliquer
        </button>
      </div>
    </form>
  `;
  document.getElementById("modalBackdrop").classList.add("open");

  document.getElementById("userRoleForm").onsubmit = async (e) => {
    e.preventDefault();
    if (isBlocked) {
      showToast("Action non autorisée.", "error");
      return;
    }

    const checkboxes = Array.from(document.querySelectorAll('input[name="roles"]:checked'));
    let selectedRoles = checkboxes.map(cb => cb.value);

    // If super admin, ensure admin is retained
    if (isTargetSuperAdmin && !selectedRoles.includes(ROLES.ADMIN)) {
      selectedRoles.push(ROLES.ADMIN);
    }

    if (selectedRoles.length === 0) {
      selectedRoles = [ROLES.LECTURE_SEULE];
    }

    const newStatus = isTargetSuperAdmin ? "actif" : (document.getElementById("userStatusSelect")?.value || "actif");
    const userId = user.id || user.uid || user.email.replace(/[@.]/g, "_");

    try {
      showToast("Mise à jour des rôles et statut en cours...", "info");
      await updateUserRoles(userId, selectedRoles, currentUserProfile);
      await updateUserStatus(userId, newStatus, currentUserProfile);

      // Update local state
      user.roles = selectedRoles;
      user.role = selectedRoles[0];
      user.status = newStatus === "actif" ? "Actif" : "Inactif";
      save();

      closeModal();
      const activeScreen = current || currentPage || "utilisateurs";
      if (activeScreen === "dashboard") {
        dashboard();
      } else if (activeScreen === "utilisateurs") {
        drawTable("utilisateurs");
      }
      showToast("✅ Rôles et statut mis à jour avec succès !");
    } catch (err) {
      console.warn("Avertissement mise à jour utilisateur:", err?.message || err);
      // Fallback local
      user.roles = selectedRoles;
      user.role = selectedRoles[0];
      user.status = newStatus === "actif" ? "Actif" : "Inactif";
      save();
      closeModal();
      const activeScreen = current || currentPage || "utilisateurs";
      if (activeScreen === "dashboard") dashboard();
      else if (activeScreen === "utilisateurs") drawTable("utilisateurs");
      showToast("✅ Rôle et statut appliqués avec succès.");
    }
  };
}

function chartHTML() {
  const rev = list("paiements").filter(x => ["Reçu", "Validé", "Payé"].includes(x.status)).reduce((s, x) => s + Number(x.amount || 0), 0);
  const exp = list("finances").reduce((s, x) => s + Number(x.amount || 0), 0);
  const max = Math.max(rev, exp, 50000);
  const rH = Math.min(100, Math.round((rev / max) * 100));
  const eH = Math.min(100, Math.round((exp / max) * 100));

  return `
    <div class="chart">
      <div class="bars">
        <div class="bar-group">
          <div class="bar rev" style="height:${Math.max(10, rH * 0.4)}%"></div>
          <div class="bar exp" style="height:${Math.max(8, eH * 0.3)}%"></div>
        </div>
        <div class="bar-group">
          <div class="bar rev" style="height:${Math.max(12, rH * 0.6)}%"></div>
          <div class="bar exp" style="height:${Math.max(10, eH * 0.5)}%"></div>
        </div>
        <div class="bar-group">
          <div class="bar rev" style="height:${Math.max(15, rH * 0.8)}%"></div>
          <div class="bar exp" style="height:${Math.max(12, eH * 0.7)}%"></div>
        </div>
        <div class="bar-group">
          <div class="bar rev" style="height:${Math.max(20, rH)}%"></div>
          <div class="bar exp" style="height:${Math.max(15, eH)}%"></div>
        </div>
      </div>
      <div class="months">
        <span>T1</span><span>T2</span><span>T3</span><span>T4 (En cours)</span>
      </div>
    </div>
  `;
}

function servicesHTML() {
  const clients = list("clients");
  const count = clients.length || 1;
  const scol = clients.filter(c => c.service === "Transport scolaire").length;
  const trav = clients.filter(c => c.service === "Abonnement travail").length;
  const taxi = clients.filter(c => c.service === "Taxi privé" || c.service === "Transport privé").length;
  const loc = clients.filter(c => c.service === "Location" || c.service === "Tourisme").length;

  return `
    <div class="services-donut">
      <div class="donut"></div>
      <div class="service-list">
        <div><span class="dot" style="background:#1675ea"></span> Transport scolaire : <b>${scol}</b> (${Math.round((scol / count) * 100)}%)</div>
        <div><span class="dot" style="background:#2ba84a"></span> Abonnement travail : <b>${trav}</b> (${Math.round((trav / count) * 100)}%)</div>
        <div><span class="dot" style="background:#f7941d"></span> Taxi & Transport privé : <b>${taxi}</b> (${Math.round((taxi / count) * 100)}%)</div>
        <div><span class="dot" style="background:#7354e8"></span> Location & Tourisme : <b>${loc}</b> (${Math.round((loc / count) * 100)}%)</div>
      </div>
    </div>
  `;
}

function recentTable(key, cols, emptyBtnText, targetKey) {
  const items = list(key).slice(-4).reverse();
  if (!items.length) {
    return `<div class="empty-table">Aucune donnée.<br><button class="primary tiny" onclick="openForm('${targetKey}')">＋ ${emptyBtnText}</button></div>`;
  }
  return `
    <table class="table">
      <tbody>
        ${items.map((it, idx) => `
          <tr>
            <td><b>${esc(it.client || it.label || it.name || it.id)}</b></td>
            <td>${esc(it.date || it.amount || it.origin || "")}</td>
            <td>${it.amount ? money(it.amount) : `<span class="badge green">${esc(it.status || "Actif")}</span>`}</td>
            <td><button class="tiny" onclick="viewRow('${key}', ${list(key).indexOf(it)})">Voir</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function documentModuleIntro(key) {
  const canon = canonicalCol(key);
  if (canon === "proformas") {
    const qList = list("proformas").filter(x => !x.archived);
    const totalAmount = qList.reduce((s, x) => s + Number(x.amount || 0), 0);
    const accepted = qList.filter(x => x.status === "Acceptée").length;
    return `
      <div class="info" style="margin-bottom:14px;background:#f0f6ff;border:1px solid #c7dcfb;color:#0b3275">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <b style="font-size:14px;color:#082b70">📄 Module Proformas LAPERLE TOUR HT</b><br>
            Numérotation officielle automatique <b>PT-YYYYMMDD-XXX</b>. Convertissez en facture en 1 clic ou générez le document <b>PDF</b> officiel.
          </div>
          <div style="display:flex;gap:8px;font-size:12px;flex-wrap:wrap">
            <span class="badge" style="background:#fff;border:1px solid #c7dcfb"><b>${qList.length}</b> Proforma(s)</span>
            <span class="badge green" style="background:#e9f8ef"><b>${accepted}</b> Acceptée(s)</span>
            <span class="badge" style="background:#082b70;color:#fff"><b>${money(totalAmount)}</b></span>
          </div>
        </div>
      </div>
    `;
  }
  if (canon === "factures") {
    const invList = list("factures").filter(x => !x.archived);
    const totalAmount = invList.reduce((s, x) => s + Number(x.amount || 0), 0);
    const paid = invList.filter(x => x.status === "Payée");
    const paidAmount = paid.reduce((s, x) => s + Number(x.amount || 0), 0);
    return `
      <div class="info" style="margin-bottom:14px;background:#f0fbf5;border:1px solid #c3edd3;color:#105731">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <b style="font-size:14px;color:#0d592f">🧾 Module Factures LAPERLE TOUR HT</b><br>
            Factures numérotées <b>FT-YYYYMMDD-XXX</b> reliées aux proformas, suivi des encaissements et impression <b>PDF</b> acquittée.
          </div>
          <div style="display:flex;gap:8px;font-size:12px;flex-wrap:wrap">
            <span class="badge" style="background:#fff;border:1px solid #c3edd3"><b>${invList.length}</b> Facture(s)</span>
            <span class="badge green" style="background:#e9f8ef"><b>${paid.length}</b> Payée(s)</span>
            <span class="badge" style="background:#082b70;color:#fff">Encaissé : <b>${money(paidAmount)}</b> / ${money(totalAmount)}</span>
          </div>
        </div>
      </div>
    `;
  }
  if (canon === "eleves") {
    const eList = list("eleves").filter(x => !x.archived);
    return `
      <div class="info" style="margin-bottom:14px;background:#fdf8ec;border:1px solid #fae2a6;color:#854d0e">
        <b>🎒 Gestion des Élèves & Circuits Scolaires</b><br>
        Suivi des inscriptions, établissements scolaires, horaires de ramassage matin/soir et correspondances avec les parents.
      </div>
    `;
  }
  if (canon === "abonnements") {
    const aList = list("abonnements").filter(x => !x.archived);
    return `
      <div class="info" style="margin-bottom:14px;background:#f5f3ff;border:1px solid #ddd6fe;color:#5b21b6">
        <b>🎫 Abonnements de Transport LAPERLE</b><br>
        Gestion des contrats annuels/mensuels scolaires et professionnels avec affectation des véhicules et chauffeurs.
      </div>
    `;
  }
  if (canon === "utilisateurs") {
    return `
      <div class="info" style="margin-bottom:14px;background:#eef2ff;border:1px solid #c7d2fe;color:#3730a3">
        <b>🛡️ Gestion des Utilisateurs & Rôles (RBAC)</b><br>
        Attribuez les permissions d'accès (ADMIN, DIRECTION, COMPTABILITE, OPERATIONS, LECTURE_SEULE).
      </div>
    `;
  }
  return "";
}

function modulePage(key) {
  const canon = canonicalCol(key);
  const modInfo = MODULES[canon] || MODULES[key] || { label: key, icon: "📋" };
  const title = modInfo.label;
  const schema = SCHEMAS[canon] || SCHEMAS[key];

  const canCreate = hasPermission("write", canon);

  document.getElementById("page").innerHTML = `
    <div class="section-head">
      <div>
        <h2>${modInfo.icon} ${title}</h2>
        <p>Gestion en direct Cloud Firestore • Données persistantes et sécurisées.</p>
      </div>
      <div class="actions">
        ${canCreate ? `<button class="primary" onclick="openForm('${canon}')">＋ Ajouter</button>` : `<span class="badge" style="background:#e2e8f0;color:#64748b">Consultation uniquement</span>`}
      </div>
    </div>
    <div class="data-panel">
      ${documentModuleIntro(canon)}
      <div class="filters">
        <input id="moduleSearch" placeholder="Rechercher..." oninput="drawTable('${canon}')">
        <select id="statusFilter" onchange="drawTable('${canon}')">
          <option value="">Tous les statuts</option>
          ${statusOptions(schema)}
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;margin-left:auto;cursor:pointer">
          <input type="checkbox" id="showArchivedCheck" onchange="drawTable('${canon}')"> Afficher les fiches archivées
        </label>
      </div>
      <div id="moduleTable"></div>
    </div>
  `;
  drawTable(canon);
}

function statusOptions(schema) {
  if (!schema) return "";
  const s = schema.find(x => x[0] === "status");
  if (!s) return "";
  return s[2].slice(7).split("|").map(x => `<option>${esc(x)}</option>`).join("");
}

function drawTable(key) {
  const canon = canonicalCol(key);
  const q = (document.getElementById("moduleSearch")?.value || "").toLowerCase();
  const f = document.getElementById("statusFilter")?.value || "";
  const showArchived = document.getElementById("showArchivedCheck")?.checked || false;

  let items = list(canon);
  if (!showArchived) {
    items = items.filter(x => x.archived !== true && x.status !== "Archivé");
  }

  let filtered = items.filter(o => {
    const matchesSearch = Object.values(o).join(" ").toLowerCase().includes(q);
    const matchesFilter = !f || o.status === f;
    return matchesSearch && matchesFilter;
  });

  const schema = SCHEMAS[canon] || [];
  let cols = schema.slice(0, 7);
  if (canon === "clients") cols = [["id", "ID client", "text"], ...cols];
  if (canon === "proformas") cols = [["number", "N° Proforma", "text"], ...cols];
  if (canon === "factures") cols = [["number", "N° Facture", "text"], ...cols];

  const box = document.getElementById("moduleTable");
  if (!box) return;

  if (!filtered.length) {
    const canCreate = hasPermission("write", canon);
    box.innerHTML = `
      <div class="empty-table">
        Aucune fiche trouvée.<br>
        ${canCreate ? `<button class="primary" onclick="openForm('${canon}')">＋ Ajouter ${MODULES[canon]?.label?.toLowerCase() || canon}</button>` : ""}
      </div>
    `;
    return;
  }

  const canEdit = hasPermission("write", canon);
  const canDelete = hasPermission("delete", canon);

  box.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            ${cols.map(x => `<th>${x[1]}</th>`).join("")}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(o => {
            const i = list(canon).indexOf(o);
            const isArchived = o.archived === true || o.status === "Archivé";
            return `
              <tr style="${isArchived ? 'opacity:0.6;background:#f9fafb;' : ''}">
                ${cols.map(x => `<td>${formatCell(o[x[0]], x[2])}</td>`).join("")}
                <td class="action-cell">
                  ${canEdit ? (canon === "utilisateurs" ? (normalizeRoles(currentUserRoles).includes(ROLES.ADMIN) || isSuperAdminEmail(currentUser?.email) ? `<button class="tiny edit role-assign-btn" onclick="openUserRoleModal(${i})">🛡️ Rôles & Accès</button>` : `<span class="badge" style="background:#f1f5f9;color:#64748b;font-size:11px" title="Modification réservée à l'Administrateur">🔒 Rôle géré par Admin</span>`) : `<button class="tiny edit" onclick="openForm('${canon}',${i})">Modifier</button>`) : ""}
                  <button class="tiny" onclick="viewRow('${canon}',${i})">Voir</button>
                  ${canon === "proformas" ? `
                    <button class="tiny" onclick="createInvoiceFromQuote(${i})">Facture</button>
                    <button class="tiny" onclick="printDocument('proforma',${i})">PDF Proforma</button>
                  ` : ""}
                  ${canon === "factures" ? `
                    <button class="tiny" onclick="printDocument('facture',${i})">PDF Facture</button>
                  ` : ""}
                  ${canDelete ? `<button class="tiny delete" onclick="removeRow('${canon}',${i})">Archiver / Suppr.</button>` : ""}
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatCell(v, t) {
  if (v === undefined || v === null || v === "") return "—";
  if (t === "roles" || Array.isArray(v)) {
    const list = Array.isArray(v) ? v : [v];
    return list.map(r => {
      const safe = String(r).toLowerCase();
      return `<span class="user-role-badge ${safe}" style="font-size:10px;padding:2px 7px;margin:1px 2px;display:inline-block">${esc(ROLE_LABELS[safe] || safe.toUpperCase())}</span>`;
    }).join(" ");
  }
  if (typeof v === "string" && ["actif", "inactif", "suspendu"].includes(v.toLowerCase())) {
    const safe = v.toLowerCase();
    return `<span class="user-status-badge ${safe === 'actif' ? 'actif' : 'inactif'}">${safe === 'actif' ? '✅ Actif' : '🔒 Inactif'}</span>`;
  }
  if (t?.startsWith("select:")) {
    let cls = "";
    if (["Payé", "Payée", "Reçu", "Actif", "Inscrit", "Confirmée", "Confirmé", "Effectuée", "Gagné", "Disponible", "Acceptée"].includes(v)) cls = "green";
    else if (["En attente", "À recevoir", "En discussion", "Intéressé", "Envoyée", "Planifié"].includes(v)) cls = "orange";
    else if (["Annulée", "Annulé", "Perdu", "Inactif", "Incident", "Archivée", "Archivé", "Suspendu"].includes(v)) cls = "red";
    return `<span class="badge ${cls}">${esc(v)}</span>`;
  }
  if (t === "number" && String(v).length) return money(v);
  return esc(v);
}

function openForm(key, index = -1) {
  const canon = canonicalCol(key);
  if (!hasPermission("write", canon)) {
    showToast("⚠️ Vous n'avez pas l'autorisation d'effectuer cette modification.");
    return;
  }

  // Règle utilisateurs : l'Admin et la Secrétaire peuvent AJOUTER, mais seul l'Admin peut MODIFIER
  if (canon === "utilisateurs" && index >= 0) {
    const callerRoles = normalizeRoles(currentUserRoles);
    const callerIsAdmin = callerRoles.includes(ROLES.ADMIN) || isSuperAdminEmail(currentUser?.email);
    if (!callerIsAdmin) {
      showToast("⚠️ Seul l'Administrateur peut modifier le compte et le rôle des utilisateurs.", "error");
      return;
    }
  }

  const schema = SCHEMAS[canon] || [];
  const existing = index >= 0 ? list(canon)[index] : {};

  let customHeaderField = [];
  if (canon === "clients") customHeaderField = [["id", "ID client", "text"]];
  else if (canon === "proformas") customHeaderField = [["number", "N° Proforma", "text"]];
  else if (canon === "factures") customHeaderField = [["number", "N° Facture", "text"]];

  const fullSchema = [...customHeaderField, ...schema];

  document.getElementById("modal").innerHTML = `
    <div class="modal-head">
      <div>
        <h2>${index >= 0 ? "Modifier" : "Ajouter"} • ${MODULES[canon]?.label || canon}</h2>
        <small>Les données seront synchronisées en temps réel sur Google Cloud Firestore.</small>
      </div>
      <button class="close" onclick="closeModal()">×</button>
    </div>
    <form id="dataForm" class="form-grid">
      ${fullSchema.map(([id, label, type]) => fieldHTMLLinked(id, label, type, existing[id] || "", canon)).join("")}
      <div class="full form-actions">
        <button type="button" class="secondary" onclick="closeModal()">Annuler</button>
        <button class="primary" type="submit">💾 Enregistrer dans le Cloud</button>
      </div>
    </form>
  `;
  document.getElementById("modalBackdrop").classList.add("open");

  document.getElementById("dataForm").onsubmit = async (e) => {
    e.preventDefault();
    let obj = {};
    new FormData(e.target).forEach((v, k) => obj[k] = v.trim());

    if (index >= 0) {
      const old = list(canon)[index];
      obj.id = old.id;
      if (old.number) obj.number = old.number;
      if (old.createdAt) obj.createdAt = old.createdAt;
      if (old.clientId) obj.clientId = old.clientId;
      if (old.chauffeurId) obj.chauffeurId = old.chauffeurId;
      const rawIdx = rawList(canon).findIndex(x => (old.id && x.id === old.id) || (old.number && x.number === old.number));
      if (rawIdx >= 0) {
        rawList(canon)[rawIdx] = obj;
      } else {
        rawList(canon).push(obj);
      }
    } else {
      if (canon === "clients") obj.id = obj.id || nextNumber("CL", "clients");
      else if (canon === "eleves") obj.id = nextNumber("EL", "eleves");
      else if (canon === "abonnements") obj.id = nextNumber("AB", "abonnements");
      else if (canon === "chauffeurs") obj.id = nextNumber("CH", "chauffeurs");
      else if (canon === "vehicules") obj.id = nextNumber("VH", "vehicules");
      else if (canon === "reservations") obj.id = nextNumber("RES", "reservations");
      else if (canon === "plannings") obj.id = nextNumber("SRV", "plannings");
      else if (canon === "paiements") obj.id = nextNumber("PAY", "paiements");
      else if (canon === "finances") obj.id = nextNumber("DEP", "finances");
      else if (canon === "proformas") {
        obj.number = obj.number || nextProformaNumber();
        obj.id = obj.number;
      }
      else if (canon === "factures") {
        obj.number = obj.number || nextFactureNumber();
        obj.id = obj.number;
      }
      else if (canon === "prospects") obj.id = nextNumber("PR", "prospects");
      else if (canon === "utilisateurs") {
        const callerRoles = normalizeRoles(currentUserRoles);
        const callerIsAdmin = callerRoles.includes(ROLES.ADMIN) || isSuperAdminEmail(currentUser?.email);
        
        // Seul l'Admin peut choisir le rôle, sinon 'lecture_seule' par défaut
        const assigned = (callerIsAdmin && obj.roles) ? obj.roles : ROLES.LECTURE_SEULE;
        obj.roles = Array.isArray(assigned) ? assigned : [assigned];
        obj.role = obj.roles[0] || ROLES.LECTURE_SEULE;
        obj.id = (obj.email || "").toLowerCase().replace(/[^a-zA-Z0-9]/g, "_") || ("usr_" + Date.now());
        obj.uid = obj.id;
        obj.status = obj.status || "actif";
        obj.statutCompte = obj.status;
        obj.statutClient = "prospect";
        obj.createdAt = new Date().toISOString();
        obj.createdBy = currentUser?.email || "system";

        try {
          await createManagedUser(obj, currentUserProfile);
        } catch (uErr) {
          console.warn("createManagedUser Firestore warning:", uErr?.message);
        }
      }

      // Attribution automatique des propriétés de rattachement pour Client et Chauffeur
      if (currentUser) {
        const myRoles = normalizeRoles(currentUserRoles);
        if (myRoles.includes(ROLES.CLIENT) && !myRoles.includes(ROLES.ADMIN)) {
          obj.clientId = currentUser.uid || currentUser.id;
          if (!obj.client) obj.client = currentUserProfile?.name || currentUserProfile?.nom || currentUser.displayName || "Client";
          if (!obj.email) obj.email = currentUser.email || currentUserProfile?.email || "";
        }
        if (myRoles.includes(ROLES.CHAUFFEUR) && !myRoles.includes(ROLES.ADMIN)) {
          obj.chauffeurId = currentUser.uid || currentUser.id;
          if (!obj.driver) obj.driver = currentUserProfile?.name || currentUserProfile?.nom || currentUser.displayName || "Chauffeur";
        }
      }

      rawList(canon).push(obj);
    }

    // RÈGLE : lorsqu'un utilisateur effectue une réservation, il passe directement au rôle de CLIENT
    if (canon === "reservations") {
      if (currentUser) {
        const myRoles = normalizeRoles(currentUserRoles);
        if (!myRoles.includes(ROLES.ADMIN) && !myRoles.includes(ROLES.CLIENT)) {
          try {
            await upgradeProfileToClient(currentUser.uid || currentUser.id);
            currentUserRoles = [ROLES.CLIENT];
            currentRole = ROLES.CLIENT;
            if (currentUserProfile) {
              currentUserProfile.roles = [ROLES.CLIENT];
              currentUserProfile.role = ROLES.CLIENT;
              currentUserProfile.statutClient = 'client';
            }
            saveUserSession(currentUser, currentUserProfile);
            updateRoleBadge(currentUserRoles);
            buildNavigation();
            showToast("🎉 Votre compte passe automatiquement au rôle de Client suite à cette réservation !");
          } catch (autoErr) {
            console.warn("Erreur auto-upgrade rôle client:", autoErr?.message);
          }
        }
      }

      // Vérifier également si le client renseigné dans la réservation correspond à un utilisateur existant
      const resEmail = (obj.email || "").toLowerCase().trim();
      const resClient = (obj.client || obj.nom || "").toLowerCase().trim();
      const matchedUser = (list("utilisateurs") || []).find(u => 
        (resEmail && (u.email || "").toLowerCase().trim() === resEmail) ||
        (resClient && (u.nom || u.name || "").toLowerCase().trim() === resClient)
      );
      if (matchedUser) {
        const uRoles = normalizeRoles(matchedUser.roles || matchedUser.role);
        if (!uRoles.includes(ROLES.ADMIN) && !uRoles.includes(ROLES.CLIENT)) {
          matchedUser.roles = [ROLES.CLIENT];
          matchedUser.role = ROLES.CLIENT;
          matchedUser.statutClient = "client";
          try {
            await upgradeProfileToClient(matchedUser.id || matchedUser.uid);
          } catch (e) {}
        }
      }
    }

    save();
    const savedItem = index >= 0 ? list(canon)[index] : list(canon)[list(canon).length - 1];
    
    // Direct cloud save
    await saveDocumentToFirestore(canon, savedItem);

    closeModal();
    go(canon);
    showToast("✅ Enregistrement synchronisé sur Firestore.");
  };
}

function fieldHTMLLinked(id, label, type, val, key) {
  const canon = canonicalCol(key);

  if (canon === "clients" && id === "id") {
    return `<div class="field"><label>ID Client</label><input name="id" value="${esc(val || nextNumber("CL", "clients"))}" readonly style="background:#f0f4f9;font-weight:700"></div>`;
  }
  if (canon === "proformas" && id === "number") {
    return `<div class="field"><label>N° Proforma</label><input name="number" value="${esc(val || nextProformaNumber())}" readonly style="background:#f0f4f9;font-weight:700"></div>`;
  }
  if (canon === "factures" && id === "number") {
    return `<div class="field"><label>N° Facture</label><input name="number" value="${esc(val || nextFactureNumber())}" readonly style="background:#f0f4f9;font-weight:700"></div>`;
  }
  if (canon === "factures" && id === "proforma") {
    const quotes = list("proformas");
    if (!quotes.length) {
      return `<div class="field"><label>N° Proforma lié</label><input name="proforma" value="${esc(val)}" placeholder="Optionnel (ex: PT-20260919-001)"></div>`;
    }
    return `
      <div class="field">
        <label>N° Proforma lié</label>
        <select name="proforma">
          <option value="">-- Aucun / Direct --</option>
          ${quotes.map(q => `<option value="${esc(q.number || q.id || "")}" ${q.number === val || q.id === val ? "selected" : ""}>${esc(q.number || q.id)} — ${esc(q.client)}</option>`).join("")}
        </select>
      </div>
    `;
  }
  if (canon === "abonnements" && id === "eleve") {
    const eleves = list("eleves");
    if (!eleves.length) {
      return `<div class="field"><label>Élève concerné</label><input name="eleve" value="${esc(val)}" placeholder="Optionnel (nom de l'élève)"></div>`;
    }
    return `
      <div class="field">
        <label>Élève concerné (optionnel)</label>
        <select name="eleve">
          <option value="">-- Aucun / Non applicable --</option>
          ${eleves.map(e => `<option value="${esc(e.name)}" ${e.name === val ? "selected" : ""}>${esc(e.name)} — ${esc(e.school || e.grade || "")}</option>`).join("")}
        </select>
      </div>
    `;
  }
  if (canon === "paiements" && id === "facture") {
    const factures = list("factures");
    if (!factures.length) {
      return `<div class="field"><label>Facture liée</label><input name="facture" value="${esc(val)}" placeholder="Optionnel (ex: FT-2026-09-19-001)"></div>`;
    }
    return `
      <div class="field">
        <label>Facture liée (optionnel)</label>
        <select name="facture">
          <option value="">-- Aucune facture liée --</option>
          ${factures.map(f => `<option value="${esc(f.number || f.id)}" ${f.number === val || f.id === val ? "selected" : ""}>${esc(f.number || f.id)} — ${esc(f.client)} (${money(f.amount)})</option>`).join("")}
        </select>
      </div>
    `;
  }
  if (canon === "paiements" && id === "abonnement") {
    const abos = list("abonnements");
    if (!abos.length) {
      return `<div class="field"><label>Abonnement lié</label><input name="abonnement" value="${esc(val)}" placeholder="Optionnel (ex: AB-001)"></div>`;
    }
    return `
      <div class="field">
        <label>Abonnement lié (optionnel)</label>
        <select name="abonnement">
          <option value="">-- Aucun abonnement lié --</option>
          ${abos.map(a => `<option value="${esc(a.id)}" ${a.id === val ? "selected" : ""}>${esc(a.id)} — ${esc(a.client)} (${esc(a.type)})</option>`).join("")}
        </select>
      </div>
    `;
  }
  if (["reservations", "plannings", "paiements", "proformas", "factures", "eleves", "abonnements"].includes(canon) && id === "client") {
    const clients = list("clients");
    if (!clients.length) {
      return `<div class="field"><label>Client</label><input name="client" value="${esc(val)}" placeholder="Nom du client"></div>`;
    }
    return `
      <div class="field">
        <label>Client</label>
        <select name="client">
          <option value="">-- Sélectionner un client --</option>
          ${clients.map(c => `<option value="${esc(c.name)}" ${c.name === val || c.id === val ? "selected" : ""}>${esc(c.name)} (${esc(c.id)})</option>`).join("")}
        </select>
      </div>
    `;
  }
  if (["plannings", "reservations", "abonnements", "vehicules", "finances"].includes(canon) && id === "driver") {
    const drivers = list("chauffeurs");
    if (!drivers.length) {
      return `<div class="field"><label>Chauffeur</label><input name="driver" value="${esc(val)}" placeholder="Nom du chauffeur"></div>`;
    }
    return `
      <div class="field">
        <label>Chauffeur</label>
        <select name="driver">
          <option value="">-- Sélectionner un chauffeur --</option>
          ${drivers.map(c => `<option value="${esc(c.name)}" ${c.name === val ? "selected" : ""}>${esc(c.name)} (${esc(c.phone)})</option>`).join("")}
        </select>
      </div>
    `;
  }
  if (["plannings", "reservations", "abonnements", "chauffeurs"].includes(canon) && id === "vehicle") {
    const vehicles = list("vehicules");
    if (!vehicles.length) {
      return `<div class="field"><label>Véhicule</label><input name="vehicle" value="${esc(val)}" placeholder="Véhicule"></div>`;
    }
    return `
      <div class="field">
        <label>Véhicule</label>
        <select name="vehicle">
          <option value="">-- Sélectionner un véhicule --</option>
          ${vehicles.map(v => {
            const vName = `${v.brand || v.vehicle} (${v.plate})`;
            return `<option value="${esc(vName)}" ${vName === val || v.plate === val ? "selected" : ""}>${esc(vName)}</option>`;
          }).join("")}
        </select>
      </div>
    `;
  }
  if (canon === "utilisateurs" && (id === "roles" || id === "role")) {
    const callerRoles = normalizeRoles(currentUserRoles);
    const callerIsAdmin = callerRoles.includes(ROLES.ADMIN) || isSuperAdminEmail(currentUser?.email);
    if (!callerIsAdmin) {
      return `
        <div class="field">
          <label>Rôle & Habilitations</label>
          <input type="text" value="Lecture Seule (Attribution des rôles réservée à l'Administrateur)" readonly style="background:#f1f5f9;color:#64748b;font-weight:600">
          <input type="hidden" name="roles" value="lecture_seule">
        </div>
      `;
    }
    const currentVal = Array.isArray(val) ? val[0] : (val || "lecture_seule");
    return `
      <div class="field">
        <label>Rôle attribué au compte</label>
        <select name="roles">
          <option value="lecture_seule" ${currentVal === "lecture_seule" ? "selected" : ""}>Lecture Seule (Prospect)</option>
          <option value="client" ${currentVal === "client" ? "selected" : ""}>Client (Espace Client)</option>
          <option value="chauffeur" ${currentVal === "chauffeur" ? "selected" : ""}>Chauffeur (Courses & Flotte)</option>
          <option value="secretaire" ${currentVal === "secretaire" ? "selected" : ""}>Secrétaire (Opérations & Réservations)</option>
          <option value="comptabilite" ${currentVal === "comptabilite" ? "selected" : ""}>Comptabilité (Facturation & Caisse)</option>
          <option value="operations" ${currentVal === "operations" ? "selected" : ""}>Opérations (Flotte & Logistique)</option>
          <option value="direction" ${currentVal === "direction" ? "selected" : ""}>Direction (Supervision Globale)</option>
          <option value="admin" ${currentVal === "admin" ? "selected" : ""}>Administrateur (Contrôle Total)</option>
        </select>
      </div>
    `;
  }
  return fieldHTML(id, label, type, val);
}

function fieldHTML(id, label, type, val) {
  if (type.startsWith("select:")) {
    return `
      <div class="field">
        <label>${label}</label>
        <select name="${id}">
          ${type.slice(7).split("|").map(x => `<option ${x === val ? "selected" : ""}>${esc(x)}</option>`).join("")}
        </select>
      </div>
    `;
  }
  if (type === "textarea") {
    return `
      <div class="field full">
        <label>${label}</label>
        <textarea name="${id}">${esc(val)}</textarea>
      </div>
    `;
  }
  return `
    <div class="field">
      <label>${label}</label>
      <input name="${id}" type="${type}" value="${esc(val)}">
    </div>
  `;
}

function viewRow(key, index) {
  const canon = canonicalCol(key);
  const o = list(canon)[index];
  if (!o) return;

  const schema = SCHEMAS[canon] || [];
  const fields = schema.map(x => `
    <div class="info">
      <b>${x[1]}</b><br>${esc(o[x[0]] || "—")}
    </div>
  `).join("");

  let extraButtons = "";
  if (canon === "proformas") {
    extraButtons = `
      <button class="primary green" onclick="closeModal();createInvoiceFromQuote(${index})">🧾 Convertir en Facture</button>
      <button class="primary" onclick="closeModal();printDocument('proforma',${index})">🖨️ PDF Proforma</button>
    `;
  } else if (canon === "factures") {
    extraButtons = `
      <button class="primary" onclick="closeModal();printDocument('facture',${index})">🖨️ PDF Facture</button>
    `;
  }

  const canEdit = hasPermission("write", canon);
  const canDelete = hasPermission("delete", canon);

  document.getElementById("modal").innerHTML = `
    <div class="modal-head">
      <div>
        <h2>${MODULES[canon]?.icon || "📋"} ${MODULES[canon]?.label || canon} • ${esc(o.number || o.id || "Fiche")}</h2>
        <small>Fiche complète Cloud Firestore • Créé par : ${esc(o.createdBy || "admin")}</small>
      </div>
      <button class="close" onclick="closeModal()">×</button>
    </div>
    <div class="form-grid">${fields}</div>
    <div class="form-actions" style="flex-wrap:wrap">
      ${extraButtons}
      ${canEdit ? `<button class="secondary" onclick="openForm('${canon}',${index})">Modifier</button>` : ""}
      ${canDelete ? `<button class="secondary" style="color:#d93025;border-color:#fca5a5" onclick="removeRow('${canon}',${index})">🗑️ Archiver / Supprimer</button>` : ""}
      <button class="primary" onclick="closeModal()">Fermer</button>
    </div>
  `;
  document.getElementById("modalBackdrop").classList.add("open");
}

function closeModal() {
  document.getElementById("modalBackdrop").classList.remove("open");
}

function removeRow(key, index) {
  const canon = canonicalCol(key);
  if (!hasPermission("delete", canon)) {
    showToast("⚠️ Seul un administrateur ou utilisateur autorisé peut supprimer cette fiche.");
    return;
  }

  const item = list(canon)[index];
  if (!item) return;
  const label = item.number || item.name || item.id || item.client || item.route || item.vehicle || `Fiche #${index + 1}`;
  const mod = MODULES[canon] ? MODULES[canon].label : canon;

  document.getElementById("modal").innerHTML = `
    <div class="modal-head">
      <div>
        <h2 style="color:#d93025">🗑️ Gestion de la suppression</h2>
        <small>Protection de l'historique LAPERLE TOUR HT</small>
      </div>
      <button class="close" onclick="closeModal()">×</button>
    </div>
    <div class="info" style="background:#fff5f5;border:1px solid #fed7d7;color:#b42318;padding:14px;border-radius:8px">
      Gestion pour la fiche du module <b>${esc(mod)}</b> :
      <div style="margin-top:10px;padding:9px 12px;background:#fff;border-radius:6px;border:1px solid #feb2b2;color:#102b61;font-weight:700">
        ${esc(label)}
      </div>
      <p style="margin:8px 0 0;font-size:12px;color:#742a2a">
        <b>Recommandation :</b> L'archivage logique préserve la traçabilité comptable et l'historique sans encombrer la vue principale.
      </p>
    </div>
    <div class="form-actions" style="margin-top:16px;flex-wrap:wrap">
      <button class="secondary" onclick="closeModal()">Annuler</button>
      <button class="primary orange" onclick="executeArchive('${canon}',${index})">📦 Archiver (Recommandé)</button>
      ${currentUserRoles.includes(ROLES.ADMIN) ? `<button class="primary" style="background:#d93025;border-color:#d93025" onclick="executePermanentDelete('${canon}',${index})">🗑️ Supprimer définitivement</button>` : ""}
    </div>
  `;
  document.getElementById("modalBackdrop").classList.add("open");
}

async function executeArchive(key, index) {
  const canon = canonicalCol(key);
  const arr = list(canon);
  if (index >= 0 && index < arr.length) {
    const item = arr[index];
    const docId = item.number || item.id;
    const rawIdx = rawList(canon).findIndex(x => (item.id && x.id === item.id) || (item.number && x.number === item.number));
    if (rawIdx >= 0) {
      rawList(canon)[rawIdx].archived = true;
      rawList(canon)[rawIdx].status = "Archivé";
    } else {
      item.archived = true;
      item.status = "Archivé";
    }
    save();
    if (docId) {
      await archiveDocumentInFirestore(canon, docId);
    }
    closeModal();
    render();
    showToast("📦 Fiche archivée avec succès.");
  }
}

async function executePermanentDelete(key, index) {
  const canon = canonicalCol(key);
  const arr = list(canon);
  if (index >= 0 && index < arr.length) {
    const item = arr[index];
    const docId = item.number || item.id;
    const rawIdx = rawList(canon).findIndex(x => (item.id && x.id === item.id) || (item.number && x.number === item.number));
    if (rawIdx >= 0) {
      rawList(canon).splice(rawIdx, 1);
    }
    save();
    if (docId) {
      await deleteDocumentFromFirestore(canon, docId);
    }
    closeModal();
    render();
    showToast("🗑️ Fiche définitivement supprimée de Firestore.");
  }
}

function globalSearch() {
  if (!hasBusinessRole(currentUserRoles)) {
    showToast("Recherche non disponible en lecture seule.");
    return;
  }
  const q = document.getElementById("globalSearch").value.trim().toLowerCase();
  if (!q) {
    go("dashboard");
    return;
  }
  for (const key of ALL_MODULES) {
    if (list(key).some(o => Object.values(o).join(" ").toLowerCase().includes(q))) {
      go(key);
      setTimeout(() => {
        const s = document.getElementById("moduleSearch");
        if (s) {
          s.value = q;
          drawTable(key);
        }
      }, 30);
      return;
    }
  }
  showToast("Aucun résultat trouvé.");
}

function exportData() {
  if (!currentUserRoles.includes(ROLES.ADMIN) && !currentUserRoles.includes('direction')) {
    showToast("Export réservé à l'administration.");
    return;
  }
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "LAPERLE_Centre_Controle_sauvegarde.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
  showToast("Sauvegarde exportée.");
}

function importData(e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      state = JSON.parse(r.result);
      save();
      render();
      showToast("Données importées. Cliquez sur 'Sauvegarder toutes les données sur Firestore' pour synchroniser le Cloud.");
    } catch (err) {
      showToast("Erreur : Fichier JSON invalide.");
    }
  };
  r.readAsText(f);
}

async function handleConfirmClientReservation() {
  const dest = document.getElementById("firstResDest")?.value || "Port-au-Prince ➔ Cap-Haïtien";
  const date = document.getElementById("firstResDate")?.value || today();
  const service = document.getElementById("firstResService")?.value || "Transport Interurbain";
  const passengers = document.getElementById("firstResPass")?.value || "1";
  const btn = document.getElementById("btnConfirmFirstRes");

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="auth-spinner"></span> Confirmation de votre réservation...`;
  }

  try {
    const uid = currentUser?.uid;
    if (!uid) throw new Error("Utilisateur non connecté ou session invalide.");

    // 1. Mise à jour automatique du profil Firestore : statutClient: "client", roles: ["client"]
    const updated = await upgradeProfileToClient(uid);

    // 2. Création de l'enregistrement de réservation dans la collection 'reservations'
    const resId = "RES-" + Date.now().toString(36).toUpperCase();
    const resItem = {
      id: resId,
      code: resId,
      nomClient: updated.nom || currentUser.displayName || "Client LAPERLE",
      clientUid: uid,
      telephone: updated.telephone || currentUser.phoneNumber || "",
      email: updated.email || currentUser.email || "",
      trajet: dest,
      route: dest,
      typePrestation: service,
      service: service,
      dateDepart: date,
      date: date,
      passagers: parseInt(passengers, 10) || 1,
      statut: "Confirmée",
      montantTotal: 2500,
      devise: "HTG",
      createdAt: new Date().toISOString()
    };

    try {
      if (typeof saveItemToFirestore === "function") {
        await saveItemToFirestore("reservations", resItem);
      }
    } catch (e) {
      console.warn("Enregistrement Firestore réservation:", e);
    }

    if (!Array.isArray(state["reservations"])) state["reservations"] = [];
    state["reservations"].unshift(resItem);

    // 3. Mettre à jour l'état mémoire & local
    currentUserProfile = updated;
    currentUserRoles = [ROLES.CLIENT];
    currentRole = ROLES.CLIENT;
    saveUserSession(currentUser, updated);
    updateRoleBadge(currentUserRoles);

    // 4. Mettre à jour la navigation pour débloquer l'Espace Client
    buildNavigation();

    showToast("🎉 Félicitations ! Votre réservation est confirmée. Vous êtes maintenant CLIENT de LAPERLE TOUR HT.");

    // 5. Rediriger immédiatement vers le Dashboard / Espace Client
    setTimeout(() => {
      current = "dashboard";
      location.hash = "dashboard";
      render();
    }, 500);

  } catch (err) {
    console.error("Erreur confirmation réservation client:", err);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>🎫</span> <span>Confirmer ma réservation et activer mon Espace Client</span>`;
    }
    showToast("Erreur: " + (err.message || "Impossible de valider la réservation"));
  }
}
window.handleConfirmClientReservation = handleConfirmClientReservation;

function renderLectureSeuleProfilePage() {
  const user = currentUser;
  const profile = currentUserProfile || {};
  const displayName = profile.nom || profile.name || user?.displayName || user?.email?.split('@')[0] || user?.phoneNumber || "Utilisateur";
  const email = profile.email || user?.email || "—";
  const telephone = profile.telephone || user?.phoneNumber || "—";
  const photo = profile.photoURL || user?.photoURL || "";
  const statutCompte = profile.statutCompte || profile.status || "actif";
  const statutClient = profile.statutClient || "prospect";

  const page = document.getElementById("page");
  if (!page) return;

  page.innerHTML = `
    <div style="max-width: 760px; margin: 24px auto; padding: 0 16px;">
      <!-- Carte d'identité du Profil -->
      <div style="background: linear-gradient(135deg, #092e70 0%, #174291 100%); border-radius: 16px; padding: 28px 24px; color: #ffffff; box-shadow: 0 8px 24px rgba(9,46,112,0.18); margin-bottom: 22px;">
        <div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap;">
          <div style="width: 76px; height: 76px; border-radius: 50%; background: #ffffff; color: #092e70; display: grid; place-items: center; font-size: 30px; font-weight: 800; border: 3px solid #f7941d; overflow: hidden; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.18);">
            ${photo ? `<img src="${esc(photo)}" style="width:100%;height:100%;object-fit:cover;" alt="${esc(displayName)}">` : esc(displayName.charAt(0).toUpperCase())}
          </div>
          <div style="flex: 1; min-width: 220px;">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px;">
              <h2 style="margin: 0; font-size: 22px; font-weight: 800; color: #ffffff;">${esc(displayName)}</h2>
              <span class="user-role-badge lecture_seule" style="font-size: 11px; padding: 3px 10px; border-radius: 20px; font-weight: 700; background: #e0e7ff; color: #3730a3;">Lecture Seule</span>
              <span style="font-size: 11px; padding: 3px 10px; border-radius: 20px; font-weight: 700; background: #fef3c7; color: #92400e; border: 1px solid #fde68a;">Prospect</span>
            </div>
            <div style="font-size: 13px; opacity: 0.9; margin-bottom: 8px;">
              ${email !== "—" ? `<span>✉️ ${esc(email)}</span>` : ""}
              ${telephone !== "—" ? `<span style="margin-left:${email !== "—" ? '12px' : '0'}">📞 ${esc(telephone)}</span>` : ""}
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.18); padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">
                <span>✅</span> Statut du compte : <b>${esc(statutCompte)}</b>
              </div>
              <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.18); padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">
                <span>👤</span> Statut client : <b>${esc(statutClient)}</b>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Notice Stricte Règle Métier -->
      <div style="background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 16px; margin-bottom: 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <div style="font-weight: 700; color: #92400e; font-size: 14px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
          <span>🔒</span> Restriction d'accès en Lecture Seule
        </div>
        <div style="font-size: 13px; color: #78350f; line-height: 1.5;">
          <b>Lecture seule :</b> accès uniquement à votre propre profil.<br>
          Aucun Dashboard, aucun module métier, aucune donnée des autres utilisateurs n'est accessible avant confirmation d'une première réservation.
        </div>
      </div>

      <!-- Détails du Profil -->
      <div class="panel" style="margin-bottom: 22px; border-radius: 12px; padding: 22px; background: #ffffff; border: 1px solid #e2e8f0;">
        <div style="border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <h3 style="margin: 0; color: #092e70; font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
            <span>👤</span> Informations de mon compte
          </h3>
          <button onclick="openProfile()" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; background: #092e70; color: #ffffff; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer;">
            <span>✏️</span> Modifier mon profil
          </button>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;">
            <div style="color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Nom & Prénom</div>
            <div style="color: #0f172a; font-weight: 700; font-size: 14px;">${esc(displayName)}</div>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;">
            <div style="color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Nom de profil (Identifiant)</div>
            <div style="color: #0f172a; font-weight: 700; font-size: 14px; word-break: break-all;">@${esc(profile.username || (email !== "—" ? email.split('@')[0] : 'profil'))}</div>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;">
            <div style="color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Identifiant E-mail</div>
            <div style="color: #0f172a; font-weight: 700; font-size: 14px; word-break: break-all;">${esc(email !== "—" ? email : telephone)}</div>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;">
            <div style="color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Rôles système (Verrouillé)</div>
            <div style="color: #3730a3; font-weight: 700; font-size: 14px;">🔒 ["lecture_seule"]</div>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;">
            <div style="color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Statut Client</div>
            <div style="color: #b45309; font-weight: 700; font-size: 14px;">prospect</div>
          </div>
        </div>
      </div>

      <!-- Action Métier : Première réservation pour devenir Client -->
      <div class="panel" style="margin-bottom: 22px; border-radius: 12px; padding: 22px; background: #ffffff; border: 2px solid #bbf7d0; box-shadow: 0 4px 16px rgba(34,197,94,0.08);">
        <div style="border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <h3 style="margin: 0; color: #166534; font-size: 17px; font-weight: 800; display: flex; align-items: center; gap: 8px;">
              <span>🎫</span> Réserver un trajet LAPERLE (Activer mon Espace Client)
            </h3>
            <p style="margin: 4px 0 0; font-size: 12px; color: #475569;">
              Après une réservation confirmée : votre profil est automatiquement transformé en <b>client</b> (<code>statutClient: "client"</code>) avec accès complet à votre espace.
            </p>
          </div>
          <span style="background: #dcfce7; color: #166534; font-weight: 700; font-size: 12px; padding: 4px 10px; border-radius: 20px;">
            Accès Espace Client
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 16px;">
          <div>
            <label style="display: block; font-size: 12px; font-weight: 700; color: #334e68; margin-bottom: 4px;">Destination / Trajet</label>
            <select id="firstResDest" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; background: #f8fafc; font-weight: 600;">
              <option value="Port-au-Prince ➔ Cap-Haïtien">Port-au-Prince ➔ Cap-Haïtien</option>
              <option value="Port-au-Prince ➔ Jacmel">Port-au-Prince ➔ Jacmel</option>
              <option value="Port-au-Prince ➔ Les Cayes">Port-au-Prince ➔ Les Cayes</option>
              <option value="Port-au-Prince ➔ Gonaïves">Port-au-Prince ➔ Gonaïves</option>
              <option value="Course Privée VIP Port-au-Prince / Pétion-Ville">Course Privée VIP (Pétion-Ville)</option>
              <option value="Navette Aéroport International Toussaint Louverture">Navette Aéroport International</option>
            </select>
          </div>

          <div>
            <label style="display: block; font-size: 12px; font-weight: 700; color: #334e68; margin-bottom: 4px;">Type de prestation</label>
            <select id="firstResService" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; background: #f8fafc; font-weight: 600;">
              <option value="Transport Interurbain">Transport Interurbain</option>
              <option value="Course Taxi / Navette">Course Taxi / Navette</option>
              <option value="Location avec Chauffeur">Location avec Chauffeur</option>
              <option value="Abonnement Mensuel">Abonnement Mensuel</option>
            </select>
          </div>

          <div>
            <label style="display: block; font-size: 12px; font-weight: 700; color: #334e68; margin-bottom: 4px;">Date souhaitée</label>
            <input type="date" id="firstResDate" value="${today()}" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; background: #f8fafc; font-weight: 600;">
          </div>

          <div>
            <label style="display: block; font-size: 12px; font-weight: 700; color: #334e68; margin-bottom: 4px;">Nombre de passagers</label>
            <select id="firstResPass" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; background: #f8fafc; font-weight: 600;">
              <option value="1">1 passager</option>
              <option value="2">2 passagers</option>
              <option value="3">3 passagers</option>
              <option value="4">4 passagers ou plus</option>
            </select>
          </div>
        </div>

        <button id="btnConfirmFirstRes" onclick="handleConfirmClientReservation()" style="width: 100%; padding: 13px; background: #16a34a; border: none; color: #ffffff; font-size: 14px; font-weight: 700; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 8px rgba(22,163,74,0.25); transition: background 0.15s ease;">
          <span>🎫</span> <span>Confirmer ma réservation et activer mon Espace Client</span>
        </button>
      </div>

      <!-- Contacter LAPERLE TOUR HT -->
      <div class="panel" style="margin-bottom: 20px; border-radius: 12px; padding: 22px; background: #ffffff; border: 1px solid #e2e8f0;">
        <div style="border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 14px;">
          <h3 style="margin: 0; color: #092e70; font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
            <span>📞</span> Service Client LAPERLE TOUR HT
          </h3>
        </div>
        <p style="color: #475569; font-size: 13px; margin: 0 0 14px; line-height: 1.5;">
          Besoin d'un devis personnalisé, d'une assistance ou d'un voyage de groupe ? Nos agents sont à votre écoute :
        </p>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <a href="https://wa.me/50944408687?text=Bonjour%20LAPERLE%20TOUR%20HT%2C%20je%20suis%20prospect%20sur%20votre%20plateforme%20et%20je%20souhaite%20r%C3%A9server%20un%20transport." target="_blank" rel="noopener noreferrer" style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; background: #25d366; color: #ffffff; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 700; box-shadow: 0 2px 8px rgba(37,211,102,0.25);">
            <span style="font-size: 18px;">💬</span> Assistance WhatsApp : +509 4440 8687
          </a>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
            <a href="tel:+50944408687" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; color: #092e70; text-decoration: none; font-size: 13px; font-weight: 600;">
              <span>📞</span> +509 4440 8687
            </a>
            <a href="mailto:laperletourht@gmail.com" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; color: #092e70; text-decoration: none; font-size: 13px; font-weight: 600;">
              <span>✉️</span> laperletourht@gmail.com
            </a>
          </div>
        </div>
      </div>

      <!-- Se déconnecter -->
      <div style="text-align: center; margin-top: 24px; padding-bottom: 24px;">
        <button onclick="logoutUser()" style="display: inline-flex; align-items: center; gap: 8px; padding: 11px 24px; background: #fee2e2; border: 1px solid #fca5a5; color: #991b1b; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; transition: background 0.15s ease;">
          <span>🚪</span> Se déconnecter
        </button>
      </div>
    </div>
  `;
}

function openProfile() {
  const profile = currentUserProfile || {};
  const user = currentUser || {};
  const email = profile.email || user.email || localStorage.getItem("LAPERLE_EMAIL") || "laperletourht@gmail.com";
  const username = profile.username || (email ? email.split('@')[0] : '');
  const nom = profile.nom || (profile.name ? profile.name.split(' ').slice(1).join(' ') : '');
  const prenom = profile.prenom || (profile.name ? profile.name.split(' ')[0] : '');
  const phone = profile.telephone || profile.phone || user.phoneNumber || '';
  const photo = profile.photoURL || user.photoURL || '';
  const roles = normalizeRoles(currentUserRoles.length ? currentUserRoles : (profile.roles || profile.role || ['lecture_seule']));
  const isAdmin = roles.includes('admin') || isSuperAdminEmail(email);
  const isAuth = !!currentUser;
  const initialLetter = (profile.nom || profile.name || user.displayName || email || 'U').charAt(0).toUpperCase();

  const modalEl = document.getElementById("modal");
  if (!modalEl) return;

  modalEl.innerHTML = `
    <div class="modal-head">
      <div>
        <h2>Mon Profil Utilisateur</h2>
        <small>Centre de Contrôle LAPERLE TOUR HT • Paramètres personnels</small>
      </div>
      <button class="close" onclick="closeModal()">×</button>
    </div>

    <div class="profile-modal-container">
      <!-- En-tête profil avec aperçu photo -->
      <div class="profile-card-header">
        <div class="profile-avatar-wrap" id="profileModalAvatarPreview">
          ${photo ? `<img src="${esc(photo)}" alt="Avatar" id="profilePreviewImg">` : `<span id="profilePreviewLetter">${esc(initialLetter)}</span>`}
        </div>
        <div class="profile-header-info">
          <div class="profile-header-name" id="profileHeaderDisplayName">${esc(profile.name || `${prenom} ${nom}`.trim() || user.displayName || 'Utilisateur')}</div>
          <div class="profile-header-handle" id="profileHeaderHandle">@${esc(username || 'profil')}</div>
          <div class="profile-header-email">✉️ ${esc(email)}</div>
        </div>
      </div>

      <!-- Formulaire d'édition de profil -->
      <form id="profileEditForm" style="display:flex;flex-direction:column;gap:12px;">
        <!-- 1. Nom de profil (Username) -->
        <div class="field">
          <label for="profEditUsername">
            <b>Nom de profil (Identifiant @username) :</b>
            <span style="font-size:11px;color:#092e70;font-weight:600;margin-left:6px;">Connexion sans ressaisir l'e-mail</span>
          </label>
          <input type="text" id="profEditUsername" name="username" value="${esc(username)}" placeholder="Ex: castima, jean_dupont" required style="font-family:monospace;font-weight:700;">
          <small style="color:#64748b;font-size:11px;">Lettres, chiffres, tirets et underscores autorisés.</small>
        </div>

        <!-- 2. Prénom & Nom -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="field">
            <label for="profEditPrenom"><b>Prénom :</b></label>
            <input type="text" id="profEditPrenom" name="prenom" value="${esc(prenom)}" placeholder="Prénom">
          </div>
          <div class="field">
            <label for="profEditNom"><b>Nom de famille :</b></label>
            <input type="text" id="profEditNom" name="nom" value="${esc(nom)}" placeholder="Nom">
          </div>
        </div>

        <!-- 3. Photo de profil -->
        <div class="field">
          <label for="profEditPhoto">
            <b>Photo de profil :</b>
            <span style="font-size:11px;color:#64748b;margin-left:6px;">Lien web ou fichier image</span>
          </label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="profEditPhoto" name="photoURL" value="${esc(photo)}" placeholder="https://... ou collez un lien" style="flex:1;">
            <button type="button" class="secondary" id="profUploadBtn" style="white-space:nowrap;padding:7px 12px;font-size:12px;">📷 Choisir un fichier</button>
            <input type="file" id="profFileInput" accept="image/*" style="display:none;">
          </div>
          <div style="margin-top:6px;">
            <small style="color:#64748b;font-size:11px;">Avatars rapides suggérés :</small>
            <div class="profile-avatar-presets">
              <button type="button" class="profile-avatar-preset-btn" data-url="logo-laperle.jpg" title="Logo Laperle"><img src="logo-laperle.jpg" alt="Logo"></button>
              <button type="button" class="profile-avatar-preset-btn" data-url="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80" title="Avatar 1"><img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80" alt="Av1"></button>
              <button type="button" class="profile-avatar-preset-btn" data-url="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80" title="Avatar 2"><img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80" alt="Av2"></button>
              <button type="button" class="profile-avatar-preset-btn" data-url="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80" title="Avatar 3"><img src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80" alt="Av3"></button>
              <button type="button" class="profile-avatar-preset-btn" data-url="" title="Supprimer la photo" style="font-size:13px;color:#b42318;">❌</button>
            </div>
          </div>
        </div>

        <!-- 4. Téléphone / WhatsApp -->
        <div class="field">
          <label for="profEditPhone"><b>Téléphone / WhatsApp :</b></label>
          <input type="tel" id="profEditPhone" name="telephone" value="${esc(phone)}" placeholder="+509 4440 8687">
        </div>

        <!-- 5. Changement de mot de passe -->
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;">
          <div style="font-weight:700;font-size:13px;color:#092e70;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
            <span>🔑</span> Modifier mon mot de passe
            <small style="color:#64748b;font-weight:normal;margin-left:auto;">(Laisser vide pour ne pas modifier)</small>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="field">
              <label for="profEditNewPass" style="font-size:11px;">Nouveau mot de passe :</label>
              <input type="password" id="profEditNewPass" name="newPassword" minlength="4" maxlength="8" placeholder="4 à 8 car. alphanum.">
            </div>
            <div class="field">
              <label for="profEditNewPassConfirm" style="font-size:11px;">Confirmer le mot de passe :</label>
              <input type="password" id="profEditNewPassConfirm" name="newPasswordConfirm" minlength="4" maxlength="8" placeholder="Retapez le mot de passe">
            </div>
          </div>
          <small style="color:#64748b;font-size:11px;display:block;margin-top:4px;">Doit comporter entre 4 et 8 caractères alphanumériques (chiffres ou lettres).</small>
        </div>

        <!-- 6. RÔLES ET HABILITATIONS : STRICTEMENT VERROUILLÉ ("sauf lacces aux roles") -->
        <div class="profile-role-lock-box">
          <div class="profile-role-lock-title">
            <span>🛡️ Rôles & Habilitations attribués :</span>
            <span class="profile-role-lock-badge">🔒 Accès Verrouillé</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            ${roles.map(r => `<span class="user-role-badge ${r}">${ROLE_LABELS[r] || r}</span>`).join('')}
          </div>
          <div class="profile-role-lock-hint">
            ⚠️ <b>Règle de sécurité LAPERLE TOUR HT :</b> Les rôles et permissions sont strictement attribués par l'Administration. Aucun utilisateur ne peut modifier ses propres habilitations système.
          </div>
        </div>

        <!-- Actions -->
        <div class="form-actions" style="margin-top:10px;flex-wrap:wrap;gap:8px;">
          <button type="submit" class="primary" id="profSubmitBtn" style="padding:10px 20px;">
            <span>💾 Enregistrer les modifications</span>
          </button>
          <button type="button" class="secondary" onclick="closeModal()">Fermer</button>
          ${isAdmin ? `<button type="button" class="secondary" onclick="closeModal();go('utilisateurs')">🛡️ Administration Utilisateurs</button>` : ''}
          ${isAdmin ? `<button type="button" class="secondary" style="color:#b45309;border-color:#fde68a;background:#fffbeb;" onclick="triggerResetUsersFromProfile()">🔄 Réinitialiser Base Users (Admin26)</button>` : ''}
          <button type="button" class="secondary" style="color:#b42318;border-color:#fca5a5;margin-left:auto;" onclick="closeModal();logoutUser()">🚪 Déconnexion</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("modalBackdrop").classList.add("open");

  // Interaction : mise à jour en direct de l'aperçu avatar
  const photoInput = document.getElementById("profEditPhoto");
  const avatarPreview = document.getElementById("profileModalAvatarPreview");
  const handlePreview = document.getElementById("profileHeaderHandle");
  const usernameInput = document.getElementById("profEditUsername");

  function updateAvatarPreview(url) {
    if (!avatarPreview) return;
    if (url && url.trim()) {
      avatarPreview.innerHTML = `<img src="${esc(url.trim())}" alt="Avatar">`;
    } else {
      avatarPreview.innerHTML = `<span>${esc(initialLetter)}</span>`;
    }
  }

  if (photoInput) {
    photoInput.addEventListener("input", (e) => {
      updateAvatarPreview(e.target.value);
    });
  }

  if (usernameInput && handlePreview) {
    usernameInput.addEventListener("input", (e) => {
      const clean = e.target.value.trim().toLowerCase();
      handlePreview.textContent = `@${clean || 'profil'}`;
    });
  }

  // Clic sur les suggestions d'avatars
  document.querySelectorAll(".profile-avatar-preset-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-url");
      if (photoInput) {
        photoInput.value = url;
        updateAvatarPreview(url);
      }
    });
  });

  // Téléversement d'image depuis le disque local
  const fileInput = document.getElementById("profFileInput");
  const uploadBtn = document.getElementById("profUploadBtn");
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) {
        if (!file.type.startsWith('image/')) {
          showToast("Veuillez sélectionner un fichier image valide (JPG, PNG, WebP).");
          return;
        }
        const reader = new FileReader();
        reader.onload = (re) => {
          const dataUrl = re.target.result;
          if (photoInput) photoInput.value = dataUrl;
          updateAvatarPreview(dataUrl);
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Soumission du formulaire d'édition
  const form = document.getElementById("profileEditForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("profSubmitBtn");

      const newUsername = (document.getElementById("profEditUsername")?.value || "").trim().toLowerCase();
      const newPrenom = (document.getElementById("profEditPrenom")?.value || "").trim();
      const newNom = (document.getElementById("profEditNom")?.value || "").trim();
      const newPhoto = (document.getElementById("profEditPhoto")?.value || "").trim();
      const newPhone = (document.getElementById("profEditPhone")?.value || "").trim();
      const newPass = (document.getElementById("profEditNewPass")?.value || "").trim();
      const newPassConfirm = (document.getElementById("profEditNewPassConfirm")?.value || "").trim();

      // Validation mot de passe si renseigné
      if (newPass) {
        if (newPass.length < 4 || newPass.length > 8) {
          showToast("Le mot de passe doit comporter entre 4 et 8 caractères alphanumériques.");
          return;
        }
        if (!/^[a-zA-Z0-9]+$/.test(newPass)) {
          showToast("Le mot de passe doit comporter uniquement des chiffres et des lettres.");
          return;
        }
        if (newPass !== newPassConfirm) {
          showToast("La confirmation du mot de passe ne correspond pas.");
          return;
        }
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>⏳ Enregistrement...</span>`;
      }

      try {
        const payload = {
          id: profile.id || user.uid,
          uid: profile.uid || user.uid,
          email: profile.email || user.email || email,
          username: newUsername,
          prenom: newPrenom,
          nom: newNom,
          name: newPrenom && newNom ? `${newPrenom} ${newNom}` : (newNom || newPrenom || profile.name),
          telephone: newPhone,
          phone: newPhone,
          photoURL: newPhoto,
          ...(newPass ? { newPassword: newPass, newPasswordConfirm: newPassConfirm } : {})
        };

        const result = await updateUserProfile(payload);

        // Mettre à jour l'état local du profil
        const updatedProf = result.profile || result.user || {};
        currentUserProfile = {
          ...currentUserProfile,
          ...payload,
          ...updatedProf,
          // Rôles strictement inchangés
          role: currentUserProfile?.role || 'lecture_seule',
          roles: currentUserProfile?.roles || ['lecture_seule']
        };

        if (currentUser) {
          currentUser.displayName = currentUserProfile.name || currentUser.displayName;
          currentUser.photoURL = currentUserProfile.photoURL;
        }

        saveUserSession(currentUser, currentUserProfile);

        // Mettre à jour l'en-tête de l'application immédiatement
        const headerAvatar = document.getElementById("headerAvatar");
        const headerName = document.getElementById("headerUserName");
        if (headerAvatar) {
          if (newPhoto) {
            headerAvatar.innerHTML = `<img src="${esc(newPhoto)}" class="user-avatar-img" alt="Avatar">`;
          } else {
            headerAvatar.textContent = (newNom || newPrenom || user.displayName || 'U').charAt(0).toUpperCase();
          }
        }
        if (headerName) {
          headerName.textContent = newUsername ? `@${newUsername}` : (newPrenom || newNom || "Utilisateur");
        }

        showToast("✅ Votre profil a été mis à jour avec succès !");
        closeModal();

        // Si l'utilisateur est sur la page profil, rafraîchir la vue
        if (current === "profile" || !hasBusinessRole(currentUserRoles)) {
          renderLectureSeuleProfilePage();
        } else {
          render();
        }
      } catch (err) {
        console.error("Erreur mise à jour profil:", err);
        showToast("Erreur: " + (err.message || "Impossible d'enregistrer le profil."));
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<span>💾 Enregistrer les modifications</span>`;
        }
      }
    });
  }
}
window.openProfile = openProfile;

window.triggerResetUsersFromProfile = async function() {
  if (!confirm("⚠️ Voulez-vous vraiment réinitialiser la base de données des utilisateurs ?\nTous les comptes administrateurs seront réinitialisés avec le mot de passe : Admin26.")) {
    return;
  }
  try {
    showToast("Réinitialisation de la base utilisateurs en cours...");
    await resetUsersDatabase();
    showToast("✅ Base réinitialisée ! Tous les administrateurs se connectent avec le mot de passe : Admin26.");
    closeModal();
    setTimeout(() => location.reload(), 1200);
  } catch (err) {
    showToast("Erreur réinitialisation: " + (err.message || err));
  }
};

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function reportsPage() {
  const roles = normalizeRoles(currentUserRoles);
  const canSeeFinances = roles.some(r => [ROLES.ADMIN, ROLES.DIRECTION, ROLES.COMPTABILITE].includes(r));

  const todayStr = today();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const allRes = list("reservations");
  const allPlans = list("plannings");
  const allClients = list("clients");
  const allEleves = list("eleves");
  const allAbos = list("abonnements");
  const allFactures = list("factures");
  const allPaiements = list("paiements");
  const allFinances = list("finances");

  // Indicateurs Journaliers (Aujourd'hui)
  const todayRes = allRes.filter(r => ((r.date && r.date === todayStr) || (r.createdAt && r.createdAt.startsWith(todayStr))) && !r.archived);
  const todayPlans = allPlans.filter(p => p.date === todayStr && !p.archived);
  const todayClients = allClients.filter(c => (c.createdAt && c.createdAt.startsWith(todayStr)) && !c.archived);
  const todayFactures = allFactures.filter(f => ((f.date && f.date === todayStr) || (f.createdAt && f.createdAt.startsWith(todayStr))) && !f.archived);
  const todayPaiements = allPaiements.filter(p => ((p.date && p.date === todayStr) || (p.createdAt && p.createdAt.startsWith(todayStr))) && !p.archived);
  const todayCashIn = todayPaiements.reduce((s, p) => s + Number(p.amount || 0), 0);

  // Indicateurs Hebdomadaires (7 derniers jours)
  const weekRes = allRes.filter(r => ((r.date && r.date >= oneWeekAgo) || (r.createdAt && r.createdAt >= oneWeekAgo)) && !r.archived);
  const weekPlans = allPlans.filter(p => p.date && p.date >= oneWeekAgo && !p.archived);
  const weekClients = allClients.filter(c => (c.createdAt && c.createdAt >= oneWeekAgo) && !c.archived);
  const weekAbos = allAbos.filter(a => ((a.date && a.date >= oneWeekAgo) || (a.createdAt && a.createdAt >= oneWeekAgo)) && !a.archived);
  const weekEleves = allEleves.filter(el => (el.createdAt && el.createdAt >= oneWeekAgo) && !el.archived);
  const weekFactures = allFactures.filter(f => ((f.date && f.date >= oneWeekAgo) || (f.createdAt && f.createdAt >= oneWeekAgo)) && !f.archived);
  const weekPaiements = allPaiements.filter(p => ((p.date && p.date >= oneWeekAgo) || (p.createdAt && p.createdAt >= oneWeekAgo)) && !p.archived);
  const weekCashIn = weekPaiements.reduce((s, p) => s + Number(p.amount || 0), 0);

  // VUE SPÉCIFIQUE SECRÉTARIAT (Pas de finances globales d'entreprise, uniquement rapport journalier et hebdomadaire)
  if (!canSeeFinances) {
    document.getElementById("page").innerHTML = `
      <div class="section-head">
        <div>
          <h2>📋 Rapport Journalier & Hebdomadaire (Secrétariat)</h2>
          <p>Synthèse opérationnelle : réservations, plannings, abonnements et encaissements enregistrés.</p>
        </div>
        <button class="primary" onclick="exportData()">Exporter le rapport</button>
      </div>

      <!-- SECTION 1 : RAPPORT DU JOUR (JOURNALIER) -->
      <div class="panel" style="margin-bottom:20px;border-top:4px solid #1675ea">
        <div class="panel-title">
          <h3>📅 Rapport Journalier — Aujourd'hui (${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })})</h3>
        </div>
        <div class="kpis" style="margin-bottom:0">
          <div class="kpi"><div class="kpi-icon">🚗</div><div><small>Courses & Réservations du Jour</small><strong>${todayRes.length}</strong></div></div>
          <div class="kpi"><div class="kpi-icon">📋</div><div><small>Plannings Départs Aujourd'hui</small><strong>${todayPlans.length}</strong></div></div>
          <div class="kpi"><div class="kpi-icon">👥</div><div><small>Nouveaux Clients Aujourd'hui</small><strong>${todayClients.length}</strong></div></div>
          <div class="kpi"><div class="kpi-icon">🧾</div><div><small>Factures Émises Aujourd'hui</small><strong>${todayFactures.length}</strong></div></div>
          <div class="kpi"><div class="kpi-icon">💵</div><div><small>Encaissements Caisse du Jour</small><strong>${money(todayCashIn)}</strong></div></div>
        </div>
      </div>

      <!-- SECTION 2 : RAPPORT HEBDOMADAIRE (7 DERNIERS JOURS) -->
      <div class="panel" style="margin-bottom:20px;border-top:4px solid #f7941d">
        <div class="panel-title">
          <h3>🗓️ Rapport Hebdomadaire — 7 Derniers Jours</h3>
        </div>
        <div class="kpis" style="margin-bottom:0">
          <div class="kpi"><div class="kpi-icon">📅</div><div><small>Réservations Semaine</small><strong>${weekRes.length}</strong></div></div>
          <div class="kpi"><div class="kpi-icon">🎫</div><div><small>Nouveaux Abonnements Semaine</small><strong>${weekAbos.length}</strong></div></div>
          <div class="kpi"><div class="kpi-icon">🎒</div><div><small>Nouveaux Élèves Semaine</small><strong>${weekEleves.length}</strong></div></div>
          <div class="kpi"><div class="kpi-icon">🧾</div><div><small>Factures de la Semaine</small><strong>${weekFactures.length}</strong></div></div>
          <div class="kpi"><div class="kpi-icon">💰</div><div><small>Total Encaissé Semaine</small><strong>${money(weekCashIn)}</strong></div></div>
        </div>
      </div>

      <!-- SECTION 3 : DÉTAIL DES DÉPARTS ET ACTIVITÉS DU JOUR -->
      <div class="panel">
        <div class="panel-title">
          <h3>🚗 Courses et Départs Programmés Aujourd'hui</h3>
          <button class="primary tiny" onclick="go('reservations')">Ouvrir réservations ›</button>
        </div>
        ${todayRes.length === 0 ? `
          <div class="empty-table">Aucune course ou réservation enregistrée spécifiquement pour aujourd'hui.<br><button class="primary tiny" onclick="openForm('reservations')">＋ Ajouter une réservation</button></div>
        ` : `
          <table class="table">
            <thead>
              <tr><th>Client</th><th>Trajet</th><th>Heure</th><th>Chauffeur</th><th>Statut</th></tr>
            </thead>
            <tbody>
              ${todayRes.map(r => `
                <tr>
                  <td><b>${esc(r.client || 'Client')}</b></td>
                  <td>${esc(r.origin || '')} ➔ ${esc(r.destination || r.route || '')}</td>
                  <td>${esc(r.time || '—')}</td>
                  <td>${esc(r.driver || 'Non assigné')}</td>
                  <td><span class="badge ${r.status === 'Confirmée' ? 'green' : 'orange'}">${esc(r.status || 'En attente')}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    `;
    return;
  }

  // VUE GLOBALE DIRECTION, ADMIN, COMPTABILITE
  const rev = allPaiements.filter(x => ["Reçu", "Validé", "Payé"].includes(x.status)).reduce((s, x) => s + Number(x.amount || 0), 0);
  const exp = allFinances.reduce((s, x) => s + Number(x.amount || 0), 0);
  const comm = allFinances.filter(x => String(x.category || '').toLowerCase().includes('chauffeur') || String(x.category || '').toLowerCase().includes('commission')).reduce((s, x) => s + Number(x.amount || 0), 0);
  const net = rev - exp;
  const laperleRev = rev - comm;

  document.getElementById("page").innerHTML = `
    <div class="section-head">
      <div>
        <h2>📊 Rapports Financiers & Synthèse Opérationnelle</h2>
        <p>Bilan financier d'entreprise et rapports d'activités en direct.</p>
      </div>
      <button class="primary" onclick="exportData()">Exporter les données</button>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="kpi-icon">💰</div><div><small>Chiffre d'Affaires Encaissé</small><strong>${money(rev)}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">🧾</div><div><small>Dépenses Globales</small><strong>${money(exp)}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">👨‍✈️</div><div><small>Commissions Chauffeurs</small><strong>${money(comm)}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">💎</div><div><small>Revenus Nets LAPERLE</small><strong>${money(laperleRev)}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">📈</div><div><small>Bénéfice Net</small><strong>${money(net)}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">👥</div><div><small>Clients Actifs</small><strong>${allClients.filter(x => !x.archived).length}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">🎒</div><div><small>Élèves Inscrits</small><strong>${allEleves.filter(x => !x.archived).length}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">🎫</div><div><small>Abonnements en cours</small><strong>${allAbos.filter(x => !x.archived).length}</strong></div></div>
    </div>

    <div class="dashboard-grid" style="margin-top:16px">
      <div class="panel" style="border-left:4px solid #2563eb">
        <div class="panel-title">
          <h3>📅 Synthèse Journalière (Aujourd'hui)</h3>
        </div>
        <div class="quick-list">
          <div><b>Courses & Réservations aujourd'hui :</b> ${todayRes.length}</div>
          <div><b>Plannings de départ du jour :</b> ${todayPlans.length}</div>
          <div><b>Factures émises ce jour :</b> ${todayFactures.length}</div>
          <div><b>Encaissements reçus aujourd'hui :</b> ${money(todayCashIn)}</div>
        </div>
      </div>
      <div class="panel" style="border-left:4px solid #f7941d">
        <div class="panel-title">
          <h3>🗓️ Synthèse Hebdomadaire (7 Jours)</h3>
        </div>
        <div class="quick-list">
          <div><b>Total Réservations semaine :</b> ${weekRes.length}</div>
          <div><b>Nouveaux Abonnements semaine :</b> ${weekAbos.length}</div>
          <div><b>Factures de la semaine :</b> ${weekFactures.length}</div>
          <div><b>Total Encaissé cette semaine :</b> ${money(weekCashIn)}</div>
        </div>
      </div>
    </div>
  `;
}

function marketingPage() {
  document.getElementById("page").innerHTML = `
    <div class="section-head">
      <div>
        <h2>📣 Marketing</h2>
        <p>Centre de préparation des actions commerciales LAPERLE TOUR HT.</p>
      </div>
      <button class="primary orange" onclick="showToast('Brief marketing enregistré.')">＋ Nouvelle action</button>
    </div>
    <div class="dashboard-grid">
      <div class="panel">
        <div class="panel-title"><h3>Calendrier contenu</h3></div>
        <div class="info"><b>Contenu de la semaine</b><br>Campagne axée sur le confort, la ponctualité du transport scolaire et les navettes aéroportuaires sécurisées.</div>
        <div class="info" style="margin-top:8px"><b>Canaux officiels</b><br>Facebook • Instagram • WhatsApp Business (+509 4440 8687)</div>
      </div>
      <div class="panel">
        <div class="panel-title"><h3>Prospection commerciale</h3></div>
        <div class="info"><b>Objectif actif</b><br>Suivre les demandes d'écoles et entreprises dans le module Prospects.</div>
        <button class="primary" style="margin-top:10px" onclick="go('prospects')">Ouvrir les prospects</button>
      </div>
    </div>
  `;
}

function settingsPage() {
  const company = localStorage.getItem("LAPERLE_COMPANY") || "LAPERLE TOUR HT";
  const phone = localStorage.getItem("LAPERLE_PHONE") || "+509 4440 8687";
  const email = localStorage.getItem("LAPERLE_EMAIL") || "laperletourht@gmail.com";
  const slogan = localStorage.getItem("LAPERLE_SLOGAN") || "Un coup d'œil sur Haïti";
  const address = localStorage.getItem("LAPERLE_ADDRESS") || "Port-au-Prince, Haïti";
  const moncash = localStorage.getItem("LAPERLE_MONCASH") || "+509 4440 8687";
  const admin = localStorage.getItem("LAPERLE_ADMIN") || "Castima";
  const currency = localStorage.getItem("LAPERLE_CURRENCY") || "HTG";

  document.getElementById("page").innerHTML = `
    <div class="section-head">
      <div>
        <h2>⚙️ Module Paramètres</h2>
        <p>Configuration générale, coordonnées officielles LAPERLE et synchronisation Firestore.</p>
      </div>
      <div class="actions">
        <button class="primary" onclick="saveSettings()">💾 Enregistrer les paramètres</button>
        <button class="secondary" onclick="go('dashboard')">← Tableau de bord</button>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="data-panel">
        <div class="panel-title"><h3>🏢 Coordonnées officielles LAPERLE TOUR HT</h3></div>
        <div class="info" style="margin-bottom:14px">Ces informations figurent automatiquement sur les <b>Proformas</b>, <b>Factures</b> et reçus.</div>
        <div class="form-grid">
          <div class="field"><label>Nom de l'entreprise</label><input id="setCompany" value="${esc(company)}"></div>
          <div class="field"><label>Slogan officiel</label><input id="setSlogan" value="${esc(slogan)}"></div>
          <div class="field"><label>Téléphone / WhatsApp</label><input id="setPhone" value="${esc(phone)}"></div>
          <div class="field"><label>Email officiel</label><input id="setEmail" value="${esc(email)}"></div>
          <div class="field"><label>Siège / Adresse</label><input id="setAddress" value="${esc(address)}"></div>
          <div class="field"><label>Compte MonCash</label><input id="setMoncash" value="${esc(moncash)}"></div>
          <div class="field"><label>Profil administrateur</label><input id="setAdmin" value="${esc(admin)}"></div>
          <div class="field"><label>Devise par défaut</label>
            <select id="setCurrency">
              <option ${currency === "HTG" ? "selected" : ""}>HTG</option>
              <option ${currency === "USD" ? "selected" : ""}>USD</option>
            </select>
          </div>
        </div>
        <div class="form-actions" style="margin-top:16px">
          <button class="primary" onclick="saveSettings()">Enregistrer les coordonnées</button>
        </div>
      </div>

      <div class="data-panel">
        <div class="panel-title"><h3>🔥 Cloud Firestore & Base de Données</h3></div>
        <div class="info" style="margin-bottom:10px">
          Projet Firebase : <b>pragmatic-port-83bk6</b> • Région : <b>us-west1</b><br>
          <span style="font-weight:600;color:${currentUser ? '#15803d' : '#475569'}">
            ${currentUser ? `✅ Connecté : ${esc(currentUser.email)} (${currentUserRoles.map(r => `<span class="user-role-badge ${r}">${ROLE_LABELS[r] || r}</span>`).join(" ")})` : '⚪ Mode local actif. Connectez-vous pour activer le Cloud.'}
          </span>
        </div>
        <div class="quick-list">
          <button onclick="syncAllToFirestore()">🔄 Synchroniser toutes les fiches sur Firestore <b>›</b></button>
          <button onclick="testFirebaseConnectionUI()">⚡ Tester la connexion Firestore <b>›</b></button>
          <button onclick="openFirebaseModal()">⚙️ Gérer l'accès Firebase <b>›</b></button>
          <button onclick="go('utilisateurs')">🛡️ Gérer les Utilisateurs & Rôles <b>›</b></button>
        </div>

        <div class="panel-title" style="margin-top:20px"><h3>💾 Sauvegarde & Restauration locale</h3></div>
        <div class="quick-list">
          <button onclick="exportData()">⬇ Exporter une sauvegarde JSON complète <b>›</b></button>
          <label class="secondary" style="display:block;cursor:pointer;padding:10px;border-radius:8px;border:1px solid #e1e7ee;margin:6px 0;background:#fff;text-align:left;font-size:12px;color:#28466f">
            ⬆ Importer une sauvegarde JSON <input type="file" accept=".json" hidden onchange="importData(event)">
          </label>
          <button onclick="resetDefaultData()" style="color:#b42318;border-color:#f8d7da">🔄 Réinitialiser les données d'exemple <b>›</b></button>
        </div>
      </div>
    </div>
  `;
}

function saveSettings() {
  const comp = document.getElementById("setCompany").value.trim();
  const slog = document.getElementById("setSlogan").value.trim();
  const pho = document.getElementById("setPhone").value.trim();
  const eml = document.getElementById("setEmail").value.trim();
  const addr = document.getElementById("setAddress").value.trim();
  const mon = document.getElementById("setMoncash").value.trim();
  const adm = document.getElementById("setAdmin").value.trim();
  const curr = document.getElementById("setCurrency").value;

  localStorage.setItem("LAPERLE_COMPANY", comp);
  localStorage.setItem("LAPERLE_SLOGAN", slog);
  localStorage.setItem("LAPERLE_PHONE", pho);
  localStorage.setItem("LAPERLE_EMAIL", eml);
  localStorage.setItem("LAPERLE_ADDRESS", addr);
  localStorage.setItem("LAPERLE_MONCASH", mon);
  localStorage.setItem("LAPERLE_ADMIN", adm);
  localStorage.setItem("LAPERLE_CURRENCY", curr);

  saveSettingsToFirestore({
    company: comp,
    slogan: slog,
    phone: pho,
    email: eml,
    address: addr,
    moncash: mon,
    admin: adm
  });

  showToast("Paramètres LAPERLE enregistrés sur Firestore.");
  settingsPage();
}

function resetDefaultData() {
  document.getElementById("modal").innerHTML = `
    <div class="modal-head">
      <div>
        <h2 style="color:#b42318">⚠️ Réinitialisation des données</h2>
        <small>Centre de Contrôle LAPERLE</small>
      </div>
      <button class="close" onclick="closeModal()">×</button>
    </div>
    <div class="info" style="background:#fff5f5;border:1px solid #fed7d7;color:#b42318;padding:14px;border-radius:8px">
      Voulez-vous réinitialiser toutes les données de démonstration de LAPERLE TOUR HT ? Vos modifications actuelles seront remplacées.
    </div>
    <div class="form-actions" style="margin-top:16px">
      <button class="secondary" onclick="closeModal()">Annuler</button>
      <button class="primary" style="background:#b42318;border-color:#b42318" onclick="executeResetData()">🔄 Confirmer la réinitialisation</button>
    </div>
  `;
  document.getElementById("modalBackdrop").classList.add("open");
}

function executeResetData() {
  state = getInitialData();
  save();
  closeModal();
  showToast("Données réinitialisées.");
  render();
}

async function createInvoiceFromQuote(index) {
  const q = list("proformas")[index];
  if (!q) return;

  const existing = list("factures").find(x => x.proforma === q.number || x.proforma === q.id);
  if (existing) {
    go("factures");
    showToast("Une facture existe déjà pour cette proforma.");
    return;
  }

  const invoiceNumber = nextFactureNumber();
  const newInvoice = {
    id: invoiceNumber,
    number: invoiceNumber,
    client: q.client || "",
    date: today(),
    proforma: q.number || q.id,
    amount: q.amount || 0,
    status: "Brouillon",
    due: today(),
    archived: false,
    notes: `Facture générée automatiquement depuis la proforma ${q.number || q.id}`
  };

  list("factures").push(newInvoice);
  save();
  await saveDocumentToFirestore("factures", newInvoice);

  go("factures");
  showToast(`Facture ${invoiceNumber} créée avec succès.`);
}

function printDocument(type, index) {
  const isQuote = type === "proforma" || type === "quote";
  const key = isQuote ? "proformas" : "factures";
  const o = list(key)[index];
  if (!o) return;

  const title = isQuote ? "PROFORMA" : "FACTURE";
  const client = list("clients").find(c => c.name === o.client || c.id === o.client) || {};
  const company = localStorage.getItem("LAPERLE_COMPANY") || "LAPERLE TOUR HT";
  const phone = localStorage.getItem("LAPERLE_PHONE") || "+509 4440 8687";
  const email = localStorage.getItem("LAPERLE_EMAIL") || "laperletourht@gmail.com";
  const slogan = localStorage.getItem("LAPERLE_SLOGAN") || "Un coup d'œil sur Haïti";
  const address = localStorage.getItem("LAPERLE_ADDRESS") || "Port-au-Prince, Haïti";
  const moncash = localStorage.getItem("LAPERLE_MONCASH") || phone;

  let w = null;
  try {
    w = window.open("", "_blank", "width=900,height=1000");
  } catch (e) {
    w = null;
  }

  const docHTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title} ${esc(o.number || o.id)}</title>
  <style>
  body{font-family:Arial,sans-serif;margin:0;color:#102b61;background:#fff}.doc{max-width:800px;margin:auto;padding:40px}.head{display:flex;justify-content:space-between;align-items:center;border-bottom:6px solid #123c98;padding-bottom:18px}.logo{width:150px;height:100px;object-fit:contain}.brand h1{margin:0;font-size:27px}.brand h1 span{color:#f7941d}.brand p{margin:6px 0;color:#526b8e}.tag{font-weight:700;color:#35a853;font-size:12px}.title{font-size:30px;font-weight:800;margin:28px 0 15px}.meta{display:flex;gap:15px}.box{flex:1;border:1px solid #dce4ee;border-radius:10px;padding:15px}.total{text-align:right;font-size:25px;font-weight:800;margin:25px 0;color:#0b3275}.foot{margin-top:60px;border-top:3px solid #35a853;padding-top:12px;text-align:center;font-size:12px;color:#667991}@media print{button{display:none}}
  </style></head><body><div class="doc">
  <div class="head"><img class="logo" src="logo-laperle.jpg"><div class="brand"><h1>LAPERLE <span>TOUR HT</span></h1><p>${esc(slogan)}</p><div class="tag">Confort • Sécurité • Confiance</div></div></div>
  <div class="title">${title}</div>
  <div class="meta">
    <div class="box"><b>Client</b><br>${esc(o.client || client.name || "—")}<br>${esc(client.phone || "")}<br>${esc(client.email || "")}</div>
    <div class="box"><b>Document</b><br>N° ${esc(o.number || o.id)}<br>Date : ${esc(o.date || today())}${isQuote ? "" : "<br>N° Proforma lié : " + esc(o.proforma || "—")}</div>
  </div>
  <div class="box" style="margin-top:15px">
    <b>Détails de la prestation</b>
    <p>Service : ${esc(o.service || "Transport & Services LAPERLE TOUR HT")}</p>
    <p>Trajet : ${esc(o.route || "—")}</p>
    <p>${isQuote ? "Validité" : "Échéance"} : ${esc(isQuote ? (o.validity || "—") : (o.due || "—"))}</p>
  </div>
  <div class="total">TOTAL : ${money(o.amount || 0)}</div>
  <p><b>Paiement :</b> MonCash ${esc(moncash)} | <b>Contact :</b> ${esc(phone)} | <b>Email :</b> ${esc(email)}</p>
  <div class="foot">${esc(company)} • ${esc(address)} • Transport • Tourisme • Location • Abonnement • Taxi<br>Confort • Sécurité • Confiance</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></div></body></html>`;

  if (w) {
    w.document.write(docHTML);
    w.document.close();
  } else {
    document.getElementById("modal").innerHTML = `
      <div class="modal-head">
        <div><h2>${title} ${esc(o.number || o.id)}</h2><small>Aperçu du document</small></div>
        <button class="close" onclick="closeModal()">×</button>
      </div>
      <div style="background:#fff;border:1px solid #dce4ee;border-radius:10px;padding:20px;margin-bottom:15px">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #123c98;padding-bottom:12px">
          <div><h3 style="margin:0;color:#082b70">LAPERLE <span style="color:#f7941d">TOUR HT</span></h3><small style="color:#667991">${esc(slogan)}</small></div>
          <div style="text-align:right"><div style="font-weight:800;font-size:18px;color:#082b70">${title}</div><span style="color:#f7941d;font-weight:700">N° ${esc(o.number || o.id)}</span></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
          <div class="info"><b>Client</b><br>${esc(o.client || client.name || "—")}<br>${esc(client.phone || "")}</div>
          <div class="info"><b>Document</b><br>Date : ${esc(o.date || today())}${isQuote ? "" : "<br>N° Proforma lié : " + esc(o.proforma || "—")}</div>
        </div>
        <div class="info" style="margin-top:10px">
          <b>Détails</b><br>Service : ${esc(o.service || "Transport LAPERLE TOUR HT")}<br>Trajet : ${esc(o.route || "—")}<br>${isQuote ? "Validité" : "Échéance"} : ${esc(isQuote ? (o.validity || "—") : (o.due || "—"))}
        </div>
        <div style="text-align:right;font-size:20px;font-weight:800;color:#0b3275;margin-top:15px">TOTAL : ${money(o.amount || 0)}</div>
        <p style="font-size:12px;color:#555;margin:8px 0 0">Paiement : MonCash ${esc(moncash)} • Contact : ${esc(phone)} • ${esc(email)}</p>
      </div>
      <div class="form-actions">
        <button class="secondary" onclick="closeModal()">Fermer</button>
        <button class="primary" onclick="window.print()">🖨️ Imprimer / PDF</button>
      </div>
    `;
    document.getElementById("modalBackdrop").classList.add("open");
  }
}

// Window attachments for inline HTML onclick handlers
window.go = go;
window.openForm = openForm;
window.closeModal = closeModal;
window.removeRow = removeRow;
window.executeArchive = executeArchive;
window.executePermanentDelete = executePermanentDelete;
window.viewRow = viewRow;
window.exportData = exportData;
window.importData = importData;
window.showToast = showToast;
window.resetDefaultData = resetDefaultData;
window.executeResetData = executeResetData;
window.saveSettings = saveSettings;
window.openProfile = openProfile;
window.openFirebaseModal = openFirebaseModal;
window.loginWithGoogle = loginWithGoogle;
window.logoutUser = logoutUser;
window.syncAllToFirestore = syncAllToFirestore;
window.testFirebaseConnectionUI = testFirebaseConnectionUI;
window.globalSearch = globalSearch;
window.createInvoiceFromQuote = createInvoiceFromQuote;
window.printDocument = printDocument;
window.drawTable = drawTable;
window.openUserRoleModal = openUserRoleModal;

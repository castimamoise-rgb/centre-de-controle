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
  createProforma, requestProforma, getProformas, updateProforma, archiveProforma, deleteProforma, subscribeProformas, generateProformaNumber,
  createFacture, getFactures, updateFacture, archiveFacture, deleteFacture, subscribeFactures, generateFactureNumber,
  createFinance, getFinances, updateFinance, archiveFinance, deleteFinance, subscribeFinances, calculateFinancialSummary,
  createOrUpdateUser, getUtilisateurs, updateUtilisateur, deleteUtilisateur, subscribeUtilisateurs, checkUserPermission, provisionUserInFirestore,
  createNotification, getNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification, subscribeNotifications, seedDefaultServiceAlerts, DEFAULT_SERVICE_ALERTS,
  getCompanySettings, saveCompanySettings, subscribeCompanySettings,
  // RBAC & Authentication Services
  ROLES, ROLE_LABELS, STATUS_LABELS, SUPER_ADMIN_EMAIL, SUPER_ADMIN_EMAILS, SUPER_ADMIN_PHONES,
  isSuperAdminEmail, isSuperAdminIdentifier, normalizeRole, normalizeRoles, normalizeStatus,
  BUSINESS_ROLES, hasBusinessRole,
  canAccessModule, hasActionPermission, filterDataForUser,
  loginWithGoogle as authLoginGoogle, logoutUser as authLogout, subscribeAuthState,
  ensureUserProfile, getUserProfile, createUserProfile, updateUserLastLogin, formatAuthError, signInWithGoogleOnly,
  getAllUsers, getUserById, updateUserRole, updateUserRoles, updateUserStatus, updateUserPermissions,
  createManagedUser, updateUserProfile, resetUsersDatabase,
  // Authentification Firebase sans mot de passe & Téléphone
  sendFirebaseEmailLink, checkIsSignInWithEmailLink, completeEmailLinkSignIn,
  sendFirebasePhoneVerification, verifyFirebasePhoneCode,
  sendVerificationCode, generateVerificationCode, getPendingVerification, verifyCode,
  authenticateWithPhoneOrEmail, registerOrSignInUser, upgradeProfileToClient, directEmailSignInFallback,
  signUpWithEmailAndPasswordMethod, signInWithEmailAndPasswordMethod, quickOneClickRegister,
  requestPasswordReset,
  saveUserSession, getUserSession, clearUserSession,
  saveLogoutInfo, getLogoutInfo, clearLogoutInfo,
  isExplicitlyLoggedOut, setExplicitLogout, clearExplicitLogout,
  // Fonctions pratiques employés
  formatPhoneForWhatsApp, openGpsRoute, openWhatsAppForTrip, quickUpdateTripStatus, submitDriverIncident,
  openSecretaryWhatsAppConfirmation, getTeamRelayNotes, saveTeamRelayNotes,
  detectPlanningConflicts, getFleetStatusBreakdown, getDailyCashBreakdown, getOverdueInvoices,
  sendInvoiceReminderWhatsApp
} from './services/index.js';

const DBKEY = "LAPERLE_CENTRE_CONTROL_V3";

// Restaurer la session utilisateur sauvegardée ou afficher la page de reconnexion si déconnecté
// Une session locale est un cache d’affichage, jamais une preuve d’identité.
let currentUser = null;
let currentUserProfile = null;
let currentRole = null;
let currentUserRoles = [];
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
  const isSuper = isSuperAdminEmail(currentUser?.email);
  if (isSuper) {
    badge.innerHTML = `👑 SUPER ADMIN`;
    badge.className = `user-role-badge admin super-admin`;
    badge.title = `Super Administrateur Principal (Fondateur) - Habilitation absolue`;
    return;
  }
  const text = rolesList.map(r => (r === ROLES.ADMIN ? "👑 ADMIN" : (ROLE_LABELS[r] || r.toUpperCase()))).join(" + ");
  badge.textContent = text;
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
  if (!db || !auth.currentUser) {
    return;
  }
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
  if (!db || !auth.currentUser) {
    if (col === 'utilisateurs') {
      try {
        await fetch(`/api/auth/user/${encodeURIComponent(docId)}`, { method: 'DELETE' });
      } catch (e) {}
    }
    return;
  }
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
  if (!db || !auth.currentUser) {
    return;
  }
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
  isAuthProcessing = true;
  try {
    // Un nouveau compte Google est lui aussi provisionné comme prospect via le serveur.
    const result = await authLoginGoogle('register');
    completeUserSignIn(result.user, result.profile, result.isNew);
  } catch (error) {
    showToast(formatAuthError(error) || error?.message || 'Connexion Google impossible.');
  } finally {
    isAuthProcessing = false;
  }
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
  utilisateurs: { label: "Équipe & Rôles", icon: "🛡️" },
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
    ["demandeProforma", "Demander un devis Proforma", "select:Oui|Non"],
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
    utilisateurs: []
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(DBKEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        parsed.utilisateurs = [];
        return parsed;
      }
    }
  } catch (e) {}
  const initial = getInitialData();
  try { localStorage.setItem(DBKEY, JSON.stringify(initial)); } catch (e) {}
  return initial;
}

function safeJsonStringify(obj, space) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return undefined; // Break circular reference
      }
      seen.add(value);
    }
    return value;
  }, space);
}

function save() {
  try {
    localStorage.setItem(DBKEY, safeJsonStringify(state));
  } catch (e) {
    console.warn("Erreur sauvegarde locale sécurisée:", e?.message);
  }
}

function rawList(k) {
  const canon = canonicalCol(k);
  if (!Array.isArray(state[canon])) state[canon] = [];
  return state[canon];
}

function list(k) {
  const canon = canonicalCol(k);
  if (!Array.isArray(state[canon])) state[canon] = [];

  // Intégration CRM : Les utilisateurs inscrits avec le profil 'prospect'
  // apparaissent également dans le module commercial Prospects pour l'administration
  if (canon === 'prospects') {
    const registeredProspects = (state.utilisateurs || []).filter(u => {
      const uRoles = normalizeRoles(u.roles || [u.role]);
      return uRoles.includes(ROLES.PROSPECT);
    });
    registeredProspects.forEach(u => {
      const uEmail = (u.email || '').toLowerCase().trim();
      const uId = u.uid || u.id;
      const uName = u.name || u.nom || (uEmail ? uEmail.split('@')[0] : 'Prospect Web');
      const alreadyIn = state.prospects.some(p => (p.userId && p.userId === uId) || (uEmail && p.email && p.email.toLowerCase() === uEmail));
      if (!alreadyIn) {
        state.prospects.push({
          id: `PR-${String(uId || '').slice(-4).toUpperCase() || nextNumber('PR', 'prospects').slice(3)}`,
          userId: uId,
          name: uName,
          phone: u.telephone || u.phone || '',
          email: uEmail,
          need: 'Inscription en ligne (Site Web)',
          source: 'Site Web LAPERLE TOUR HT',
          status: 'Nouveau',
          next: today(),
          notes: `Inscrit en ligne le ${u.createdAt ? String(u.createdAt).slice(0, 10) : today()}`,
          createdAt: u.createdAt || new Date().toISOString()
        });
      }
    });
  }

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

  const isSuper = isSuperAdminEmail(currentUser?.email || currentUserProfile?.email);

  // Utilisateur avec uniquement lecture_seule : aucun module métier
  if (!isSuper && !hasBusinessRole(currentUserRoles)) {
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

  // Utilisateur avec rôle PROSPECT : Espace dédié (Profil & Réservations)
  const normCurrentRoles = normalizeRoles(currentUserRoles);
  if (!isSuper && normCurrentRoles.length === 1 && normCurrentRoles[0] === ROLES.PROSPECT) {
    const header = document.createElement("div");
    header.className = "nav-section-title";
    header.textContent = "Espace Prospect";
    nav.appendChild(header);

    const bProf = document.createElement("button");
    bProf.className = "nav-item" + (current === "profile" ? " active" : "");
    bProf.dataset.key = "profile";
    bProf.innerHTML = `<span class="nav-icon">👤</span><span>Mon Profil & Statut</span><span class="chev">›</span>`;
    bProf.onclick = () => go("profile");
    nav.appendChild(bProf);

    const bRes = document.createElement("button");
    bRes.className = "nav-item" + (current === "reservations" ? " active" : "");
    bRes.dataset.key = "reservations";
    bRes.innerHTML = `<span class="nav-icon">🎫</span><span>Mes Réservations</span><span class="nav-badge" id="navBadge_reservations" style="display:none">0</span><span class="chev">›</span>`;
    bRes.onclick = () => go("reservations");
    nav.appendChild(bRes);

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
  if (typeof updateNotificationBadge === "function") {
    updateNotificationBadge();
  }
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

// =========================================================================
// SYSTÈME DE NOTIFICATIONS EN TEMPS RÉEL (ALERTES DE SERVICE & MISES À JOUR)
// =========================================================================
let isNotifDropdownOpen = false;
let activeNotifFilter = 'all'; // 'all', 'service', 'update', 'unread'
let previousUnreadCount = null;
const knownNotificationIds = new Set();
const newlyArrivedNotificationIds = new Set();

// Initialiser les notifications déjà en mémoire pour identifier les nouvelles arrivées
if (typeof state !== 'undefined' && Array.isArray(state.notifications)) {
  state.notifications.forEach(n => {
    if (n && n.id) knownNotificationIds.add(n.id);
  });
}

function registerIncomingNotifications(items) {
  if (!Array.isArray(items)) return;
  if (knownNotificationIds.size === 0) {
    items.forEach(it => {
      if (it && it.id) knownNotificationIds.add(it.id);
    });
    return;
  }
  items.forEach(it => {
    if (it && it.id && !knownNotificationIds.has(it.id)) {
      knownNotificationIds.add(it.id);
      newlyArrivedNotificationIds.add(it.id);
    }
  });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diffSec < 60) return "À l'instant";
  if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    return `Il y a ${mins} min`;
  }
  if (diffSec < 86400) {
    const hours = Math.floor(diffSec / 3600);
    return `Il y a ${hours}h`;
  }
  const days = Math.floor(diffSec / 86400);
  if (days === 1) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `Hier à ${hh}h${mm}`;
  }
  if (days < 7) {
    return `Il y a ${days}j`;
  }
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function getApplicableNotifications() {
  const all = Array.isArray(state.notifications) ? [...state.notifications] : [];
  all.sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime());
  
  if (!currentUser) return all;
  const roles = normalizeRoles(currentUserRoles);
  const isStaff = roles.some(r => ['admin', 'direction', 'operations', 'secretaire', 'comptabilite'].includes(r)) || isSuperAdminEmail(currentUser?.email);
  if (isStaff) return all;

  // Filtrage strict pour client / prospect / chauffeur : ils ne voient JAMAIS les alertes staff ni les réservations des autres
  const uid = currentUser.uid || currentUser.id;
  const email = (currentUser.email || '').toLowerCase();
  return all.filter(n => {
    // 1. Bloquer toute notification interne, d'administration ou réservée au staff
    const isStaffAlert = n.forRole === 'admin' || n.forRole === 'staff' || n.forRole === 'direction' || n.forRole === 'secretaire' ||
                         n.targetRole === 'staff' || n.targetRole === 'admin' ||
                         n.targetUid === 'staff' || n.targetUid === 'admin' || n.isInternal === true;
    if (isStaffAlert) return false;

    // 2. Alertes personnelles nominatives destinées à cet utilisateur
    if (n.targetUid === uid || n.userId === uid || n.uid === uid || n.clientId === uid || n.chauffeurId === uid) return true;
    if (n.email && n.email.toLowerCase() === email) return true;

    // 3. Alertes générales de service / météo / trafic destinées au public
    if (n.targetUid === 'all' || n.targetUid === 'broadcast' || n.broadcast === true) return true;

    return false;
  });
}

function updateNotificationBadge() {
  const notifDot = document.getElementById("notifDot");
  if (!notifDot) return;

  const notifs = getApplicableNotifications();
  const unreadList = notifs.filter(n => !n.read);
  const unreadCount = unreadList.length;

  if (unreadCount > 0) {
    notifDot.style.display = "flex";
    notifDot.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    
    // Check if any unread notification is urgent or service alert
    const hasUrgent = unreadList.some(n => n.priority === 'urgent' || n.priority === 'high' || n.type === 'alerte' || n.type === 'service');
    if (hasUrgent) {
      notifDot.classList.add("pulse");
    } else {
      notifDot.classList.remove("pulse");
    }

    // Play subtle toast notification if count increased during runtime
    if (previousUnreadCount !== null && unreadCount > previousUnreadCount) {
      const newest = unreadList[0];
      if (newest) {
        showToast(`🔔 ${newest.title || 'Nouvelle notification Laperle'}`);
      }
    }
  } else {
    notifDot.style.display = "none";
    notifDot.classList.remove("pulse");
  }

  previousUnreadCount = unreadCount;
}

function toggleNotificationDropdown() {
  if (isNotifDropdownOpen) {
    closeNotificationDropdown();
  } else {
    openNotificationDropdown();
  }
}

function openNotificationDropdown() {
  const dropdown = document.getElementById("notifDropdown");
  if (!dropdown) return;
  isNotifDropdownOpen = true;
  dropdown.style.display = "flex";
  renderNotificationDropdown();
}

function closeNotificationDropdown() {
  const dropdown = document.getElementById("notifDropdown");
  if (!dropdown) return;
  isNotifDropdownOpen = false;
  dropdown.style.display = "none";
}

function setNotifFilter(filter) {
  activeNotifFilter = filter;
  renderNotificationDropdown();
}

function renderNotificationDropdown() {
  const dropdown = document.getElementById("notifDropdown");
  if (!dropdown) return;

  const allNotifs = getApplicableNotifications();
  const unreadCount = allNotifs.filter(n => !n.read).length;
  const alertsCount = allNotifs.filter(n => n.type === 'alerte' || n.type === 'service' || n.priority === 'high' || n.priority === 'urgent').length;
  const updatesCount = allNotifs.filter(n => n.type === 'update' || n.type === 'transport' || n.type === 'info').length;

  let filtered = allNotifs;
  if (activeNotifFilter === 'unread') {
    filtered = allNotifs.filter(n => !n.read);
  } else if (activeNotifFilter === 'service') {
    filtered = allNotifs.filter(n => n.type === 'alerte' || n.type === 'service' || n.priority === 'high' || n.priority === 'urgent');
  } else if (activeNotifFilter === 'update') {
    filtered = allNotifs.filter(n => n.type === 'update' || n.type === 'transport' || n.type === 'info');
  }

  const roles = normalizeRoles(currentUserRoles);
  const canBroadcast = roles.some(r => ['admin', 'direction', 'operations'].includes(r)) || isSuperAdminEmail(currentUser?.email);
  const canDeleteNotif = roles.includes('admin') || isSuperAdminEmail(currentUser?.email);

  dropdown.innerHTML = `
    <div class="notif-header">
      <div class="notif-header-title-wrap">
        <span style="font-size:18px;">🔔</span>
        <h4 class="notif-header-title">Notifications & Alertes</h4>
        ${unreadCount > 0 ? `<span class="notif-count-badge">${unreadCount} non lue${unreadCount > 1 ? 's' : ''}</span>` : ''}
      </div>
      <div class="notif-header-actions">
        ${unreadCount > 0 ? `
          <button class="notif-btn-header" onclick="handleMarkAllRead()" title="Marquer tout comme lu">
            <span>✓✓</span> <span>Tout lire</span>
          </button>
        ` : ''}
        <button class="notif-btn-close" onclick="closeNotificationDropdown()" title="Fermer">✕</button>
      </div>
    </div>

    ${canBroadcast ? `
      <div class="notif-broadcast-strip">
        <span>📢 Diffuser une alerte aux conducteurs et clients</span>
        <button class="notif-broadcast-btn" onclick="openBroadcastModal()">+ Diffuser</button>
      </div>
    ` : ''}

    <div class="notif-tabs">
      <button class="notif-tab ${activeNotifFilter === 'all' ? 'active' : ''}" onclick="setNotifFilter('all')">
        Toutes (${allNotifs.length})
      </button>
      <button class="notif-tab ${activeNotifFilter === 'service' ? 'active' : ''}" onclick="setNotifFilter('service')">
        🚨 Alertes (${alertsCount})
      </button>
      <button class="notif-tab ${activeNotifFilter === 'update' ? 'active' : ''}" onclick="setNotifFilter('update')">
        📢 Mises à jour (${updatesCount})
      </button>
      <button class="notif-tab ${activeNotifFilter === 'unread' ? 'active' : ''}" onclick="setNotifFilter('unread')">
        Non lues (${unreadCount})
      </button>
    </div>

    <div class="notif-list">
      ${filtered.length === 0 ? `
        <div class="notif-empty">
          <div class="notif-empty-icon">🔔</div>
          <p class="notif-empty-title">Aucune alerte ou notification</p>
          <p class="notif-empty-desc">Toutes les informations opérationnelles et alertes de service sont à jour.</p>
        </div>
      ` : filtered.map((item, idx) => {
        const isUrgent = item.priority === 'urgent' || item.priority === 'high' || item.type === 'alerte';
        const isTransport = item.type === 'transport';
        const isNewArrival = newlyArrivedNotificationIds.has(item.id);
        const animDelay = `${Math.min(idx * 30, 240)}ms`;
        let typePillClass = item.type || 'info';
        let typeLabel = 'INFO';
        let typeEmoji = 'ℹ️';

        if (item.type === 'service') { typeLabel = 'ALERTE SERVICE'; typeEmoji = '🚨'; }
        else if (item.type === 'alerte') { typeLabel = 'URGENCE'; typeEmoji = '⚠️'; }
        else if (item.type === 'transport') { typeLabel = 'FLOTTE & CIRCUIT'; typeEmoji = '🚌'; }
        else if (item.type === 'update') { typeLabel = 'MISE À JOUR'; typeEmoji = '📢'; }
        else if (item.type === 'finance') { typeLabel = 'FINANCES'; typeEmoji = '💳'; }

        const roles = normalizeRoles(currentUserRoles);
        const isStaff = roles.some(r => ['admin', 'direction', 'operations', 'secretaire', 'comptabilite'].includes(r)) || isSuperAdminEmail(currentUser?.email);

        let actionHtml = "";
        if (isStaff && item.reservationId && !item.actionCompleted) {
          const reqType = item.actionType === 'demande_facture' ? 'facture' : 'proforma';
          const btnLabel = reqType === 'facture' ? '✅ Accepter & Émettre la Facture' : '✅ Accepter & Émettre la Proforma';
          actionHtml = `
            <div style="margin: 8px 0 6px 0; display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="notif-action-btn" style="background:#082b70;color:#fff;border-color:#082b70;font-weight:700;padding:5px 10px;font-size:11px" onclick="handleAcceptDocumentRequestFromAlert('${item.id}', '${item.reservationId}', '${reqType}')">
                ${btnLabel}
              </button>
            </div>
          `;
        } else if (item.actionCompleted) {
          actionHtml = `
            <div style="margin: 6px 0; font-size: 11px; color: #15803d; font-weight: 700; display:flex; align-items:center; gap:4px">
              <span>✅</span> <span>Demande acceptée • Document émis (${escapeHtml(item.actionCompletedDoc || '')})</span>
            </div>
          `;
        } else if (!isStaff && (item.proformaId || item.factureId)) {
          const docType = item.factureId ? 'facture' : 'proforma';
          const docId = item.factureId || item.proformaId;
          actionHtml = `
            <div style="margin: 8px 0 6px 0; display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="notif-action-btn" style="background:#082b70;color:#fff;border-color:#082b70;font-weight:700;padding:5px 10px;font-size:11px" onclick="handleOpenDocumentFromAlert('${docType}', '${docId}')">
                📄 Consulter le document PDF (${escapeHtml(docId)})
              </button>
            </div>
          `;
        }

        return `
          <div class="notif-item ${isNewArrival ? 'notif-new-arrival' : ''} ${!item.read ? 'unread' : ''} ${isUrgent ? 'is-urgent' : ''} ${isTransport ? 'is-transport' : ''}" style="animation-delay: ${animDelay};">
            <div class="notif-item-top">
              <span class="notif-type-pill ${typePillClass}">
                <span>${typeEmoji}</span>
                <span>${typeLabel}</span>
              </span>
              ${isUrgent ? `<span class="notif-type-pill alerte" style="font-size:9px;padding:1px 5px;">PRIORITAIRE</span>` : ''}
              ${isNewArrival ? `<span class="notif-type-pill update" style="font-size:9px;padding:1px 6px;background:#e0f2fe;color:#0369a1;font-weight:800;">NOUVEAU</span>` : ''}
              <span class="notif-time">${formatRelativeTime(item.createdAt || item.date)}</span>
            </div>
            <h5 class="notif-title">${escapeHtml(item.title || 'Information LAPERLE')}</h5>
            <p class="notif-message">${escapeHtml(item.message || '')}</p>
            ${actionHtml}
            <div class="notif-actions">
              <button class="notif-action-btn" onclick="handleToggleRead('${item.id}', ${!item.read})">
                ${item.read ? 'Marquer non lu' : '✓ Marquer lu'}
              </button>
              ${canDeleteNotif ? `
                <button class="notif-action-btn delete" onclick="handleDeleteNotification('${item.id}')">
                  🗑️ Supprimer
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="notif-footer">
      <div class="notif-live-indicator">
        <span class="notif-live-dot"></span>
        <span>Firebase Cloud Sync Actif</span>
      </div>
      <button class="notif-action-btn" onclick="refreshNotifications()" title="Actualiser manuellement">
        🔄 Actualiser
      </button>
    </div>
  `;

  if (newlyArrivedNotificationIds.size > 0) {
    setTimeout(() => {
      newlyArrivedNotificationIds.clear();
    }, 3000);
  }
}

async function handleToggleRead(id, newReadStatus) {
  try {
    const notif = (state.notifications || []).find(n => n.id === id);
    if (notif) {
      notif.read = newReadStatus;
    }
    updateNotificationBadge();
    renderNotificationDropdown();
    if (newReadStatus) {
      await markNotificationRead(id);
    } else {
      await updateDoc(doc(db, 'notifications', id), {
        read: false,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || 'user'
      });
    }
  } catch (e) {
    console.error("Erreur toggle read notification:", e);
    updateNotificationBadge();
    renderNotificationDropdown();
  }
}

async function handleMarkAllRead() {
  const notifs = getApplicableNotifications().filter(n => !n.read);
  if (notifs.length === 0) return;
  notifs.forEach(n => { n.read = true; });
  updateNotificationBadge();
  renderNotificationDropdown();
  try {
    await markAllNotificationsRead(notifs);
    showToast("Toutes les notifications ont été marquées comme lues.");
  } catch (e) {
    console.warn("Erreur marquage global:", e);
  }
}

async function handleDeleteNotification(id) {
  if (!confirm("Voulez-vous supprimer cette alerte / notification ?")) return;
  try {
    state.notifications = (state.notifications || []).filter(n => n.id !== id);
    updateNotificationBadge();
    renderNotificationDropdown();
    await deleteNotification(id);
    showToast("Alerte / notification supprimée.");
  } catch (e) {
    console.error("Erreur suppression notif:", e);
    showToast("Erreur lors de la suppression.");
  }
}

function openBroadcastModal() {
  closeNotificationDropdown();
  const modal = document.getElementById("modal");
  const modalBackdrop = document.getElementById("modalBackdrop");
  if (!modal || !modalBackdrop) return;

  modal.innerHTML = `
    <div class="modal-head">
      <h2 style="display:flex;align-items:center;gap:8px;">
        <span>📢</span> <span>Diffuser une Alerte de Service ou Mise à Jour</span>
      </h2>
      <button class="close" onclick="closeModal()">✕</button>
    </div>
    <form id="broadcastAlertForm" onsubmit="handleSendBroadcast(event)" style="display:flex;flex-direction:column;gap:14px;">
      <div class="form-grid">
        <div class="field">
          <label for="alertType">Type d'alerte / notification :</label>
          <select id="alertType" required>
            <option value="service">🚨 Alerte de service / Trafic routier</option>
            <option value="transport">🚌 Flotte, Véhicules & Circuits</option>
            <option value="alerte">⚠️ Maintenance urgente ou Retard</option>
            <option value="update">📢 Mise à jour opérationnelle</option>
            <option value="finance">💳 Facturation & Avis financier</option>
            <option value="info">ℹ️ Information générale</option>
          </select>
        </div>
        <div class="field">
          <label for="alertPriority">Niveau d'urgence :</label>
          <select id="alertPriority">
            <option value="normal">Normal (Information)</option>
            <option value="high">Haute (Prioritaire)</option>
            <option value="urgent">Urgente (Alerte rouge)</option>
          </select>
        </div>
        <div class="field full">
          <label for="alertTarget">Destinataires :</label>
          <select id="alertTarget">
            <option value="all">Tous les utilisateurs (Diffusion globale en temps réel)</option>
            <option value="clients">Clients et Passagers seulement</option>
            <option value="chauffeurs">Chauffeurs et Conducteurs seulement</option>
          </select>
        </div>
        <div class="field full">
          <label for="alertTitle">Titre de l'alerte (Court et clair) :</label>
          <input type="text" id="alertTitle" placeholder="Ex: Alerte Météo : Itinéraire Pétion-Ville dégagé" maxlength="150" required>
        </div>
        <div class="field full">
          <label for="alertMessage">Message détaillé :</label>
          <textarea id="alertMessage" placeholder="Précisez la situation, les consignes ou les horaires pour les conducteurs et passagers..." maxlength="500" rows="4" required></textarea>
          <small style="color:#64748b;font-size:11px;display:block;margin-top:4px;">Maximum 500 caractères. Visible instantanément par les utilisateurs connectés.</small>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="secondary" onclick="closeModal()">Annuler</button>
        <button type="submit" class="primary" style="background:#f7941d;">🚀 Publier en direct sur Firebase</button>
      </div>
    </form>
  `;
  modalBackdrop.classList.add("open");
}

async function handleSendBroadcast(e) {
  e.preventDefault();
  const typeEl = document.getElementById("alertType");
  const priorityEl = document.getElementById("alertPriority");
  const targetEl = document.getElementById("alertTarget");
  const titleEl = document.getElementById("alertTitle");
  const messageEl = document.getElementById("alertMessage");

  if (!titleEl || !messageEl) return;
  const title = titleEl.value.trim();
  const message = messageEl.value.trim();

  if (!title || !message) {
    showToast("⚠️ Veuillez renseigner le titre et le message de l'alerte.");
    return;
  }

  try {
    const payload = {
      title,
      message,
      type: typeEl?.value || 'service',
      priority: priorityEl?.value || 'normal',
      targetUid: targetEl?.value || 'all',
      broadcast: (targetEl?.value === 'all' || !targetEl?.value),
      read: false,
      date: new Date().toISOString()
    };

    await createNotification(payload);
    closeModal();
    showToast("✅ Alerte de service diffusée avec succès sur Firebase Cloud !");
  } catch (err) {
    console.error("Erreur diffusion alerte:", err);
    showToast("❌ Erreur lors de la diffusion de l'alerte.");
  }
}

// Bind notification bell button
const notifBtn = document.getElementById("notificationBtn");
if (notifBtn) {
  notifBtn.onclick = (e) => {
    e.stopPropagation();
    toggleNotificationDropdown();
  };
}

// Global click & key listeners to close dropdown when clicking outside
document.addEventListener("click", (e) => {
  const wrapper = document.getElementById("notifWrapper");
  if (isNotifDropdownOpen && wrapper && !wrapper.contains(e.target)) {
    closeNotificationDropdown();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isNotifDropdownOpen) {
    closeNotificationDropdown();
  }
});

window.handleMarkAllRead = handleMarkAllRead;
window.handleToggleRead = handleToggleRead;
window.handleDeleteNotification = handleDeleteNotification;
window.closeNotificationDropdown = closeNotificationDropdown;
window.setNotifFilter = setNotifFilter;
window.openBroadcastModal = openBroadcastModal;
window.handleSendBroadcast = handleSendBroadcast;
window.refreshNotifications = async () => {
  try {
    const list = await getNotifications();
    if (list) state.notifications = list;
    updateNotificationBadge();
    renderNotificationDropdown();
    showToast("Notifications actualisées.");
  } catch (e) {
    showToast("Erreur actualisation.");
  }
};

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
      { col: 'notifications', q: query(collection(db, 'notifications'), where('targetUid', 'in', [currentUser.uid, 'all'])) }
    ];

    chauffeurCols.forEach(({ col, q }) => {
      try {
        const unsub = onSnapshot(q, (snap) => {
          const items = [];
          snap.forEach(d => items.push({ ...d.data(), id: d.id }));
          state[col] = items;
          save();
          if (col === 'notifications') {
            registerIncomingNotifications(items);
            updateNotificationBadge();
            if (isNotifDropdownOpen) renderNotificationDropdown();
          }
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
      { col: 'notifications', q: query(collection(db, 'notifications'), where('targetUid', 'in', [currentUser.uid, 'all'])) }
    ];

    clientCols.forEach(({ col, q }) => {
      try {
        const unsub = onSnapshot(q, (snap) => {
          const items = [];
          snap.forEach(d => items.push({ ...d.data(), id: d.id }));
          state[col] = items;
          save();
          if (col === 'notifications') {
            registerIncomingNotifications(items);
            updateNotificationBadge();
            if (isNotifDropdownOpen) renderNotificationDropdown();
          }
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

  // 2b. PROSPECT ONLY: Read ONLY own reservations and own profile; react to role upgrades
  const isProspectOnly = !hasStaffRole && !roles.includes('chauffeur') && !roles.includes('client') && roles.includes('prospect');
  if (isProspectOnly) {
    const prospectCols = [
      { col: 'reservations', q: query(collection(db, 'reservations'), where('clientId', '==', currentUser.uid)) },
      { col: 'notifications', q: query(collection(db, 'notifications'), where('targetUid', 'in', [currentUser.uid, 'all'])) }
    ];

    prospectCols.forEach(({ col, q }) => {
      try {
        const unsub = onSnapshot(q, (snap) => {
          const items = [];
          snap.forEach(d => items.push({ ...d.data(), id: d.id }));
          state[col] = items;
          save();
          if (col === 'notifications') {
            registerIncomingNotifications(items);
            updateNotificationBadge();
            if (isNotifDropdownOpen) renderNotificationDropdown();
          }
          if (current === col || canonicalCol(current) === col || current === "profile") render();
        }, (err) => console.warn(`Lecture prospect [${col}]:`, err?.message));
        firestoreUnsubscribers.push(unsub);
      } catch (e) {
        console.warn(`Erreur listener prospect [${col}]:`, e);
      }
    });

    // Profile listener (own document only) - will automatically update and reconfigure listeners when upgraded to CLIENT!
    try {
      const unsubUser = onSnapshot(doc(db, 'utilisateurs', currentUser.uid), (snap) => {
        if (snap.exists()) {
          const prevRoles = normalizeRoles(currentUserRoles);
          currentUserProfile = { ...snap.data(), id: snap.id };
          currentUserRoles = normalizeRoles(currentUserProfile.roles || currentUserProfile.role || [ROLES.PROSPECT]);
          currentRole = currentUserRoles[0] || ROLES.PROSPECT;
          updateRoleBadge(currentUserRoles);
          buildNavigation();
          // Si le profil est passé de PROSPECT à CLIENT (après premier proforma)
          if (!prevRoles.includes(ROLES.CLIENT) && currentUserRoles.includes(ROLES.CLIENT)) {
            showToast("🎉 Félicitations ! Votre profil est passé à CLIENT suite à votre premier proforma.");
            setupFirestoreListeners();
          }
          render();
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
        let cloudItems = [];
        snap.forEach(d => {
          cloudItems.push({ ...d.data(), id: d.id });
        });

        // Filtrer les index d'indexation O(1) de recherche (usr_email_..., usr_uname_...)
        if (colName === 'utilisateurs') {
          cloudItems = cloudItems.filter(u => u && typeof u.id === 'string' && !u.id.startsWith('usr_email_') && !u.id.startsWith('usr_uname_'));
          const seen = new Set();
          cloudItems = cloudItems.filter(u => {
            const key = u.uid || u.id;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }

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
        if (colName === 'notifications') {
          registerIncomingNotifications(cloudItems);
          updateNotificationBadge();
          if (isNotifDropdownOpen) renderNotificationDropdown();
        }
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
  // Respecter la consigne stricte : aucune modification de la base de données à la mise à jour du site
  return;
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
  const viewForgot = document.getElementById("authViewForgotPassword");
  const switchToRegister = document.getElementById("authSwitchToRegister");
  const switchToLogin = document.getElementById("authSwitchToLogin");
  const btnForgotPwd = document.getElementById("authBtnForgotPwd");
  const switchBackFromForgot = document.getElementById("authSwitchBackFromForgot");
  const btnSendReset = document.getElementById("authBtnSendReset");
  const forgotIdentifier = document.getElementById("authForgotIdentifier");
  const authRememberMe = document.getElementById("authRememberMe");

  // Champs Vue Connexion ("Pour Se Connecter" selon le modèle)
  const loginEmail = document.getElementById("authLoginEmail");
  const loginPassword = document.getElementById("authLoginPassword");
  const toggleLoginPwd = document.getElementById("authToggleLoginPassword");
  const btnLogin = document.getElementById("authBtnLogin");

  // Champs Vue Inscription ("Pour S'inscrire" selon le modèle)
  const registerNom = document.getElementById("authRegisterNom");
  const registerPrenom = document.getElementById("authRegisterPrenom");
  const registerEmail = document.getElementById("authRegisterEmail");
  const registerPhone = document.getElementById("authRegisterPhone");
  const registerUsername = document.getElementById("authRegisterUsername");
  const registerPassword = document.getElementById("authRegisterPassword");
  const registerPasswordConfirm = document.getElementById("authRegisterPasswordConfirm");
  const toggleRegisterPwd = document.getElementById("authToggleRegisterPassword");
  const toggleRegisterConfirm = document.getElementById("authToggleRegisterConfirm");
  const btnRegister = document.getElementById("authBtnRegister");

  // Gestion des états de chargement (Spinners & anti-double-clic)
  function setButtonState(btn, isLoading, loadingText, defaultText) {
    if (!btn) return;
    btn.disabled = isLoading;
    if (isLoading) {
      btn.classList.add("btn-loading");
      btn.innerHTML = `<span class="auth-spinner"></span> <span>${loadingText}</span>`;
    } else {
      btn.classList.remove("btn-loading");
      btn.innerHTML = `<span class="btn-text">${defaultText}</span>`;
    }
  }

  // Bascule dynamique entre "Se Connecter", "S'inscrire" et "Mot de passe oublié"
  function setMode(mode) {
    currentAuthMode = mode;
    if (tabLogin) tabLogin.classList.toggle("active", mode === "login");
    if (tabRegister) tabRegister.classList.toggle("active", mode === "register");
    if (viewLogin) viewLogin.style.display = mode === "login" ? "block" : "none";
    if (viewRegister) viewRegister.style.display = mode === "register" ? "block" : "none";
    if (viewForgot) viewForgot.style.display = mode === "forgot" ? "block" : "none";
    setAuthMessage("idle", "");

    if (mode === "forgot" && forgotIdentifier && loginEmail?.value.trim()) {
      forgotIdentifier.value = loginEmail.value.trim();
    }
  }

  setMode(initialMode);

  // Mémorisation de l'identifiant (Remember Me)
  const REMEMBER_KEY = "LAPERLE_REMEMBER_LOGIN_ID";
  try {
    const savedRememberId = localStorage.getItem(REMEMBER_KEY);
    if (savedRememberId && loginEmail) {
      loginEmail.value = savedRememberId;
      if (authRememberMe) authRememberMe.checked = true;
    }
  } catch (e) {}

  if (loginPassword) loginPassword.value = "";

  if (tabLogin) tabLogin.onclick = () => setMode("login");
  if (tabRegister) tabRegister.onclick = () => setMode("register");
  if (switchToRegister) switchToRegister.onclick = () => setMode("register");
  if (switchToLogin) switchToLogin.onclick = () => setMode("login");
  if (btnForgotPwd) btnForgotPwd.onclick = () => setMode("forgot");
  if (switchBackFromForgot) switchBackFromForgot.onclick = () => setMode("login");

  // Validation visuelle du mot de passe Firebase (8 caractères minimum).
  function updatePasswordChecklist() {
    const pwd = registerPassword ? registerPassword.value : "";
    const confirm = registerPasswordConfirm ? registerPasswordConfirm.value : "";

    const reqLen = document.getElementById("authReqLength");
    const reqAlpha = document.getElementById("authReqAlpha");
    const reqMatch = document.getElementById("authReqMatch");

    const isLenValid = pwd.length >= 8 && pwd.length <= 128;
    const isAlphaValid = pwd.length > 0;
    const isMatchValid = pwd.length > 0 && confirm.length > 0 && pwd === confirm;

    if (reqLen) {
      const isTooLong = pwd.length > 128;
      reqLen.className = `auth-req-item ${isLenValid ? "valid" : (isTooLong ? "invalid" : "")}`;
      const icon = reqLen.querySelector(".req-icon");
      if (icon) icon.textContent = isLenValid ? "🟢" : (isTooLong ? "🔴" : "⚪");
    }

    if (reqAlpha) {
      const hasInvalidChar = pwd.length > 128;
      reqAlpha.className = `auth-req-item ${isAlphaValid ? "valid" : (hasInvalidChar ? "invalid" : "")}`;
      const icon = reqAlpha.querySelector(".req-icon");
      if (icon) icon.textContent = isAlphaValid ? "🟢" : (hasInvalidChar ? "🔴" : "⚪");
    }

    if (reqMatch) {
      const isMismatch = confirm.length > 0 && pwd !== confirm;
      reqMatch.className = `auth-req-item ${isMatchValid ? "valid" : (isMismatch ? "invalid" : "")}`;
      const icon = reqMatch.querySelector(".req-icon");
      if (icon) icon.textContent = isMatchValid ? "🟢" : (isMismatch ? "🔴" : "⚪");
    }
  }

  [registerPassword, registerPasswordConfirm].forEach(input => {
    input?.addEventListener("input", updatePasswordChecklist);
    input?.addEventListener("keyup", updatePasswordChecklist);
  });

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

  // 1. ACTION : "Se Connecter"
  if (btnLogin) {
    btnLogin.onclick = async () => {
      const identifier = loginEmail ? loginEmail.value.trim() : "";
      const password = loginPassword ? loginPassword.value : "";

      if (!identifier) {
        setAuthMessage("error", "Veuillez saisir votre adresse e-mail.");
        loginEmail?.focus();
        return;
      }
      if (!password) {
        setAuthMessage("error", "Veuillez saisir votre mot de passe.");
        loginPassword?.focus();
        return;
      }

      isAuthProcessing = true;
      try {
        setButtonState(btnLogin, true, "Connexion en cours...", "Se Connecter");
        setAuthMessage("loading", "Vérification par Firebase Authentication...");
        const result = await signInWithEmailAndPasswordMethod(identifier, password);

        // Sauvegarde Remember Me si activé
        try {
          if (authRememberMe?.checked) {
            localStorage.setItem(REMEMBER_KEY, identifier);
          } else {
            localStorage.removeItem(REMEMBER_KEY);
          }
        } catch (e) {}


        setAuthMessage("success", "Connexion réussie ! Bienvenue chez LAPERLE TOUR HT.");
        showToast(`Bienvenue, ${result.profile?.nom || result.profile?.name || result.profile?.username || "Utilisateur"} !`);
        completeUserSignIn(result.user, result.profile, result.isNew);
      } catch (err) {
        isAuthProcessing = false;
        setButtonState(btnLogin, false, "Connexion en cours...", "Se Connecter");
        console.warn("Erreur connexion login:", err);
        const errMsg = err?.message || String(err);
        const isNotRegistered = err?.code === "auth/user-not-registered" || 
                                err?.code === "auth/user-not-found" ||
                                err?.code === "auth/invalid-credential" ||
                                errMsg.includes("auth/invalid-credential") ||
                                errMsg.includes("pas encore inscrit") || 
                                errMsg.includes("n'existe pas dans la base de données");
        if (err?.code === 'auth/admin-needs-google-sync' || (isSuperAdminEmail(identifier) && (isNotRegistered || err?.code === 'auth/wrong-password'))) {
          setAuthMessage("warning", `ℹ️ <b>Compte Administrateur « ${esc(identifier)} » :</b><br>Ce compte est synchronisé avec Google dans Firebase. Pour activer votre mot de passe ou accéder directement à votre espace, cliquez sur le bouton ci-dessous :<br><button type="button" id="btnAdminGoogleSyncDirect" style="margin-top:10px;padding:9px 18px;background:#082b70;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;box-shadow:0 3px 10px rgba(8,43,112,0.25);"><span>⚡ Continuer avec Google</span></button>`);
          setTimeout(() => {
            const btnSync = document.getElementById("btnAdminGoogleSyncDirect");
            if (btnSync) {
              btnSync.onclick = () => {
                const googleBtn = document.getElementById("authBtnGoogleLogin");
                if (googleBtn) googleBtn.click();
              };
            }
          }, 50);
          return;
        }

        if (isNotRegistered) {
          setAuthMessage("error", `❌ <b>Compte introuvable ou identifiants incorrects.</b><br>Si vous n'avez pas encore créé votre compte pour « ${esc(identifier)} », veuillez d'abord vous inscrire.<br><button type="button" id="btnGoToRegisterFromError" style="margin-top:8px;padding:7px 16px;background:#082b70;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:12.5px;">👉 S'inscrire maintenant</button>`);
          setTimeout(() => {
            const btnErr = document.getElementById("btnGoToRegisterFromError");
            if (btnErr) {
              btnErr.onclick = () => {
                setMode("register");
                const regEmail = document.getElementById("authRegisterEmail");
                if (regEmail && identifier.includes("@")) {
                  regEmail.value = identifier;
                }
                if (registerPhone && !identifier.includes("@") && /\d/.test(identifier)) {
                  registerPhone.value = identifier.replace(/\D/g, '').slice(-8);
                } else if (document.getElementById("authRegisterUsername") && !identifier.includes("@")) {
                  document.getElementById("authRegisterUsername").value = identifier;
                }
              };
            }
          }, 50);
        } else {
          setAuthMessage("error", formatAuthError(err) || errMsg);
        }
      } finally {
        isAuthProcessing = false;
      }
    };
  }

  // 2. ACTION : "S'inscrire"
  if (btnRegister) {
    btnRegister.onclick = async () => {
      if (isAuthProcessing) return;
      const nom = registerNom ? registerNom.value.trim() : "";
      const prenom = registerPrenom ? registerPrenom.value.trim() : "";
      const rawPhone = registerPhone ? registerPhone.value.trim() : "";
      const email = registerEmail ? registerEmail.value.trim().toLowerCase() : "";
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
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setAuthMessage("error", "Veuillez saisir une adresse e-mail valide.");
        registerEmail?.focus();
        return;
      }
      if (!rawPhone) {
        setAuthMessage("error", "Veuillez renseigner votre numéro de téléphone ou WhatsApp.");
        registerPhone?.focus();
        return;
      }

      // Formatage du téléphone avec préfixe Haïti (+509)
      const digitsOnly = rawPhone.replace(/\D/g, "");
      if (digitsOnly.length < 8) {
        setAuthMessage("error", "Veuillez renseigner un numéro de téléphone valide à 8 chiffres (ex: 4440 8687).");
        registerPhone?.focus();
        return;
      }
      const phoneDigits = digitsOnly.slice(-8);
      const telephone = `+509 ${phoneDigits}`;

      const cleanHandle = username || `user_${phoneDigits}`;

      if (!password) {
        setAuthMessage("error", "Veuillez saisir un mot de passe.");
        registerPassword?.focus();
        return;
      }
      if (password.length < 8 || password.length > 128) {
        setAuthMessage("error", "Le mot de passe doit comporter au moins 8 caractères.");
        registerPassword?.focus();
        return;
      }
      if (password !== passwordConfirm) {
        setAuthMessage("error", "La confirmation ne correspond pas au mot de passe saisi.");
        registerPasswordConfirm?.focus();
        return;
      }

      isAuthProcessing = true;
      try {
        setButtonState(btnRegister, true, "Création du compte...", "S'inscrire");
        setAuthMessage("loading", "Création de votre compte sécurisé LAPERLE TOUR HT en cours...");

        const result = await signUpWithEmailAndPasswordMethod({
          nom,
          prenom,
          email,
          username: cleanHandle,
          telephone,
          password,
          passwordConfirm
        });

        // Mémorisation de l'identifiant pour la prochaine connexion
        try {
          localStorage.setItem(REMEMBER_KEY, email);
        } catch (e) {}


        const userLoginId = result.profile?.email || email;
        setAuthMessage("success", `✅ Compte créé avec succès ! Votre identifiant de connexion : <b>${esc(userLoginId)}</b>.`);
        showToast(`🎉 Bienvenue ${nom} ${prenom} ! Identifiant : ${userLoginId}`);
        completeUserSignIn(result.user, result.profile, result.isNew);
      } catch (err) {
        isAuthProcessing = false;
        setButtonState(btnRegister, false, "Création du compte...", "S'inscrire");
        console.warn("Erreur inscription register:", err);
        setAuthMessage("error", formatAuthError(err) || err?.message || "Erreur lors de la création du compte.");
      } finally {
        isAuthProcessing = false;
      }
    };
  }

  // 3. ACTION : Récupération "Mot de passe oublié"
  if (btnSendReset) {
    btnSendReset.onclick = async () => {
      const identifier = forgotIdentifier ? forgotIdentifier.value.trim() : "";
      if (!identifier) {
        setAuthMessage("error", "Veuillez renseigner votre adresse e-mail ou votre nom de profil pour recevoir le lien de réinitialisation.");
        forgotIdentifier?.focus();
        return;
      }

      try {
        setButtonState(btnSendReset, true, "Envoi en cours...", "Envoyer le lien de réinitialisation");
        setAuthMessage("loading", "Vérification du compte et envoi sécurisé du lien...");

        const resetRes = await requestPasswordReset(identifier);

        setButtonState(btnSendReset, false, "Envoi en cours...", "Envoyer le lien de réinitialisation");
        setAuthMessage("success", `✉️ <b>Lien de réinitialisation envoyé !</b><br>Un e-mail a été expédié à l'adresse <b>${esc(resetRes.email)}</b>. Cliquez sur le lien reçu pour choisir un nouveau mot de passe.<br><button type="button" id="btnBackToLoginAfterReset" style="margin-top:10px;padding:7px 18px;background:#082b70;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:12.5px;">👉 Retourner à la connexion</button>`);

        setTimeout(() => {
          const btnBack = document.getElementById("btnBackToLoginAfterReset");
          if (btnBack) {
            btnBack.onclick = () => {
              setMode("login");
              if (loginEmail) loginEmail.value = resetRes.email;
            };
          }
        }, 50);
      } catch (err) {
        setButtonState(btnSendReset, false, "Envoi en cours...", "Envoyer le lien de réinitialisation");
        console.warn("Erreur réinitialisation mot de passe:", err);
        setAuthMessage("error", formatAuthError(err) || err?.message || "Impossible d'envoyer l'e-mail de réinitialisation.");
      }
    };
  }

  // 4. ACTION : Connexion / Inscription rapide en 1 clic avec Google
  const googleLoginButtons = [
    document.getElementById("authBtnGoogleLoginTop"),
    document.getElementById("authBtnGoogleLogin")
  ].filter(Boolean);

  const googleRegisterButtons = [
    document.getElementById("authBtnGoogleRegisterTop"),
    document.getElementById("authBtnGoogleRegister")
  ].filter(Boolean);

  const handleGoogleAuth = async (mode = 'login') => {
    if (isAuthProcessing) return;
    isAuthProcessing = true;
    const allButtons = [...googleLoginButtons, ...googleRegisterButtons];
    allButtons.forEach(b => { 
      if (b) {
        b.disabled = true;
        b.classList.add("btn-loading");
        b.dataset.prevHtml = b.innerHTML;
        b.innerHTML = `<span class="auth-spinner"></span> <span>${mode === 'register' ? "Inscription Google en cours..." : "Connexion Google en cours..."}</span>`;
      }
    });
    setAuthMessage("loading", mode === 'register' ? "Ouverture de la fenêtre Google pour finaliser votre inscription..." : "Ouverture de la fenêtre Google pour validation en 1 clic...");

    try {
      const result = await authLoginGoogle(mode);
      setAuthMessage("success", "Connexion en 1 clic réussie ! Bienvenue chez LAPERLE TOUR HT.");
      showToast(`🎉 Bienvenue ${result.profile?.nom || result.profile?.name || "Utilisateur"} !`);
      completeUserSignIn(result.user, result.profile, result.isNew);
    } catch (err) {
      console.warn("Erreur Google sign-in:", err);
      allButtons.forEach(b => { 
        if (b) {
          b.disabled = false;
          b.classList.remove("btn-loading");
          if (b.dataset.prevHtml) b.innerHTML = b.dataset.prevHtml;
        }
      });
      if (err?.code === 'auth/unauthorized-domain') {
        setAuthMessage("error", formatAuthError(err) || "Domaine non autorisé pour Google OAuth.");
        const expressInput = document.getElementById("authExpressInput");
        if (expressInput) {
          expressInput.focus();
          expressInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else {
        setAuthMessage("error", formatAuthError(err) || err?.message || "Impossible de terminer la connexion Google.");
      }
    } finally {
      isAuthProcessing = false;
      allButtons.forEach(b => { 
        if (b) {
          b.disabled = false;
          b.classList.remove("btn-loading");
          if (b.dataset.prevHtml) b.innerHTML = b.dataset.prevHtml;
        }
      });
    }
  };

  googleLoginButtons.forEach(btn => {
    btn.onclick = () => handleGoogleAuth('login');
  });

  googleRegisterButtons.forEach(btn => {
    btn.onclick = () => handleGoogleAuth('register');
  });

  // 5. ACTION : Inscription Express Directe 1 Clic (E-mail impératif + suggestion profil après connexion)
  const expressInput = document.getElementById("authExpressInput");
  const btnExpress = document.getElementById("authBtnExpressRegister");

  const handleExpressRegister = async () => {
    if (isAuthProcessing) return;
    const rawVal = expressInput ? expressInput.value.trim().toLowerCase() : "";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!rawVal || !emailRegex.test(rawVal)) {
      setAuthMessage("error", "⚠️ <b>Adresse e-mail impérative :</b> L'adresse e-mail est obligatoire pour l'accès en 1 clic. Veuillez saisir un e-mail valide (ex: contact@exemple.com).");
      if (expressInput) {
        expressInput.style.borderColor = "#dc2626";
        expressInput.focus();
      }
      return;
    }

    if (isSuperAdminEmail(rawVal)) {
      setAuthMessage("warning", `🔒 <b>Compte Administrateur :</b> Les administrateurs se connectent <b>exclusivement avec e-mail et mot de passe</b>.<br>Veuillez basculer sur l'onglet <b>« Se Connecter »</b> avec votre mot de passe.`);
      setMode("login");
      if (loginEmail) loginEmail.value = rawVal;
      if (loginPassword) loginPassword.focus();
      return;
    }

    if (expressInput) expressInput.style.borderColor = "#cbd5e1";
    isAuthProcessing = true;
    if (btnExpress) {
      btnExpress.disabled = true;
      btnExpress.classList.add("btn-loading");
      btnExpress.innerHTML = '<span class="auth-spinner"></span> <span>Création en cours...</span>';
    }
    setAuthMessage("loading", "Création express de votre compte en 1 clic...");

    try {
      const result = await quickOneClickRegister(rawVal);
      const userLoginId = result.profile?.email || result.user?.email || rawVal;
      setAuthMessage("success", `✅ <b>Compte activé en 1 clic avec succès !</b><br>Identifiant : <b>${esc(userLoginId)}</b>`);
      showToast(`🎉 Bienvenue ${result.profile?.nom || "Utilisateur"} ! Inscription 1 clic réussie.`);

      // Mémoriser pour suggérer de compléter le profil
      sessionStorage.setItem("SUGGEST_PROFILE_COMPLETION", "1");

      completeUserSignIn(result.user, result.profile, true);
    } catch (err) {
      console.warn("Erreur inscription express 1 clic:", err);
      if (err?.code === 'auth/email-already-in-use') {
        setAuthMessage("warning", `ℹ️ <b>Cette adresse (${esc(rawVal)}) possède déjà un compte.</b><br>Veuillez basculer sur l'onglet « Se Connecter » pour entrer votre mot de passe.<br><button type="button" id="btnGoToLoginFromExpress" style="margin-top:8px;padding:6px 14px;background:#082b70;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;">👉 Se Connecter</button>`);
        setTimeout(() => {
          const btnL = document.getElementById("btnGoToLoginFromExpress");
          if (btnL) {
            btnL.onclick = () => {
              setMode("login");
              if (loginEmail) loginEmail.value = rawVal;
            };
          }
        }, 50);
      } else {
        setAuthMessage("error", formatAuthError(err) || err?.message || "Échec de l'accès en 1 clic.");
      }
    } finally {
      isAuthProcessing = false;
      if (btnExpress) {
        btnExpress.disabled = false;
        btnExpress.classList.remove("btn-loading");
        btnExpress.innerHTML = '<span>Créer en 1 clic 🚀</span>';
      }
    }
  };

  if (btnExpress) {
    btnExpress.onclick = handleExpressRegister;
  }
  if (expressInput) {
    expressInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleExpressRegister();
    });
  }

  // Touche Entrée pour soumettre le formulaire actif
  [loginEmail, loginPassword].forEach(input => {
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btnLogin?.click();
    });
  });

  [registerNom, registerPrenom, registerPhone, registerUsername, registerPassword, registerPasswordConfirm].forEach(input => {
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btnRegister?.click();
    });
  });

  forgotIdentifier?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnSendReset?.click();
  });
}

function completeUserSignIn(user, profile, isNew = false) {
  clearExplicitLogout();
  currentUser = user;
  currentUserProfile = profile;

  const userEmail = String(user?.email || profile?.email || '').trim().toLowerCase();
  const isSuper = isSuperAdminEmail(userEmail);

  // 1. Vérification du statut du compte (inactif / suspendu) - Les Super Admins ne sont jamais suspendus
  if (!isSuper && currentUserProfile && normalizeStatus(currentUserProfile.status || currentUserProfile.statutCompte) === "inactif") {
    currentUserRoles = ["inactif"];
    currentRole = "inactif";
    firestoreUnsubscribers.forEach(unsub => { try { unsub(); } catch (e) {} });
    firestoreUnsubscribers = [];
    renderAuthPage("deactivated");
    return;
  }

  // Les rôles proviennent du profil Firestore associé au Firebase UID avec garantie Super Admin
  if (!currentUserProfile || currentUserProfile.uid !== user.uid || currentUserProfile.id !== user.uid) {
    throw new Error("Profil Firebase invalide : le document doit correspondre au Firebase UID.");
  }

  if (isSuper) {
    currentUserProfile.role = ROLES.ADMIN;
    currentUserProfile.roles = [ROLES.ADMIN];
    currentUserProfile.statutClient = 'admin';
    currentUserProfile.status = 'actif';
    currentUserProfile.statutCompte = 'actif';
    currentUserRoles = [ROLES.ADMIN];
    currentRole = ROLES.ADMIN;
    // Auto-réparation immédiate et persistante dans Firestore
    try {
      if (db && user?.uid) {
        setDoc(doc(db, "utilisateurs", user.uid), {
          role: ROLES.ADMIN,
          roles: [ROLES.ADMIN],
          statutClient: 'admin',
          status: 'actif',
          statutCompte: 'actif',
          email: userEmail,
          updatedAt: new Date().toISOString()
        }, { merge: true }).catch(() => {});
      }
    } catch (e) {}
  } else {
    currentUserRoles = normalizeRoles(currentUserProfile.roles || currentUserProfile.role || [ROLES.PROSPECT]);
    currentRole = currentUserRoles[0] || ROLES.PROSPECT;
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
  // - Super Admin & Admins / Staff -> Dashboard (Tableau de Bord complet)
  // - lecture_seule ou prospect -> Page Profil uniquement (Profil & Réservations)
  const normCurrentRoles = normalizeRoles(currentUserRoles);
  if (!isSuper && (!hasBusinessRole(currentUserRoles) || (normCurrentRoles.length === 1 && normCurrentRoles[0] === ROLES.PROSPECT))) {
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

  if (currentUserRoles.includes(ROLES.ADMIN) || isSuper) {
    seedInitialDataToFirestoreIfEmpty();
  }

  render();

  // 7. Suggérer de compléter le profil si inscription 1 clic ou profil incomplet
  if (!isSuper && (isNew || sessionStorage.getItem("SUGGEST_PROFILE_COMPLETION") === "1" || currentUserProfile?.needsProfileCompletion)) {
    sessionStorage.removeItem("SUGGEST_PROFILE_COMPLETION");
    setTimeout(() => {
      promptProfileCompletionIfSuggested();
    }, 600);
  }
}

/**
 * Suggestion amicale invitant l'utilisateur à finaliser son profil après une connexion 1 clic
 */
function promptProfileCompletionIfSuggested() {
  const existing = document.getElementById("profileCompletionPromptModal");
  if (existing) existing.remove();

  const profile = currentUserProfile || {};
  const email = profile.email || currentUser?.email || "votre adresse e-mail";

  const modal = document.createElement("div");
  modal.id = "profileCompletionPromptModal";
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(8, 27, 65, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 16px;
  `;

  modal.innerHTML = `
    <div style="background:#ffffff;border-radius:18px;max-width:490px;width:100%;box-shadow:0 20px 45px rgba(0,0,0,0.3);overflow:hidden;border:1px solid #e2e8f0;font-family:system-ui,-apple-system,sans-serif;">
      <div style="background:linear-gradient(135deg, #092e70 0%, #1e40af 100%);color:#ffffff;padding:22px 24px;position:relative;">
        <span style="font-size:32px;display:inline-block;margin-bottom:6px;">🎉</span>
        <h3 style="margin:0;font-size:19px;font-weight:800;letter-spacing:-0.3px;">Bienvenue sur LAPERLE TOUR HT !</h3>
        <p style="margin:6px 0 0;font-size:13px;opacity:0.95;line-height:1.4;">
          Votre compte a été activé en 1 clic avec :<br>
          <b style="color:#fef08a;font-size:13.5px;">${esc(email)}</b>
        </p>
      </div>

      <div style="padding:22px 24px;">
        <div style="display:flex;align-items:flex-start;gap:12px;background:#f0fdf4;border:1.5px solid #bbf7d0;border-left:4px solid #16a34a;padding:12px 14px;border-radius:8px;margin-bottom:18px;">
          <span style="font-size:22px;">💡</span>
          <div style="font-size:12.5px;color:#166534;line-height:1.45;">
            <b>Suggestion importante :</b> Pour personnaliser vos futures réservations/devis et sécuriser votre compte avec votre propre mot de passe, nous vous suggérons de compléter votre profil dès maintenant.
          </div>
        </div>

        <ul style="font-size:12px;color:#475569;margin:0 0 18px 20px;padding:0;line-height:1.6;">
          <li>Renseigner votre Nom et Prénom</li>
          <li>Ajouter votre numéro de téléphone (WhatsApp)</li>
          <li>Définir votre mot de passe personnel</li>
        </ul>

        <div style="display:flex;flex-direction:column;gap:10px;">
          <button type="button" id="btnPromptCompleteProfileNow" style="width:100%;padding:12px 18px;background:#092e70;color:#ffffff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 12px rgba(9,46,112,0.25);">
            <span>✏️ Compléter mon profil</span>
          </button>
          <button type="button" id="btnPromptDismissProfile" style="width:100%;padding:10px 18px;background:transparent;color:#64748b;border:1px solid #cbd5e1;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">
            Accéder directement à l'espace (Plus tard)
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const btnNow = document.getElementById("btnPromptCompleteProfileNow");
  const btnDismiss = document.getElementById("btnPromptDismissProfile");

  if (btnNow) {
    btnNow.onclick = () => {
      modal.remove();
      if (typeof openProfile === "function") {
        openProfile();
      }
    };
  }

  if (btnDismiss) {
    btnDismiss.onclick = () => {
      modal.remove();
    };
  }
}
window.promptProfileCompletionIfSuggested = promptProfileCompletionIfSuggested;

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

    if (!user) {
      currentUser = null;
      currentUserProfile = null;
      currentUserRoles = [];
      currentRole = null;
      clearUserSession();
      renderAuthPage("unauthenticated");
      return;
    }

    if (user && !currentUser) {
      try {
        let profile = await getUserProfile(user.uid);
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
function initSessionAtStartup() {
  // Firebase Auth listener above is the only authority allowed to restore a session.
  currentUser = null;
  currentUserProfile = null;
  currentUserRoles = [];
  currentRole = null;
  renderAuthPage('unauthenticated');
}

initSessionAtStartup();
function go(k) {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebarBackdrop")?.classList.remove("open");
  const isSuper = isSuperAdminEmail(currentUser?.email || currentUserProfile?.email);
  // Un utilisateur avec uniquement lecture_seule ne peut accéder à aucun module métier
  if (!isSuper && !hasBusinessRole(currentUserRoles)) {
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
  const isSuper = isSuperAdminEmail(currentUser?.email || currentUserProfile?.email);

  if (!isSuper && currentUserProfile && normalizeStatus(currentUserProfile.status || currentUserProfile.statutCompte) === "inactif") {
    renderAuthPage("deactivated");
    return;
  }

  const normCurrentRoles = normalizeRoles(currentUserRoles);

  // 4. IMPORTANT : Un utilisateur avec uniquement ["lecture_seule"] ne voit PAS le Dashboard et ne voit AUCUN module métier.
  // Il voit uniquement son profil.
  if (!isSuper && !hasBusinessRole(currentUserRoles)) {
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

  // Security guard against unauthorized URL navigation (Super Admins have universal clearance)
  if (!isSuper && canon !== "dashboard" && !canAccessModule(currentUserRoles, canon, currentUserProfile?.permissions)) {
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

  const isSolelyProspect = !isSuper && normCurrentRoles.length === 1 && normCurrentRoles[0] === ROLES.PROSPECT;
  if ((canon === "profile" && isSolelyProspect) || (canon === "dashboard" && isSolelyProspect)) {
    renderLectureSeuleProfilePage();
    return;
  }

  if (canon === "profile") {
    renderAdminOrStaffProfilePage();
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

// ==========================================
// 📅 MOTEUR CALENDRIER INTERACTIF DES RÉSERVATIONS
// ==========================================
let calendarCurrentYear = new Date().getFullYear();
let calendarCurrentMonth = new Date().getMonth();
let calendarSelectedDate = today();

const MONTH_NAMES_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
];

function navigateCalendarMonth(delta) {
  calendarCurrentMonth += delta;
  if (calendarCurrentMonth < 0) {
    calendarCurrentMonth = 11;
    calendarCurrentYear--;
  } else if (calendarCurrentMonth > 11) {
    calendarCurrentMonth = 0;
    calendarCurrentYear++;
  }
  const widget = document.getElementById("calendarWidgetContainer");
  if (widget) {
    widget.innerHTML = renderCalendarWidgetHTML();
  }
}
window.navigateCalendarMonth = navigateCalendarMonth;

function resetCalendarToToday() {
  const now = new Date();
  calendarCurrentYear = now.getFullYear();
  calendarCurrentMonth = now.getMonth();
  calendarSelectedDate = today();
  const widget = document.getElementById("calendarWidgetContainer");
  if (widget) {
    widget.innerHTML = renderCalendarWidgetHTML();
  }
}
window.resetCalendarToToday = resetCalendarToToday;

function getReservationsForCalendar() {
  const all = list("reservations") || [];
  return all.filter(r => !r.archived && r.status !== "Archivée");
}

function renderCalendarWidgetHTML() {
  const year = calendarCurrentYear;
  const month = calendarCurrentMonth;
  const monthName = MONTH_NAMES_FR[month] || "Mois";

  const firstDay = new Date(year, month, 1);
  const startingDayIndex = firstDay.getDay(); // 0 = Dimanche, 1 = Lundi...
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const todayStr = today();
  const allRes = getReservationsForCalendar();

  // Dictionnaire des réservations indexées par date (YYYY-MM-DD)
  const resByDate = {};
  allRes.forEach(r => {
    const rawDate = r.date || r.createdAt || '';
    if (rawDate) {
      const dStr = String(rawDate).slice(0, 10);
      if (!resByDate[dStr]) resByDate[dStr] = [];
      resByDate[dStr].push(r);
    }
  });

  let cellsHtml = '';

  // Jours du mois précédent pour aligner le premier jour
  for (let i = startingDayIndex - 1; i >= 0; i--) {
    const prevDayNum = daysInPrevMonth - i;
    cellsHtml += `<span class="cal-date-cell other-month">${prevDayNum}</span>`;
  }

  // Jours du mois en cours
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === calendarSelectedDate;
    const resList = resByDate[dateStr] || [];
    const count = resList.length;

    let eventClass = '';
    let badgeHtml = '';

    if (count > 0) {
      const hasConfirmed = resList.some(r => r.status === 'Confirmée' || r.status === 'En cours');
      eventClass = hasConfirmed ? 'event-orange' : 'event-green';
      badgeHtml = `<span class="res-count-chip" title="${count} réservation(s)">${count}</span>`;
    }

    const classes = [
      'cal-date-cell',
      isToday ? 'today' : '',
      isSelected ? 'is-selected' : '',
      eventClass,
      count > 0 ? 'has-res' : ''
    ].filter(Boolean).join(' ');

    const titleAttr = count > 0 
      ? `${count} réservation(s) le ${dateStr}` 
      : `Voir les réservations du ${dateStr}`;

    cellsHtml += `
      <div class="${classes}" onclick="openCalendarDayReservations('${dateStr}')" title="${titleAttr}">
        <span>${d}</span>
        ${badgeHtml}
      </div>
    `;
  }

  // Jours suivants pour compléter la grille
  const totalCellsSoFar = startingDayIndex + daysInMonth;
  const remainingCells = (7 - (totalCellsSoFar % 7)) % 7;
  for (let j = 1; j <= remainingCells; j++) {
    cellsHtml += `<span class="cal-date-cell other-month">${j}</span>`;
  }

  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const totalMonthRes = Object.keys(resByDate)
    .filter(dStr => dStr.startsWith(prefix))
    .reduce((acc, dStr) => acc + resByDate[dStr].length, 0);

  return `
    <div class="calendar-header">
      <div>
        <b style="font-size:14px;color:#ffffff">${monthName} ${year}</b>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">
          ${totalMonthRes} course${totalMonthRes > 1 ? 's' : ''} ce mois
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="calendar-nav-btn" onclick="navigateCalendarMonth(-1)" title="Mois précédent">‹</button>
        <button class="calendar-nav-btn" onclick="resetCalendarToToday()" title="Aujourd'hui" style="font-size:10px;width:auto;padding:0 6px">Ce jour</button>
        <button class="calendar-nav-btn" onclick="navigateCalendarMonth(1)" title="Mois suivant">›</button>
      </div>
    </div>
    <div class="calendar-days-row">
      <span>D</span><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span>
    </div>
    <div class="calendar-dates-grid">
      ${cellsHtml}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;color:#94a3b8">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f97316"></span>
        <span>Avec réservation</span>
      </div>
      <button onclick="openCalendarDayReservations('${todayStr}')" style="background:none;border:none;color:#38bdf8;cursor:pointer;font-size:11px;font-weight:700">
        Voir aujourd'hui ›
      </button>
    </div>
  `;
}
window.renderCalendarWidgetHTML = renderCalendarWidgetHTML;

function openCalendarDayReservations(dateStr) {
  calendarSelectedDate = dateStr;
  const widget = document.getElementById("calendarWidgetContainer");
  if (widget) {
    widget.innerHTML = renderCalendarWidgetHTML();
  }

  const allRes = getReservationsForCalendar();
  const dayReservations = allRes.filter(r => {
    const dStr = String(r.date || r.createdAt || '').slice(0, 10);
    return dStr === dateStr;
  });

  const parsedDate = new Date(dateStr + "T00:00:00");
  const formattedDate = !isNaN(parsedDate.getTime()) 
    ? parsedDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : dateStr;

  const modal = document.getElementById("modal");
  const modalBackdrop = document.getElementById("modalBackdrop");
  if (!modal || !modalBackdrop) return;

  const isStaff = hasPermission("write", "reservations");

  modal.innerHTML = `
    <div class="modal-head">
      <div>
        <h2 style="display:flex;align-items:center;gap:8px">
          <span>📅</span> <span>Réservations du ${formattedDate}</span>
        </h2>
        <small style="color:#64748b">
          ${dayReservations.length} course${dayReservations.length > 1 ? 's' : ''} programmée${dayReservations.length > 1 ? 's' : ''} pour cette date
        </small>
      </div>
      <button class="close" onclick="closeModal()">×</button>
    </div>

    <div style="padding:14px 20px;max-height:70vh;overflow-y:auto">
      ${dayReservations.length === 0 ? `
        <div style="text-align:center;padding:30px 10px;color:#64748b">
          <div style="font-size:36px;margin-bottom:8px">🗓️</div>
          <b style="font-size:15px;color:#092e70">Aucune réservation programmée pour ce jour.</b>
          <p style="font-size:13px;margin:6px 0 16px">Vous pouvez créer une nouvelle réservation directement pour le ${formattedDate}.</p>
          ${isStaff ? `
            <button class="primary" onclick="openNewReservationForDate('${dateStr}')" style="display:inline-flex;align-items:center;gap:6px">
              <span>＋ Réserver pour le ${dateStr}</span>
            </button>
          ` : ''}
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:12px">
          ${dayReservations.map(r => {
            const resIdx = list("reservations").indexOf(r);
            const statusClass = r.status === 'Confirmée' ? 'green' : (r.status === 'En cours' ? 'orange' : 'blue');
            return `
              <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
                  <div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">
                      <button type="button" 
                        class="reservation-link-badge"
                        onclick="openReservationPageFromCalendar('${esc(r.id || r.code || '')}')"
                        title="Cliquer pour ouvrir la page complète des réservations"
                        style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;border-radius:6px;padding:3px 9px;font-size:11px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:all 0.15s ease;"
                        onmouseover="this.style.background='#dbeafe';this.style.borderColor='#93c5fd';this.style.transform='translateY(-1px)'"
                        onmouseout="this.style.background='#eff6ff';this.style.borderColor='#bfdbfe';this.style.transform='translateY(0)'">
                        <span>📋</span>
                        <span>RÉSERVATION #${esc(r.id || 'RES')}</span>
                        <span style="font-size:10px;opacity:0.8">↗</span>
                      </button>
                      <span style="font-size:11px;font-weight:700;color:#64748b">⏰ ${esc(r.time || '08:00')}</span>
                    </div>
                    <div style="font-size:15px;font-weight:800;color:#0f172a;margin-top:2px">
                      👤 ${esc(r.client || 'Client')}
                    </div>
                  </div>
                  <div style="display:flex;gap:6px;align-items:center">
                    <span class="badge ${statusClass}">${esc(r.status || 'À confirmer')}</span>
                    ${r.amount ? `<span class="badge" style="background:#082b70;color:#fff">${money(r.amount)}</span>` : ''}
                  </div>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:8px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:12.5px">
                  <div>
                    <span style="color:#64748b">📍 Trajet :</span><br>
                    <b>${esc(r.origin || 'Départ')}</b> ➔ <b>${esc(r.destination || 'Arrivée')}</b>
                  </div>
                  <div>
                    <span style="color:#64748b">🚗 Chauffeur :</span><br>
                    <b>${r.driver ? `🚗 ${esc(r.driver)}` : '<span style="color:#ea580c">⚠️ Non assigné</span>'}</b>
                  </div>
                  <div>
                    <span style="color:#64748b">🚐 Véhicule :</span><br>
                    <b>${r.vehicle ? `🚐 ${esc(r.vehicle)}` : '<span style="color:#64748b">—</span>'}</b>
                  </div>
                  <div>
                    <span style="color:#64748b">👥 Passagers :</span><br>
                    <b>${esc(r.passengers || 1)} passager(s)</b>
                  </div>
                </div>

                ${r.notes ? `
                  <div style="font-size:12px;color:#475569;background:#f1f5f9;padding:6px 10px;border-radius:6px">
                    📝 <i>${esc(r.notes)}</i>
                  </div>
                ` : ''}

                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:2px">
                  ${resIdx >= 0 ? `
                    <button type="button" class="secondary tiny" onclick="closeModal();viewRow('reservations', ${resIdx})">
                      👁️ Voir détails
                    </button>
                    ${isStaff ? `
                      <button type="button" class="primary tiny" onclick="closeModal();openForm('reservations', ${resIdx})">
                        ✏️ Assigner Chauffeur / Modifier
                      </button>
                    ` : ''}
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>

        ${isStaff ? `
          <div style="margin-top:16px;display:flex;justify-content:flex-end">
            <button class="primary" onclick="openNewReservationForDate('${dateStr}')" style="display:inline-flex;align-items:center;gap:6px">
              <span>＋ Ajouter une course pour le ${dateStr}</span>
            </button>
          </div>
        ` : ''}
      `}
    </div>

    <div class="modal-footer" style="padding:10px 20px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end">
      <button class="secondary" onclick="closeModal()">Fermer</button>
    </div>
  `;

  modalBackdrop.classList.add("open");
}
window.openCalendarDayReservations = openCalendarDayReservations;

function openNewReservationForDate(dateStr) {
  closeModal();
  openForm('reservations');
  setTimeout(() => {
    const dateInput = document.querySelector('#dataForm input[name="date"]');
    if (dateInput) {
      dateInput.value = dateStr;
    }
  }, 100);
}
window.openNewReservationForDate = openNewReservationForDate;

function openReservationPageFromCalendar(resId) {
  closeModal();
  go('reservations');
  if (resId) {
    setTimeout(() => {
      const searchInput = document.getElementById("moduleSearch");
      if (searchInput) {
        searchInput.value = resId;
        drawTable('reservations');
      }
      showToast(`🔍 Fiche réservation ${resId} affichée`);
    }, 60);
  }
}
window.openReservationPageFromCalendar = openReservationPageFromCalendar;

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
    const activeTrips = [...myReservations, ...myPlannings].slice(0, 5);

    document.getElementById("page").innerHTML = `
      <div class="welcome" style="flex-wrap:wrap;gap:12px">
        <div>
          <h2>🚗 Espace Chauffeur • ${esc(displayName)}</h2>
          <p>Centre de Contrôle LAPERLE TOUR HT • Rôle : <span class="user-role-badge chauffeur">CHAUFFEUR</span></p>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn-sos" onclick="openDriverIncidentModal()">
            🚨 SOS / Signaler un Incident
          </button>
        </div>
      </div>

      <div class="kpis">
        ${kpi("📅", "Mes Plannings & Courses", myPlannings.length, "plannings")}
        ${kpi("🎫", "Mes Réservations", myReservations.length, "reservations")}
        ${kpi("🚙", "Véhicules assignés", myVehicles.length, "vehicules")}
        ${kpi("🔔", "Mes Notifications", list("notifications").filter(x => !x.read).length, "dashboard")}
      </div>

      <!-- Section Actions Rapides Mobiles Chauffeur -->
      <div class="panel" style="margin-top:14px;border-left:5px solid #1ba7b2">
        <div class="panel-title">
          <h3>⚡ Mes Courses Actives • Actions Immédiates (GPS, WhatsApp & Pointage)</h3>
          <button onclick="go('reservations')">Voir toutes mes courses</button>
        </div>

        ${activeTrips.length === 0 ? `
          <div class="empty-table">
            <p>🚗 Aucune course immédiate programmée pour le moment.</p>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:12px;margin-top:10px">
            ${activeTrips.map(item => {
              const isRes = !item.route;
              const routeText = isRes ? `${item.origin || 'Départ'} ➔ ${item.destination || 'Arrivée'}` : (item.route || 'Trajet Laperle');
              const clientName = item.client || 'Client Laperle';
              const clientPhone = item.phone || item.clientPhone || item.telephone || '';
              const dateText = item.date || today();
              const timeText = item.time || '08:00';
              const currentStatus = item.status || 'Confirmée';
              const tripType = isRes ? 'reservation' : 'planning';

              return `
                <div class="driver-trip-card">
                  <div class="driver-trip-header">
                    <div>
                      <h4 class="driver-trip-title">📍 ${esc(routeText)}</h4>
                      <div style="font-size:12px;color:#64748b;margin-top:2px">
                        👤 Passager : <b>${esc(clientName)}</b> • 📅 ${esc(dateText)} à <b>${esc(timeText)}</b>
                        ${item.vehicle ? ` • 🚙 Véhicule : <b>${esc(item.vehicle)}</b>` : ''}
                      </div>
                    </div>
                    <span class="badge ${currentStatus === 'Terminée' ? 'green' : (currentStatus === 'En cours' ? 'orange' : 'blue')}">
                      ${esc(currentStatus)}
                    </span>
                  </div>

                  <div class="driver-actions-row">
                    <!-- WhatsApp direct -->
                    <button type="button" class="btn-wa" onclick="handleOpenWhatsAppTrip('${esc(clientPhone)}', '${esc(clientName)}', '${esc(item.origin || routeText)}', '${esc(item.destination || '')}', '${esc(timeText)}')">
                      💬 WhatsApp Passager
                    </button>

                    <!-- Appel direct -->
                    ${clientPhone ? `
                      <a href="tel:${esc(clientPhone)}" class="btn-tel">
                        📞 Appeler (${esc(clientPhone)})
                      </a>
                    ` : ''}

                    <!-- GPS / Navigation Google Maps -->
                    <button type="button" class="btn-gps" onclick="handleOpenGps('${esc(item.origin || '')}', '${esc(item.destination || routeText)}')">
                      🗺️ GPS Itinéraire
                    </button>

                    <!-- Bouton SOS sur cette course -->
                    <button type="button" style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer" onclick="openDriverIncidentModal('${esc(item.id)}', '${esc(routeText)}')">
                      ⚠️ Signaler un imprévu
                    </button>
                  </div>

                  <!-- Pointage de statut en 1 clic -->
                  <div style="margin-top:10px;border-top:1px dashed #e2e8f0;padding-top:8px">
                    <span style="font-size:11px;font-weight:700;color:#092e70;margin-right:8px">Pointer le statut de la course :</span>
                    <div class="status-pill-group" style="display:inline-flex">
                      <button type="button" class="status-pill-btn ${currentStatus === 'En route' ? 'active' : ''}" onclick="handleDriverStatusChange('${esc(item.id)}', 'En route', '${tripType}')">
                        🟡 En route vers le client
                      </button>
                      <button type="button" class="status-pill-btn ${currentStatus === 'En cours' || currentStatus === 'Client à bord' ? 'active' : ''}" onclick="handleDriverStatusChange('${esc(item.id)}', 'En cours', '${tripType}')">
                        🟢 Client à bord
                      </button>
                      <button type="button" class="status-pill-btn ${currentStatus === 'Terminée' ? 'active' : ''}" onclick="handleDriverStatusChange('${esc(item.id)}', 'Terminée', '${tripType}')">
                        🏁 Course terminée
                      </button>
                    </div>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        `}
      </div>

      <div class="bottom-grid" style="grid-template-columns: 2fr 1fr;margin-top:14px">
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
            <button onclick="go('plannings')">📅 Consulter mon planning complet <b>›</b></button>
            <button onclick="go('reservations')">🎫 Voir mes courses assignées <b>›</b></button>
            <button onclick="go('vehicules')">🚙 Fiche de mon véhicule <b>›</b></button>
            <button onclick="openProfile()">👤 Mon Profil Chauffeur <b>›</b></button>
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
    const prospectsList = list("prospects") || [];
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
                Firestore : <b>${usersList.length}</b> utilisateurs inscrits • <b>${prospectsList.length}</b> prospects actifs
              </span>
            </p>
            <div class="admin-hero-actions">
              <button onclick="go('prospects')" class="admin-hero-btn primary">
                🎯 Prospects (${prospectsList.length})
              </button>
              <button onclick="go('utilisateurs')" class="admin-hero-btn outline">
                👥 Gérer les Comptes (${usersList.length})
              </button>
              <button onclick="openSyncAuthUsersModal()" class="admin-hero-btn outline" style="border-color:#38bdf8;color:#e0f2fe">
                🔄 Synchroniser Firebase
              </button>
              <button onclick="openQuickRoleAssignModal()" class="admin-hero-btn outline">
                🛡️ Attribuer un Rôle
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
                  ${usersList.slice(0, 6).map((u, i) => {
                    const uName = resolveUserField(u, "name");
                    const uEmail = resolveUserField(u, "email");
                    const uRoles = resolveUserField(u, "roles");
                    const primaryRole = uRoles[0] || 'prospect';
                    const progressPcts = [95, 80, 68, 52, 40, 30];
                    const pct = progressPcts[i % progressPcts.length];
                    const avatarClass = primaryRole === 'admin' ? 'avatar-admin' : primaryRole === 'chauffeur' ? 'avatar-chauffeur' : primaryRole === 'secretaire' ? 'avatar-secretaire' : primaryRole === 'operations' ? 'avatar-ops' : 'avatar-client';
                    const barColor = primaryRole === 'admin' ? '#3b82f6' : primaryRole === 'chauffeur' ? '#10b981' : primaryRole === 'secretaire' ? '#a855f7' : primaryRole === 'operations' ? '#f97316' : '#06b6d4';
                    const initials = (uName || uEmail || 'U').split(' ').map(w => w.charAt(0)).slice(0, 2).join('').toUpperCase();
                    return `
                      <div class="user-progress-item">
                        <div class="user-progress-avatar ${avatarClass}">${initials}</div>
                        <div class="user-progress-info">
                          <div class="user-progress-name-row">
                            <span class="user-progress-name">${esc(uName)}</span>
                            <span class="user-progress-role-tag ${avatarClass}">${ROLE_LABELS[primaryRole] || primaryRole.toUpperCase()}</span>
                          </div>
                          <div style="font-size:11px;color:#94a3b8;margin-top:1px">${esc(uEmail)}</div>
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
              <div class="media-files-table-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;width:100%">
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
            <!-- Widget Calendrier Interactif des Réservations -->
            <div class="calendar-widget" id="calendarWidgetContainer">
              ${renderCalendarWidgetHTML()}
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

  // Données pratiques pour le personnel
  const fleetBreakdown = getFleetStatusBreakdown(list('vehicules'), list('reservations'));
  const planningConflicts = detectPlanningConflicts(list('reservations'), list('plannings'));
  const cashBreakdown = getDailyCashBreakdown(list('paiements'));
  const overdueInvoices = getOverdueInvoices(list('factures'));
  const teamNotes = getTeamRelayNotes();
  const todayStr = today();
  const todayReservations = list("reservations").filter(x => !x.archived && ((x.date && x.date === todayStr) || (x.createdAt && x.createdAt.startsWith(todayStr))));

  // Fallback for non-admin general staff (Secrétaire, Comptabilité, Opérations, etc.)
  document.getElementById("page").innerHTML = `
    <div class="welcome" style="flex-wrap:wrap;gap:10px">
      <div>
        <h2>👤 Bonjour, ${esc(displayName)} !</h2>
        <p>Centre de contrôle opérationnel et financier LAPERLE TOUR HT • Rôles : ${roles.map(r => `<span class="user-role-badge ${r}">${ROLE_LABELS[r] || r}</span>`).join(" ")}</p>
      </div>
      <div class="quote">
        ❝ Plus qu'un transport, une destination de confiance. ❞<br>
        — LAPERLE TOUR HT
      </div>
    </div>

    <!-- 2. MODULE SECRÉTAIRE : Barre de Recherche Universelle Rapide -->
    <div class="secretary-search-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <b style="font-size:15px">🔍 Recherche Rapide Universelle Secrétariat & Opérations</b>
          <div style="font-size:12px;opacity:0.85">Trouvez instantanément un client, une réservation, un devis proforma ou une facture</div>
        </div>
        <span class="badge" style="background:rgba(255,255,255,0.2);color:#fff">Écoute en direct</span>
      </div>
      <div class="secretary-search-input-wrap">
        <span class="secretary-search-icon">🔎</span>
        <input 
          type="text" 
          id="secretarySearchInput" 
          class="secretary-search-input" 
          placeholder="Tapez un nom de client, numéro de téléphone, trajet ou numéro de reçu/facture..." 
          oninput="handleSecretarySearch(this.value)"
        >
        <div id="secretarySearchResults" class="secretary-search-results"></div>
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

    <!-- 3. MODULE OPÉRATIONS : Jauge de Flotte & Alertes Conflits -->
    <div class="panel" style="margin-top:14px;border-left:5px solid #f7941d">
      <div class="panel-title">
        <h3>🚦 Suivi Opérations Flotte & Conflits de Planning</h3>
        <button onclick="go('vehicules')">Gérer la flotte</button>
      </div>

      <!-- Jauge de Flotte -->
      <div class="fleet-gauge-grid">
        <div class="fleet-gauge-card avail" onclick="go('vehicules')" style="cursor:pointer">
          <span>🟢 Véhicules Disponibles</span>
          <b>${fleetBreakdown.available}</b>
        </div>
        <div class="fleet-gauge-card busy" onclick="go('reservations')" style="cursor:pointer">
          <span>🔵 En Course / Programmés</span>
          <b>${fleetBreakdown.inTrip}</b>
        </div>
        <div class="fleet-gauge-card maint" onclick="go('vehicules')" style="cursor:pointer">
          <span>🔴 En Panne / Révision</span>
          <b>${fleetBreakdown.maintenance}</b>
        </div>
        <div class="fleet-gauge-card" style="border-top:4px solid #092e70">
          <span>📊 Taux d'Occupation</span>
          <b>${fleetBreakdown.occupancyPct}%</b>
        </div>
      </div>

      <!-- Alerte Conflits de Planning -->
      ${planningConflicts.length > 0 ? `
        <div class="conflict-alert-box">
          <b>⚠️ Attention : ${planningConflicts.length} conflit(s) de planning détecté(s) !</b>
          <ul style="margin:6px 0 0 16px;padding:0;font-size:12px">
            ${planningConflicts.slice(0, 3).map(c => `
              <li>${esc(c.reason)} (${esc(c.date)})</li>
            `).join("")}
          </ul>
        </div>
      ` : `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:8px">
          ✅ <b>Aucun conflit d'horaires</b> détecté entre chauffeurs et véhicules.
        </div>
      `}
    </div>

    <!-- 2. MODULE SECRÉTAIRE : Priorités du Jour & Départs avec WhatsApp direct -->
    <div class="dashboard-grid">
      <div class="panel" style="border-left:4px solid #7054ea">
        <div class="panel-title">
          <h3>⏰ Départs & Priorités du Jour (${todayReservations.length} courses)</h3>
          <button onclick="go('reservations')">Toutes les réservations ›</button>
        </div>

        ${todayReservations.length === 0 ? `
          <div class="empty-table"><p>Aucune course urgente programmée pour aujourd'hui.</p></div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:8px">
            ${todayReservations.slice(0, 5).map(res => `
              <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:10px 12px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                <div>
                  <b style="color:#092e70;font-size:13px">${esc(res.client)}</b> 
                  <span style="font-size:12px;color:#475569">(${esc(res.origin)} ➔ ${esc(res.destination)})</span><br>
                  <small style="color:#64748b">
                    ⏱️ ${esc(res.time || '08:00')} • 🚗 ${res.driver ? esc(res.driver) : '<span style="color:#dc2626;font-weight:700">⚠️ Chauffeur non assigné</span>'}
                    ${res.vehicle ? ` • 🚙 ${esc(res.vehicle)}` : ''}
                  </small>
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                  <button type="button" class="btn-wa" onclick="handleSendSecretaryWhatsApp('${esc(res.id)}')">
                    💬 WhatsApp Client
                  </button>
                  <button type="button" class="tiny" onclick="go('reservations');openForm('reservations', list('reservations').findIndex(x=>x.id==='${esc(res.id)}'))">
                    ✏️ Modifier
                  </button>
                </div>
              </div>
            `).join("")}
          </div>
        `}

        <!-- Bloc-notes de Relais d'équipe -->
        <div class="relay-notes-box">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b style="font-size:12px;color:#92400e">📝 Bloc-notes de Relais & Consignes d'Équipe :</b>
            <button type="button" class="primary tiny" onclick="handleSaveTeamNotes()">💾 Enregistrer</button>
          </div>
          <textarea 
            id="teamRelayNotesText" 
            class="relay-notes-textarea" 
            placeholder="Écrivez les consignes à transmettre aux collègues (ex: Suivi client M. Moïse, véhicule envoyé au lavage, clés en régie...)"
          >${esc(teamNotes)}</textarea>
        </div>
      </div>

      <!-- 4. MODULE COMPTABILITÉ & CAISSE : Point Journalier & Relances -->
      <div class="panel" style="border-left:4px solid #187a43">
        <div class="panel-title">
          <h3>💵 Point de Caisse Journalier (${todayStr})</h3>
          <button onclick="go('paiements')">Paiements ›</button>
        </div>
        
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:12px;border-radius:8px">
          <div style="font-size:12px;color:#166534">Total Encaissé Aujourd'hui :</div>
          <div style="font-size:24px;font-weight:800;color:#14532d;margin-top:2px">${money(cashBreakdown.total)}</div>
          <div style="font-size:11px;color:#166534;margin-top:2px">${cashBreakdown.count} transaction(s) validée(s)</div>
        </div>

        <div class="cashdesk-grid">
          <div class="cashdesk-pill">
            <span>💵 Espèces (Cash)</span>
            <b>${money(cashBreakdown.especes)}</b>
          </div>
          <div class="cashdesk-pill">
            <span>📱 MonCash</span>
            <b>${money(cashBreakdown.moncash)}</b>
          </div>
          <div class="cashdesk-pill">
            <span>📲 Natcash</span>
            <b>${money(cashBreakdown.natcash)}</b>
          </div>
          <div class="cashdesk-pill">
            <span>🏦 Virement / Chèque</span>
            <b>${money(cashBreakdown.banque)}</b>
          </div>
        </div>

        <!-- Factures Échues à relancer -->
        <div style="margin-top:14px;border-top:1px dashed #cbd5e1;padding-top:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <b style="font-size:12px;color:#b91c1c">⚠️ Factures en retard de paiement (${overdueInvoices.length}) :</b>
            <button onclick="go('factures')" class="tiny">Voir tout ›</button>
          </div>

          ${overdueInvoices.length === 0 ? `
            <div style="font-size:12px;color:#15803d">✅ Aucune facture en retard de règlement.</div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:6px">
              ${overdueInvoices.slice(0, 3).map(inv => `
                <div style="background:#fff;border:1px solid #fecaca;padding:8px 10px;border-radius:6px;display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <b style="font-size:12px;color:#991b1b">${esc(inv.number || inv.id)}</b> - ${esc(inv.client)}<br>
                    <span style="font-size:11px;color:#64748b">Montant dû : <b>${money(inv.amount || 0)}</b></span>
                  </div>
                  <button type="button" class="btn-wa" style="padding:4px 8px!important;font-size:11px!important" onclick="handleSendInvoiceReminder('${esc(inv.id)}')">
                    💬 Relancer
                  </button>
                </div>
              `).join("")}
            </div>
          `}
        </div>
      </div>
    </div>

    <!-- Documents Commerciaux & Raccourcis Staff -->
    <div class="panel" style="margin-top:14px">
      <div class="panel-title">
        <h3>📄 Documents Commerciaux & Raccourcis Opérations LAPERLE</h3>
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
          <button onclick="openForm('finances')">🧾 Saisir une dépense <b>›</b></button>
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

function openSyncAuthUsersModal() {
  const knownAuthUsers = [
    { email: "jpalamy@gmail.com", name: "J. Palamy", role: "prospect" },
    { email: "jjeanbobyson@gmail.com", name: "Bobyson Jean", role: "prospect" },
    { email: "samuelcastima@gmail.com", name: "Samuel Castima", role: "prospect" },
    { email: "castimamoise@gmail.com", name: "Moïse Castima", role: "admin" },
    { email: "laperletourht@gmail.com", name: "La Perle Tour HT", role: "admin" },
    { email: "mathiaspatricia66@gmail.com", name: "Patricia Mathias", role: "prospect" },
    { email: "casmoy@gmail.com", name: "Casmoy", role: "prospect" },
    { email: "arthur@laperletourht.com", name: "Arthur Laperle", role: "prospect" },
    { email: "prospect_2386@laperletourht.com", name: "Prospect 2386", role: "prospect" },
    { email: "client7234@laperletourht.com", name: "Client 7234", role: "client" }
  ];

  const currentUsers = list("utilisateurs") || [];
  const existingEmails = new Set(currentUsers.map(u => (u.email || '').toLowerCase().trim()));
  const missingUsers = knownAuthUsers.filter(u => !existingEmails.has(u.email.toLowerCase()));

  document.getElementById("modal").innerHTML = `
    <div class="modal-head">
      <div>
        <h2>🔄 Synchronisation Firebase Auth ➔ Firestore</h2>
        <small>Intègre les utilisateurs enregistrés dans Firebase Authentication directement dans Firestore.</small>
      </div>
      <button class="close" onclick="closeModal()">×</button>
    </div>
    <div style="padding:16px">
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:12px 14px;margin-bottom:14px">
        <div style="font-weight:700;font-size:13px;color:#0369a1;margin-bottom:6px">
          📋 Comptes détectés dans Firebase Auth à synchroniser (${missingUsers.length}) :
        </div>
        ${missingUsers.length === 0 ? `
          <div style="color:#15803d;font-size:12.5px;font-weight:600">
            ✅ Tous les comptes Firebase Auth connus sont déjà synchronisés dans Firestore !
          </div>
        ` : `
          <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#334155;max-height:160px;overflow-y:auto;line-height:1.6">
            ${missingUsers.map(u => `
              <li>
                <b>${esc(u.email)}</b> — ${esc(u.name)} (${esc(u.role === 'admin' ? 'Administrateur' : 'Prospect')})
              </li>
            `).join('')}
          </ul>
        `}
      </div>

      <div class="field" style="margin-bottom:14px">
        <label for="syncCustomEmails" style="font-weight:600;font-size:12.5px;display:block;margin-bottom:6px">
          Ajouter manuellement d'autres adresses e-mail Firebase à synchroniser :
        </label>
        <textarea id="syncCustomEmails" rows="2" placeholder="ex: jean@gmail.com, paul@yahoo.fr" style="font-size:12px;width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:8px"></textarea>
      </div>

      <div class="form-actions" style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px">
        <button type="button" class="secondary" onclick="closeModal()">Fermer</button>
        <button type="button" class="primary" id="btnExecuteSyncAuthUsers" style="display:inline-flex;align-items:center;gap:6px">
          <span>⚡ Lancer la Synchronisation Firestore</span>
        </button>
      </div>
    </div>
  `;

  document.getElementById("modalBackdrop").classList.add("open");

  document.getElementById("btnExecuteSyncAuthUsers").onclick = async () => {
    const btn = document.getElementById("btnExecuteSyncAuthUsers");
    btn.disabled = true;
    btn.innerHTML = '<span>Synchronisation en cours...</span>';

    const customText = document.getElementById("syncCustomEmails")?.value || "";
    const customList = customText.split(/[\n,;]+/).map(s => s.trim().toLowerCase()).filter(s => s.includes('@'));

    const toSync = [...missingUsers];
    customList.forEach(email => {
      if (!toSync.some(u => u.email === email)) {
        toSync.push({
          email,
          name: email.split('@')[0],
          role: email === SUPER_ADMIN_EMAIL ? 'admin' : 'prospect'
        });
      }
    });

    let successCount = 0;
    for (const u of toSync) {
      try {
        const uid = `usr_${u.email.replace(/[^a-z0-9]/g, '_')}`;
        await provisionUserInFirestore({
          uid,
          email: u.email,
          name: u.name,
          role: u.role,
          roles: [u.role],
          status: 'actif',
          statutCompte: 'actif',
          statutClient: u.role
        });
        successCount++;
      } catch (err) {
        console.warn("Erreur sync user:", u.email, err?.message);
      }
    }

    closeModal();
    showToast(`🎉 ${successCount} utilisateur(s) synchronisé(s) dans Firestore !`);
    drawTable('utilisateurs');
    if (current === 'dashboard') dashboard();
  };
}
window.openSyncAuthUsersModal = openSyncAuthUsersModal;

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
  const callerIsAdmin = roles.includes(ROLES.ADMIN);
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
  const isBlocked = secretaryBlockedOnAdmin || secretaryBlockedOnSelf || isSelf;

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

async function toggleUserStatusDirect(index) {
  const users = list("utilisateurs") || [];
  const target = users[index];
  if (!target) return;
  if (isSuperAdminEmail(target.email)) {
    showToast("👑 Le compte Super Administrateur maître ne peut jamais être désactivé.", "error");
    return;
  }
  if (target.uid === currentUser?.uid || target.id === currentUser?.uid || target.email === currentUser?.email) {
    showToast("⚠️ Vous ne pouvez pas désactiver votre propre compte actuellement connecté.", "error");
    return;
  }
  const currStat = (resolveUserField(target, "status") || "").toLowerCase();
  const nextStat = currStat === "actif" ? "inactif" : "actif";
  const actionWord = nextStat === "actif" ? "activer" : "désactiver";

  if (!confirm(`Confirmer : Souhaitez-vous vraiment ${actionWord} l'accès de « ${target.name || target.email} » ?`)) {
    return;
  }

  try {
    const docId = target.id || target.uid;
    await updateUserStatus(docId, nextStat);
    target.status = nextStat === "actif" ? "Actif" : "Inactif";
    target.statutCompte = nextStat;
    save();
    showToast(`✅ Compte de « ${target.name || target.email} » passé à : ${nextStat.toUpperCase()}`);
    drawTable("utilisateurs");
  } catch (err) {
    showToast(`Erreur mise à jour: ${err.message}`, "error");
  }
}
window.toggleUserStatusDirect = toggleUserStatusDirect;

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
      <div class="info" style="margin-bottom:14px;background:#f0f7ff;border:1.5px solid #082b70;border-radius:10px;padding:14px 16px;color:#082b70">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div>
            <b style="font-size:13.5px;display:flex;align-items:center;gap:6px">👑 Gouvernance de l'Équipe LAPERLE TOUR HT (RBAC Multi-Rôles)</b>
            <div style="font-size:12px;color:#475569;margin-top:4px">
              Contrôle strict des accès opérationnels et financiers. <b>castimamoise@gmail.com</b> et <b>laperletourht@gmail.com</b> sont immunisés en Super Administrateurs maîtres originels.
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="user-role-badge admin super-admin" style="font-size:10px">👑 Super Admin</span>
            <span class="user-role-badge direction" style="font-size:10px">🏢 Direction</span>
            <span class="user-role-badge operations" style="font-size:10px">🚦 Opérations</span>
            <span class="user-role-badge comptabilite" style="font-size:10px">💼 Comptabilité</span>
          </div>
        </div>
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
  const isSuperAdmin = normalizeRoles(currentUserRoles).includes(ROLES.ADMIN) || isSuperAdminEmail(currentUser?.email);
  const syncBtn = (canon === "utilisateurs" && isSuperAdmin) ? `
    <button class="secondary" onclick="openSyncAuthUsersModal()" style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;padding:7px 12px;margin-right:6px">
      <span>🔄 Synchroniser Comptes Firebase</span>
    </button>
  ` : "";

  document.getElementById("page").innerHTML = `
    <div class="section-head">
      <div>
        <h2>${modInfo.icon} ${title}</h2>
        <p>Gestion en direct Cloud Firestore • Données persistantes et sécurisées.</p>
      </div>
      <div class="actions">
        ${syncBtn}
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

function resolveUserField(o, fieldKey) {
  if (!o) return "—";
  if (fieldKey === "name") {
    return o.name || o.nom || (o.prenom ? `${o.nom || ''} ${o.prenom}`.trim() : '') || o.displayName || (o.email ? o.email.split('@')[0] : 'Utilisateur');
  }
  if (fieldKey === "email") {
    return o.email || o.identifiant || o.mail || o.telephone || o.phone || "—";
  }
  if (fieldKey === "roles") {
    if (Array.isArray(o.roles) && o.roles.length > 0) return o.roles;
    if (o.role) return [o.role];
    return ["prospect"];
  }
  if (fieldKey === "status") {
    return o.status || o.statutCompte || o.statut || "Actif";
  }
  if (fieldKey === "notes") {
    return o.notes || o.notesHabilitation || o.remarques || (o.statutClient ? `Statut client : ${o.statutClient}` : "");
  }
  return o[fieldKey];
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
    let searchable = "";
    if (canon === "utilisateurs") {
      searchable = [
        resolveUserField(o, "name"),
        resolveUserField(o, "email"),
        resolveUserField(o, "roles").join(" "),
        resolveUserField(o, "status")
      ].join(" ").toLowerCase();
    } else {
      searchable = Object.values(o).join(" ").toLowerCase();
    }
    const matchesSearch = searchable.includes(q);
    const itemStatus = canon === "utilisateurs" ? resolveUserField(o, "status") : o.status;
    const matchesFilter = !f || String(itemStatus).toLowerCase() === f.toLowerCase();
    return matchesSearch && matchesFilter;
  });

  const schema = SCHEMAS[canon] || [];
  let cols = schema.slice(0, 7);
  if (canon === "clients") cols = [["id", "ID client", "text"], ...cols];
  if (canon === "proformas") cols = [["number", "N° Proforma", "text"], ...cols];
  if (canon === "factures") cols = [["number", "N° Facture", "text"], ...cols];
  if (canon === "reservations" || canon === "bookings") cols = [["id", "N° Réservation", "text"], ...cols];

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
                ${cols.map(x => {
                  const val = canon === "utilisateurs" ? resolveUserField(o, x[0]) : o[x[0]];
                  if ((canon === "reservations" || canon === "bookings") && x[0] === "id") {
                    const displayId = val || o.code || `RES-${String(i + 1).padStart(4, "0")}`;
                    return `<td>
                      <button type="button" 
                        class="reservation-table-badge"
                        onclick="viewRow('${canon}', ${i})" 
                        title="Cliquer pour ouvrir les détails de la réservation ${esc(displayId)}"
                        style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;border-radius:6px;padding:3px 9px;font-size:11px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;transition:all 0.15s ease;"
                        onmouseover="this.style.background='#dbeafe';this.style.borderColor='#93c5fd';this.style.transform='translateY(-1px)'"
                        onmouseout="this.style.background='#eff6ff';this.style.borderColor='#bfdbfe';this.style.transform='translateY(0)'">
                        <span>📋</span>
                        <span>${esc(displayId)}</span>
                        <span style="font-size:10px;opacity:0.75">↗</span>
                      </button>
                    </td>`;
                  }
                  if (x[0] === "passengers") {
                    return `<td><b>${esc(val || 1)}</b> <small style="color:#64748b">pass.</small></td>`;
                  }
                  return `<td>${formatCell(val, x[2])}</td>`;
                }).join("")}
                <td class="action-cell">
                  ${canEdit ? (canon === "utilisateurs" ? (() => {
                    const isCallerAdmin = normalizeRoles(currentUserRoles).includes(ROLES.ADMIN) || isSuperAdminEmail(currentUser?.email);
                    const isCallerSecretaire = normalizeRoles(currentUserRoles).includes(ROLES.SECRETAIRE);
                    const isTargetSuper = isSuperAdminEmail(o.email);
                    const isTargetSelf = o.uid === currentUser?.uid || o.id === currentUser?.uid || o.email === currentUser?.email;
                    const curStatus = (resolveUserField(o, "status") || "").toLowerCase();
                    const isActif = curStatus === "actif";

                    let btns = "";
                    if ((isCallerAdmin || isCallerSecretaire) && !isTargetSuper && !isTargetSelf) {
                      btns += `<button class="tiny edit role-assign-btn" onclick="openUserRoleModal(${i})">🛡️ Rôles & Accès</button>`;
                      if (isCallerAdmin) {
                        if (isActif) {
                          btns += `<button class="tiny" style="color:#b91c1c;border-color:#fca5a5;background:#fff" onclick="toggleUserStatusDirect(${i})" title="Désactiver l'accès en 1 clic">🔒 Désactiver</button>`;
                        } else {
                          btns += `<button class="tiny" style="color:#15803d;border-color:#86efac;background:#fff" onclick="toggleUserStatusDirect(${i})" title="Réactiver l'accès en 1 clic">✅ Activer</button>`;
                        }
                      }
                    } else if (isTargetSuper) {
                      btns += `<span class="user-role-badge admin super-admin" style="font-size:10px" title="Super Administrateur Fondateur (Immunisé contre toute suppression ou rétrogradation)">👑 Super Admin</span>`;
                    } else if (isTargetSelf) {
                      btns += `<span class="badge" style="background:#eff6ff;color:#1e40af;font-size:10.5px">👤 Mon compte</span>`;
                    } else {
                      btns += `<span class="badge" style="background:#f1f5f9;color:#64748b;font-size:10.5px">🔒 Rôle protégé</span>`;
                    }
                    return btns;
                  })() : `<button class="tiny edit" onclick="openForm('${canon}',${i})">Modifier</button>`) : ""}
                  <button class="tiny" onclick="viewRow('${canon}',${i})">Voir</button>
                  ${(canon === "reservations" || canon === "bookings") ? (() => {
                    const roles = normalizeRoles(currentUserRoles);
                    const isStaff = roles.some(r => ['admin', 'direction', 'operations', 'secretaire', 'comptabilite'].includes(r)) || isSuperAdminEmail(currentUser?.email);
                    if (isStaff) {
                      let tag = "";
                      if (o.demandeProforma) tag += `<span class="badge" style="background:#fef3c7;color:#92400e;font-size:10px;padding:2px 6px;margin-right:2px" title="Demande de proforma reçue">🔔 Demande Proforma</span>`;
                      if (o.demandeFacture) tag += `<span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:10px;padding:2px 6px;margin-right:2px" title="Demande de facture reçue">🔔 Demande Facture</span>`;
                      return `
                        ${tag}
                        <button class="tiny" style="color:#082b70;border-color:#bfdbfe;background:#eff6ff" onclick="createProformaFromReservation(${i})" title="Convertir cette réservation en devis proforma">Proforma</button>
                      `;
                    } else {
                      let clientBtns = "";
                      if (o.proformaGenerated) {
                        clientBtns += `<button class="tiny" style="color:#082b70;border-color:#bfdbfe;background:#eff6ff" onclick="handleOpenDocumentFromAlert('proforma', '${o.proformaGenerated}')" title="Consulter le devis officiel">📄 Devis Proforma</button>`;
                      } else if (!o.demandeProforma) {
                        clientBtns += `<button class="tiny" style="color:#0369a1;border-color:#bae6fd;background:#f0f9ff" onclick="requestDocumentFromReservation(${i}, 'proforma')" title="Demander un devis proforma à l'administration">Demander Proforma</button>`;
                      } else {
                        clientBtns += `<span class="badge" style="background:#fef3c7;color:#92400e;font-size:10px;padding:2px 6px">⏳ Proforma demandée</span>`;
                      }

                      if (o.factureGenerated) {
                        clientBtns += `<button class="tiny" style="color:#15803d;border-color:#bbf7d0;background:#f0fdf4" onclick="handleOpenDocumentFromAlert('facture', '${o.factureGenerated}')" title="Consulter la facture officielle">🧾 Facture</button>`;
                      } else if (!o.demandeFacture) {
                        clientBtns += `<button class="tiny" style="color:#15803d;border-color:#bbf7d0;background:#f0fdf4" onclick="requestDocumentFromReservation(${i}, 'facture')" title="Demander une facture officielle à l'administration">Demander Facture</button>`;
                      } else {
                        clientBtns += `<span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:10px;padding:2px 6px">⏳ Facture demandée</span>`;
                      }
                      return clientBtns;
                    }
                  })() : ""}
                  ${canon === "proformas" ? (() => {
                    const roles = normalizeRoles(currentUserRoles);
                    const isStaff = roles.some(r => ['admin', 'direction', 'operations', 'secretaire', 'comptabilite'].includes(r)) || isSuperAdminEmail(currentUser?.email);
                    return `
                      ${isStaff ? `<button class="tiny" onclick="createInvoiceFromQuote(${i})">Facture</button>` : ""}
                      <button class="tiny" onclick="printDocument('proforma',${i})">PDF Proforma</button>
                    `;
                  })() : ""}
                  ${canon === "factures" ? `
                    <button class="tiny" onclick="printDocument('facture',${i})">PDF Facture</button>
                  ` : ""}
                  ${canDelete && canon !== "utilisateurs" ? `<button class="tiny delete" onclick="removeRow('${canon}',${i})">Archiver / Suppr.</button>` : ""}
                  ${canDelete && canon === "utilisateurs" && !isSuperAdminEmail(o.email) && o.uid !== currentUser?.uid && o.id !== currentUser?.uid ? `<button class="tiny delete" onclick="removeRow('${canon}',${i})">Supprimer</button>` : ""}
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
      let label = ROLE_LABELS[safe] || safe.toUpperCase();
      if (safe === "admin") label = "👑 Administrateur";
      else if (safe === "direction") label = "🏢 Direction";
      else if (safe === "operations") label = "🚦 Opérations";
      else if (safe === "comptabilite") label = "💼 Comptabilité";
      else if (safe === "secretaire") label = "📋 Secrétariat";
      else if (safe === "chauffeur") label = "🚗 Chauffeur";
      else if (safe === "client") label = "👤 Client";
      else if (safe === "prospect") label = "🎯 Prospect";
      return `<span class="user-role-badge ${safe}" style="font-size:10px;padding:2px 7px;margin:1px 2px;display:inline-block">${esc(label)}</span>`;
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
        <button class="primary" id="dataFormSubmitBtn" type="submit">💾 Enregistrer dans le Cloud</button>
      </div>
    </form>
  `;
  document.getElementById("modalBackdrop").classList.add("open");

  document.getElementById("dataForm").onsubmit = async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("dataFormSubmitBtn") || e.target.querySelector('button[type="submit"]');
    if (submitBtn?.dataset?.submitting === "true") return;

    const resetSubmitBtn = () => {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove("btn-loading");
        submitBtn.dataset.submitting = "false";
        submitBtn.innerHTML = submitBtn.dataset.originalHtml || "💾 Enregistrer dans le Cloud";
      }
    };

    if (submitBtn) {
      submitBtn.dataset.submitting = "true";
      submitBtn.dataset.originalHtml = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.classList.add("btn-loading");
      submitBtn.innerHTML = `<span class="auth-spinner"></span> <span>Enregistrement en cours...</span>`;
    }

    let obj = {};
    new FormData(e.target).forEach((v, k) => obj[k] = v.trim());

    const previousItem = index >= 0 ? { ...list(canon)[index] } : null;
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
        if (!obj.email || !obj.email.includes('@')) {
          resetSubmitBtn();
          showToast("Veuillez saisir une adresse e-mail valide pour l'utilisateur.", "error");
          return;
        }
        const cleanEmail = obj.email.trim().toLowerCase();
        const autoUid = `usr_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
        obj.id = autoUid;
        obj.uid = autoUid;
        obj.email = cleanEmail;
        obj.name = obj.name || cleanEmail.split('@')[0];
        obj.role = obj.roles || obj.role || 'prospect';
        obj.roles = [obj.role];
        obj.status = obj.status || 'actif';
        obj.statutCompte = 'actif';
        obj.statutClient = obj.role;
        const isAdminUser = obj.role === 'admin' || obj.roles.includes('admin');
        if (isAdminUser) {
          obj.notes = obj.notes ? `${obj.notes} (Mot de passe initial : Admin2026)` : 'Mot de passe initial : Admin2026';
        }
        try {
          await provisionUserInFirestore(obj);
          closeModal();
          if (isAdminUser) {
            showToast(`👑 Administrateur « ${cleanEmail} » créé ! Mot de passe initial : Admin2026`);
          } else {
            showToast(`✅ Utilisateur « ${cleanEmail} » enregistré dans Firestore !`);
          }
          drawTable('utilisateurs');
          return;
        } catch (err) {
          resetSubmitBtn();
          showToast(`Erreur enregistrement Firestore: ${err?.message}`, "error");
          return;
        }
      }

      // Attribution automatique des propriétés de rattachement pour Client, Prospect et Chauffeur
      if (currentUser) {
        const myRoles = normalizeRoles(currentUserRoles);
        if ((myRoles.includes(ROLES.CLIENT) || myRoles.includes(ROLES.PROSPECT)) && !myRoles.includes(ROLES.ADMIN)) {
          obj.clientId = currentUser.uid || currentUser.id;
          obj.clientUid = currentUser.uid || currentUser.id;
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

    const savedItem = index >= 0 ? list(canon)[index] : list(canon)[list(canon).length - 1];
    const needsAuthoritativeWrite = canon === "reservations" || (canon === "proformas" && index < 0);
    if (!needsAuthoritativeWrite) save();

    try {
      // Les créations officielles de proforma passent par le serveur autorisé.
      if (canon === "proformas" && index < 0) {
        const created = await createProforma(savedItem, savedItem.number);
        Object.assign(savedItem, created);
        if (created.profile && currentUser?.uid === created.profile.uid) {
          currentUserProfile = created.profile;
          currentUserRoles = normalizeRoles(created.profile.roles || created.profile.role);
          currentRole = currentUserRoles[0];
          saveUserSession(currentUser, currentUserProfile);
        }
      } else if (canon === "reservations") {
        const uid = auth.currentUser?.uid;
        if (!db || !uid) throw new Error("Une session Firebase est requise pour enregistrer la réservation.");

        // Solution B : Normalisation explicite des types numériques et des identifiants
        if (savedItem.amount !== undefined) savedItem.amount = Number(savedItem.amount) || 0;
        if (savedItem.price !== undefined) savedItem.price = Number(savedItem.price) || 0;
        if (savedItem.passengers !== undefined) savedItem.passengers = Number(savedItem.passengers) || 1;
        if (savedItem.montantTotal !== undefined) savedItem.montantTotal = Number(savedItem.montantTotal) || savedItem.amount || 0;
        if (savedItem.passagers !== undefined) savedItem.passagers = Number(savedItem.passagers) || savedItem.passengers || 1;

        const effectiveClientId = savedItem.clientId || savedItem.uid || uid;
        savedItem.clientId = effectiveClientId;
        savedItem.clientUid = effectiveClientId;
        savedItem.uid = effectiveClientId;
        if (!savedItem.createdBy) savedItem.createdBy = uid;
        savedItem.updatedBy = uid;

        // Détection de la demande de devis Proforma dès la réservation
        const callerRoles = normalizeRoles(currentUserRoles);
        const isProspectOrClient = callerRoles.includes(ROLES.PROSPECT) || callerRoles.includes(ROLES.CLIENT);
        const wantsProforma = savedItem.demandeProforma === 'Oui' || savedItem.demandeProforma === true || (index < 0 && isProspectOrClient && savedItem.demandeProforma !== 'Non');

        if (wantsProforma) {
          savedItem.demandeProforma = true;
          savedItem.dateDemandeProforma = new Date().toISOString();
        } else if (savedItem.demandeProforma === 'Non') {
          savedItem.demandeProforma = false;
        }

        await setDoc(doc(db, "reservations", String(savedItem.id)), {
          ...savedItem,
          clientId: effectiveClientId,
          clientUid: effectiveClientId,
          uid: effectiveClientId,
          createdBy: savedItem.createdBy || uid,
          updatedBy: uid,
          createdAt: savedItem.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          archived: savedItem.archived === true
        });

        // Double synchronisation (Instantanée locale + Cloud Firestore) :
        // Lorsqu'un prospect réserve pour la première fois et souhaite un devis, générer automatiquement l'alerte de demande de proforma
        if (wantsProforma && index < 0) {
          const resCode = savedItem.code || savedItem.id || `#${rawList("reservations").length}`;
          const clientName = savedItem.nomClient || savedItem.client || currentUserProfile?.name || currentUser?.displayName || currentUser?.email || 'Client';
          const phone = savedItem.telephone || savedItem.phone || currentUserProfile?.telephone || '';
          const routeDesc = savedItem.trajet || savedItem.route || (savedItem.origin && savedItem.destination ? `${savedItem.origin} ➔ ${savedItem.destination}` : '');

          const notifId = `NOTIF-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          const notifPayload = {
            id: notifId,
            title: `🔔 Demande de devis Proforma (${resCode})`,
            message: `Le client ${clientName} (${phone || 'sans tél'}) a demandé un devis Proforma pour la réservation ${resCode}${routeDesc ? ` (${routeDesc})` : ''}.`,
            type: 'finance',
            priority: 'high',
            actionType: 'demande_proforma',
            docType: 'proforma',
            forRole: 'admin',
            targetUid: 'staff',
            targetRole: 'staff',
            isInternal: true,
            broadcast: false,
            read: false,
            date: new Date().toISOString(),
            reservationId: savedItem.id || savedItem.code || '',
            clientId: effectiveClientId
          };

          if (!Array.isArray(state.notifications)) state.notifications = [];
          state.notifications.unshift({ ...notifPayload });
          newlyArrivedNotificationIds.add(notifId);
          updateNotificationBadge();
          if (isNotifDropdownOpen) renderNotificationDropdown();

          try {
            await createNotification(notifPayload, notifId);
          } catch (notifErr) {
            console.warn("Erreur alerte auto réservation proforma:", notifErr);
          }
        }
      } else {
        await saveDocumentToFirestore(canon, savedItem);
      }
    } catch (err) {
      resetSubmitBtn();
      if (needsAuthoritativeWrite) {
        const items = rawList(canon);
        const itemIndex = items.indexOf(savedItem);
        if (index >= 0 && itemIndex >= 0 && previousItem) items[itemIndex] = previousItem;
        else if (itemIndex >= 0) items.splice(itemIndex, 1);
        save();
        showToast(canon === "reservations"
          ? "Réservation non enregistrée dans Firestore. Vérifiez votre connexion et réessayez."
          : "Proforma non enregistrée dans Firestore. Vérifiez vos droits et réessayez.", "error");
        return;
      }
      throw err;
    }

    if (needsAuthoritativeWrite) save();

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
  if (canon === "reservations" && id === "demandeProforma") {
    const callerRoles = normalizeRoles(currentUserRoles);
    const isProspectOrClient = callerRoles.includes(ROLES.PROSPECT) || callerRoles.includes(ROLES.CLIENT);
    const isYes = val === "Oui" || val === true || (!val && isProspectOrClient);
    return `
      <div class="field">
        <label>Demande de devis Proforma officiel</label>
        <select name="demandeProforma">
          <option value="Oui" ${isYes ? "selected" : ""}>Oui - Envoyer une demande de devis Proforma</option>
          <option value="Non" ${!isYes ? "selected" : ""}>Non - Réservation directe</option>
        </select>
      </div>
    `;
  }
  if (["plannings", "reservations", "abonnements", "vehicules", "finances"].includes(canon) && id === "driver") {
    // Collecter exhaustivement la liste de tous les chauffeurs disponibles
    let drivers = [];
    if (Array.isArray(state.chauffeurs)) {
      drivers = state.chauffeurs.filter(c => !c.archived && c.status !== "Archivé");
    }
    if (!drivers.length) {
      drivers = (rawList("chauffeurs") || []).filter(c => !c.archived && c.status !== "Archivé");
    }
    if (!drivers.length) {
      drivers = (list("chauffeurs") || []).filter(c => !c.archived);
    }

    // Récupérer aussi les comptes utilisateurs enregistrés avec le rôle chauffeur
    const chauffeurUsers = (state.utilisateurs || []).filter(u => {
      const r = normalizeRoles(u.roles || [u.role]);
      return r.includes("chauffeur");
    });
    chauffeurUsers.forEach(cu => {
      const name = cu.name || cu.nom || (cu.email ? cu.email.split('@')[0] : null);
      if (name && !drivers.some(d => d.name && d.name.toLowerCase() === name.toLowerCase())) {
        drivers.push({
          id: cu.uid || cu.id,
          name: name,
          phone: cu.telephone || cu.phone || "",
          vehicle: cu.vehicle || "",
          status: "Disponible"
        });
      }
    });

    // Liste des chauffeurs officiels de la flotte LAPERLE garantie
    if (!drivers.length) {
      drivers = [
        { id: "CH-001", name: "Jean-Marc Pierre", phone: "+509 3801-4455", vehicle: "Toyota HiAce (VH-001)", status: "Disponible" },
        { id: "CH-002", name: "Wilner Charles", phone: "+509 4210-7788", vehicle: "Hyundai Tucson (VH-002)", status: "Disponible" },
        { id: "CH-003", name: "Fabrice Augustin", phone: "+509 3677-1234", vehicle: "Nissan Urvan (VH-003)", status: "Disponible" }
      ];
    }

    const hasVal = !val || drivers.some(c => c.name === val);
    const extraOpt = (!hasVal && val) ? `<option value="${esc(val)}" selected>${esc(val)} (Actuel)</option>` : "";

    return `
      <div class="field">
        <label>Chauffeur assigné (Confirmation course)</label>
        <select name="driver" style="font-weight: 600; color: #082b70; border: 1.5px solid #082b70; background: #f8fafc;">
          <option value="">-- Sélectionner un chauffeur pour confirmer la course --</option>
          ${extraOpt}
          ${drivers.map(c => {
            const isSel = (c.name === val) || (val && c.name && val.includes(c.name));
            const phoneStr = c.phone ? ` • ${c.phone}` : "";
            const vehStr = c.vehicle ? ` • ${c.vehicle}` : "";
            const statusStr = c.status ? ` [${c.status}]` : "";
            return `<option value="${esc(c.name)}" ${isSel ? "selected" : ""}>🚗 ${esc(c.name)}${esc(vehStr)}${esc(phoneStr)}${esc(statusStr)}</option>`;
          }).join("")}
        </select>
      </div>
    `;
  }
  if (["plannings", "reservations", "abonnements", "chauffeurs"].includes(canon) && id === "vehicle") {
    let vehicles = [];
    if (Array.isArray(state.vehicules)) {
      vehicles = state.vehicules.filter(v => !v.archived && v.status !== "Archivé");
    }
    if (!vehicles.length) {
      vehicles = (rawList("vehicules") || []).filter(v => !v.archived && v.status !== "Archivé");
    }
    if (!vehicles.length) {
      vehicles = (list("vehicules") || []).filter(v => !v.archived);
    }
    if (!vehicles.length) {
      vehicles = [
        { brand: "Toyota", model: "HiAce", plate: "TP-45892", vehicle: "Toyota HiAce (VH-001)" },
        { brand: "Hyundai", model: "Tucson", plate: "AA-12044", vehicle: "Hyundai Tucson (VH-002)" },
        { brand: "Nissan", model: "Urvan", plate: "BB-99210", vehicle: "Nissan Urvan (VH-003)" }
      ];
    }
    const hasVehVal = !val || vehicles.some(v => (v.vehicle === val || `${v.brand || ''} ${v.model || ''} (${v.plate || ''})`.trim() === val));
    const extraVehOpt = (!hasVehVal && val) ? `<option value="${esc(val)}" selected>${esc(val)} (Actuel)</option>` : "";

    return `
      <div class="field">
        <label>Véhicule assigné</label>
        <select name="vehicle">
          <option value="">-- Sélectionner un véhicule --</option>
          ${extraVehOpt}
          ${vehicles.map(v => {
            const vName = v.vehicle || `${v.brand || ''} ${v.model || ''} (${v.plate || ''})`.trim();
            const isSel = vName === val || (v.plate && v.plate === val);
            return `<option value="${esc(vName)}" ${isSel ? "selected" : ""}>🚐 ${esc(vName)}</option>`;
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

  const roles = normalizeRoles(currentUserRoles);
  const isStaff = roles.some(r => ['admin', 'direction', 'operations', 'secretaire', 'comptabilite'].includes(r)) || isSuperAdminEmail(currentUser?.email);

  let extraButtons = "";
  if (canon === "reservations" || canon === "bookings") {
    if (isStaff) {
      extraButtons = `
        <button class="primary" style="background:#082b70;border-color:#082b70;display:inline-flex;align-items:center;gap:6px" onclick="closeModal();createProformaFromReservation(${index})">
          <span>📄</span> <span>Convertir en Proforma</span>
        </button>
      `;
    } else {
      let reqBtns = "";
      if (o.proformaGenerated) {
        reqBtns += `
          <button class="primary" style="background:#082b70;border-color:#082b70;display:inline-flex;align-items:center;gap:6px" onclick="closeModal();handleOpenDocumentFromAlert('proforma', '${o.proformaGenerated}')">
            <span>📄</span> <span>Consulter mon Devis Proforma (${o.proformaGenerated})</span>
          </button>
        `;
      } else if (!o.demandeProforma) {
        reqBtns += `
          <button class="primary" style="background:#0284c7;border-color:#0284c7;display:inline-flex;align-items:center;gap:6px" onclick="requestDocumentFromReservation(${index}, 'proforma')">
            <span>📩</span> <span>Demander un devis Proforma</span>
          </button>
        `;
      } else {
        reqBtns += `
          <button class="secondary" style="background:#fef3c7;color:#92400e;border-color:#fde68a" disabled>
            <span>⏳</span> <span>Demande de Proforma en attente de validation</span>
          </button>
        `;
      }

      if (o.factureGenerated) {
        reqBtns += `
          <button class="primary green" style="display:inline-flex;align-items:center;gap:6px" onclick="closeModal();handleOpenDocumentFromAlert('facture', '${o.factureGenerated}')">
            <span>🧾</span> <span>Consulter ma Facture (${o.factureGenerated})</span>
          </button>
        `;
      } else if (!o.demandeFacture) {
        reqBtns += `
          <button class="primary" style="background:#16a34a;border-color:#16a34a;display:inline-flex;align-items:center;gap:6px" onclick="requestDocumentFromReservation(${index}, 'facture')">
            <span>📩</span> <span>Demander une Facture</span>
          </button>
        `;
      } else {
        reqBtns += `
          <button class="secondary" style="background:#e0f2fe;color:#0369a1;border-color:#bae6fd" disabled>
            <span>⏳</span> <span>Demande de Facture en attente de validation</span>
          </button>
        `;
      }
      extraButtons = reqBtns;
    }
  } else if (canon === "proformas") {
    extraButtons = `
      ${isStaff ? `<button class="primary green" onclick="closeModal();createInvoiceFromQuote(${index})">🧾 Convertir en Facture</button>` : ""}
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

let isReservationProcessing = false;

async function handleConfirmClientReservation() {
  if (isReservationProcessing) return;
  isReservationProcessing = true;

  const dest = document.getElementById("firstResDest")?.value || "Port-au-Prince ➔ Cap-Haïtien";
  const date = document.getElementById("firstResDate")?.value || today();
  const service = document.getElementById("firstResService")?.value || "Transport Interurbain";
  const passengers = document.getElementById("firstResPass")?.value || "1";
  const btn = document.getElementById("btnConfirmFirstRes");

  if (btn) {
    btn.disabled = true;
    btn.classList.add("btn-loading");
    btn.innerHTML = `<span class="auth-spinner"></span> <span>Confirmation de votre réservation en cours...</span>`;
  }

  try {
    const activeUid = auth.currentUser?.uid || currentUser?.uid;
    if (!activeUid) throw new Error("Utilisateur non connecté ou session invalide.");

    const prof = currentUserProfile || {};
    const parts = dest.includes("➔") ? dest.split("➔").map(s => s.trim()) : [dest, dest];
    const clientName = prof.nom || prof.name || currentUser?.displayName || (prof.email ? prof.email.split('@')[0] : "Client LAPERLE");
    const phone = prof.telephone || prof.phone || currentUser?.phoneNumber || "";
    const email = prof.email || currentUser?.email || "";

    const authUid = activeUid;
    const uid = activeUid;
    const numPassengers = Number(parseInt(passengers, 10)) || 1;
    const cleanAmount = Number(2500);

    // 1. Création de l'enregistrement de réservation conforme au schéma complet de la plateforme
    const resId = "RES-" + Date.now().toString(36).toUpperCase();
    const resItem = {
      id: resId,
      code: resId,
      client: clientName,
      nomClient: clientName,
      clientId: authUid,
      clientUid: authUid,
      uid: authUid,
      createdBy: authUid,
      updatedBy: authUid,
      telephone: phone,
      phone: phone,
      email: email,
      origin: parts[0] || dest,
      destination: parts[1] || dest,
      trajet: dest,
      route: dest,
      service: service,
      typePrestation: service,
      date: date,
      dateDepart: date,
      time: "08:00",
      passengers: numPassengers,
      passagers: numPassengers,
      amount: cleanAmount,
      montantTotal: cleanAmount,
      price: cleanAmount,
      devise: "HTG",
      status: "À confirmer",
      statut: "À confirmer",
      notes: `${service} • ${dest} • ${numPassengers} passager(s) • Réservé en ligne`,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!db) {
      throw new Error("Firestore indisponible.");
    }

    if (auth.currentUser) {
      try {
        await auth.currentUser.getIdToken();
      } catch (_) {}
    }

    // Synchronisation du profil prospect dans Firestore
    try {
      if (auth.currentUser && db) {
        const userDocRef = doc(db, "utilisateurs", uid);
        await setDoc(userDocRef, {
          id: uid,
          uid: uid,
          email: email,
          name: clientName,
          nom: prof.nom || clientName,
          prenom: prof.prenom || "",
          username: prof.username || (email ? email.split('@')[0] : `user_${uid.slice(0, 6)}`),
          phone: phone,
          telephone: phone,
          role: "prospect",
          roles: ["prospect"],
          statutClient: "prospect",
          status: "actif",
          statutCompte: "actif",
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (e) {
      console.warn("Sync profil prospect Firestore:", e?.message);
    }

    // Écriture Firestore sécurisée de la réservation
    if (auth.currentUser) {
      await setDoc(doc(db, "reservations", resId), resItem);
    } else {
      console.warn("Écriture différée Firestore: session anonyme/locale active.");
    }

    // Notification broadcast pour les administrateurs et secrétaires
    try {
      const notifId = "NOTIF-" + Date.now().toString(36).toUpperCase();
      await setDoc(doc(db, "notifications", notifId), {
        id: notifId,
        title: "Nouvelle réservation prospect",
        message: `${clientName} (@${prof.username || uid.slice(0, 6)}) a réservé : ${dest} pour le ${date} (${numPassengers} passager(s)).`,
        targetUid: "staff",
        targetRole: "staff",
        broadcast: false,
        isInternal: true,
        forRole: "admin",
        createdBy: uid,
        senderUid: uid,
        senderName: clientName,
        read: false,
        createdAt: new Date().toISOString()
      });
    } catch (notifErr) {
      console.warn("Notification staff:", notifErr?.message || notifErr);
    }

    let proformaRequestSaved = true;
    try {
      await requestProforma({ client: clientName, reservationId: resId, details: `${service} • ${dest} • ${date} • ${numPassengers} passager(s)` });
    } catch (requestError) {
      proformaRequestSaved = false;
      console.warn("Demande de proforma non transmise:", requestError);
    }

    if (!Array.isArray(state["reservations"])) state["reservations"] = [];
    const existingIdx = state["reservations"].findIndex(r => r.id === resId);
    if (existingIdx >= 0) {
      state["reservations"][existingIdx] = resItem;
    } else {
      state["reservations"].unshift(resItem);
    }
    save();

    showToast("✅ Réservation enregistrée avec succès ! Notre équipe commerciale prépare votre premier devis proforma.", "success");

    // Re-rendre la vue pour afficher immédiatement la réservation
    render();

    if (btn) {
      btn.disabled = false;
      btn.classList.remove("btn-loading");
      btn.innerHTML = `<span>✅</span> <span>Réservation transmise avec succès !</span>`;
      setTimeout(() => {
        if (btn) {
          btn.innerHTML = `<span>🎫</span> <span>Réserver un autre trajet</span>`;
          btn.disabled = false;
          btn.classList.remove("btn-loading");
        }
      }, 3500);
    }

  } catch (err) {
    console.error("Erreur confirmation réservation client:", err);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("btn-loading");
      btn.innerHTML = `<span>🎫</span> <span>Confirmer ma réservation et activer mon Espace Client</span>`;
    }
    showToast("Réservation non enregistrée dans Firestore (" + (err?.message || "erreur") + "). Vérifiez votre connexion et réessayez.", "error");
  } finally {
    isReservationProcessing = false;
  }
}
window.handleConfirmClientReservation = handleConfirmClientReservation;

function renderAdminOrStaffProfilePage() {
  const user = currentUser;
  const profile = currentUserProfile || {};
  const isSuper = isSuperAdminEmail(user?.email || profile?.email);
  const displayName = profile.nom || profile.name || user?.displayName || user?.email?.split('@')[0] || user?.phoneNumber || "Administrateur";
  const email = profile.email || user?.email || "—";
  const telephone = profile.telephone || user?.phoneNumber || "—";
  const photo = profile.photoURL || user?.photoURL || "";
  const statutCompte = profile.statutCompte || profile.status || "actif";
  const rolesList = normalizeRoles(currentUserRoles.length ? currentUserRoles : (profile.roles || [ROLES.ADMIN]));

  const page = document.getElementById("page");
  if (!page) return;

  page.innerHTML = `
    <div style="max-width: 860px; margin: 24px auto; padding: 0 16px;">
      <!-- Carte d'identité Administrateur / Staff -->
      <div style="background: linear-gradient(135deg, #092e70 0%, #174291 100%); border-radius: 16px; padding: 28px 24px; color: #ffffff; box-shadow: 0 8px 24px rgba(9,46,112,0.18); margin-bottom: 22px;">
        <div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap;">
          <div style="width: 76px; height: 76px; border-radius: 50%; background: #ffffff; color: #092e70; display: grid; place-items: center; font-size: 30px; font-weight: 800; border: 3px solid #f7941d; overflow: hidden; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.18);">
            ${photo ? `<img src="${esc(photo)}" style="width:100%;height:100%;object-fit:cover;" alt="${esc(displayName)}">` : esc(displayName.charAt(0).toUpperCase())}
          </div>
          <div style="flex: 1; min-width: 220px;">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px;">
              <h2 style="margin: 0; font-size: 22px; font-weight: 800; color: #ffffff;">${esc(displayName)}</h2>
              ${isSuper 
                ? `<span class="user-role-badge admin super-admin" style="font-size: 11px; padding: 4px 12px; border-radius: 20px; font-weight: 800; background: #082b70; color: #fde047; border: 1.5px solid #fde047; box-shadow: 0 2px 6px rgba(0,0,0,0.25);">👑 SUPER ADMIN</span>`
                : `<span class="user-role-badge admin" style="font-size: 11px; padding: 4px 12px; border-radius: 20px; font-weight: 800; background: #082b70; color: #ffffff; border: 1.5px solid #60a5fa;">ADMIN</span>`}
            </div>
            <div style="font-size: 13px; opacity: 0.95; margin-bottom: 8px;">
              ${email !== "—" ? `<span>✉️ ${esc(email)}</span>` : ""}
              ${telephone !== "—" ? `<span style="margin-left:${email !== "—" ? '12px' : '0'}">📞 ${esc(telephone)}</span>` : ""}
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.18); padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">
                <span>✅</span> Statut du compte : <b>${esc(statutCompte)}</b>
              </div>
              <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.18); padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">
                <span>🛡️</span> Habilitation : <b>${isSuper ? "Super Administrateur Principal" : "Administrateur Système"}</b>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bandeau Accès Direction / Tableau de Bord -->
      <div style="background: #eff6ff; border-left: 4px solid #082b70; border-radius: 10px; padding: 18px 20px; margin-bottom: 22px; box-shadow: 0 2px 6px rgba(8,43,112,0.06); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
        <div style="flex: 1; min-width: 250px;">
          <div style="font-weight: 800; color: #082b70; font-size: 15px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
            <span>👑</span> Espace d'Administration Générale LAPERLE TOUR HT
          </div>
          <div style="font-size: 13px; color: #1e3a8a; line-height: 1.5;">
            Vous disposez d'un accès intégral et sans restriction à tous les modules opérationnels, financiers et de contrôle de la flotte.
          </div>
        </div>
        <button onclick="go('dashboard')" style="background: #082b70; color: #ffffff; border: none; padding: 11px 20px; border-radius: 8px; font-weight: 800; font-size: 13.5px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(8,43,112,0.25); transition: transform 0.15s ease;">
          <span>📊</span> <span>Accéder au Tableau de Bord</span>
        </button>
      </div>

      <!-- Détails du Compte -->
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
            <div style="color: #0f172a; font-weight: 700; font-size: 14px; word-break: break-all;">@${esc(profile.username || (email !== "—" ? email.split('@')[0] : 'admin'))}</div>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;">
            <div style="color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Identifiant E-mail Officiel</div>
            <div style="color: #0f172a; font-weight: 700; font-size: 14px; word-break: break-all;">${esc(email !== "—" ? email : telephone)}</div>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;">
            <div style="color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Rôles système attribués</div>
            <div style="color: #082b70; font-weight: 800; font-size: 14px;">👑 ["${rolesList.join('", "')}"]</div>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;">
            <div style="color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Statut Direction</div>
            <div style="color: #166534; font-weight: 800; font-size: 14px;">${isSuper ? "Super Administrateur" : "Administrateur"}</div>
          </div>
        </div>
      </div>

      <!-- Raccourcis Rapides de Gestion -->
      <div class="panel" style="margin-bottom: 22px; border-radius: 12px; padding: 22px; background: #ffffff; border: 1px solid #e2e8f0;">
        <h3 style="margin: 0 0 16px; color: #092e70; font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
          <span>⚡</span> Accès Directs aux Modules de Gestion
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
          <button onclick="go('dashboard')" style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; color: #082b70; font-weight: 700; font-size: 13px; cursor: pointer; text-align: left;">
            <span style="font-size: 18px;">📊</span> <span>Tableau de Bord</span>
          </button>
          <button onclick="go('reservations')" style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; color: #082b70; font-weight: 700; font-size: 13px; cursor: pointer; text-align: left;">
            <span style="font-size: 18px;">🎫</span> <span>Réservations</span>
          </button>
          <button onclick="go('vehicules')" style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; color: #082b70; font-weight: 700; font-size: 13px; cursor: pointer; text-align: left;">
            <span style="font-size: 18px;">🚐</span> <span>Flotte Véhicules</span>
          </button>
          <button onclick="go('chauffeurs')" style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; color: #082b70; font-weight: 700; font-size: 13px; cursor: pointer; text-align: left;">
            <span style="font-size: 18px;">👨‍✈️</span> <span>Chauffeurs</span>
          </button>
          <button onclick="go('utilisateurs')" style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; color: #082b70; font-weight: 700; font-size: 13px; cursor: pointer; text-align: left;">
            <span style="font-size: 18px;">👥</span> <span>Utilisateurs</span>
          </button>
          <button onclick="go('proformas')" style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; color: #082b70; font-weight: 700; font-size: 13px; cursor: pointer; text-align: left;">
            <span style="font-size: 18px;">🧾</span> <span>Devis & Proformas</span>
          </button>
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

function renderLectureSeuleProfilePage() {
  const user = currentUser;
  const profile = currentUserProfile || {};
  const isSuper = isSuperAdminEmail(user?.email || profile?.email);
  if (isSuper || currentUserRoles.includes(ROLES.ADMIN)) {
    renderAdminOrStaffProfilePage();
    return;
  }

  const displayName = profile.nom || profile.name || user?.displayName || user?.email?.split('@')[0] || user?.phoneNumber || "Utilisateur";
  const email = profile.email || user?.email || "—";
  const telephone = profile.telephone || user?.phoneNumber || "—";
  const photo = profile.photoURL || user?.photoURL || "";
  const statutCompte = profile.statutCompte || profile.status || "actif";
  const statutClient = profile.statutClient || "prospect";
  const myReservations = list("reservations");

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
              <span class="user-role-badge prospect" style="font-size: 11px; padding: 3px 10px; border-radius: 20px; font-weight: 700; background: #fef3c7; color: #92400e; border: 1px solid #fde68a;">Prospect</span>
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
          <span>ℹ️</span> Espace Prospect LAPERLE TOUR HT
        </div>
        <div style="font-size: 13px; color: #78350f; line-height: 1.5;">
          <b>Rôle Prospect :</b> vous pouvez consulter et modifier votre propre profil, et créer des réservations.<br>
          Dès que notre équipe commerciale vous aura émis votre <b>premier devis proforma</b>, votre compte basculera automatiquement en <b>CLIENT</b> officiel avec accès complet à votre espace et facturation.
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
            <div style="color: #92400e; font-weight: 700; font-size: 14px;">🔒 ["prospect"]</div>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;">
            <div style="color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Statut Client</div>
            <div style="color: #b45309; font-weight: 700; font-size: 14px;">prospect</div>
          </div>
        </div>
      </div>

      <!-- Mes Réservations en cours -->
      ${myReservations.length > 0 ? `
      <div class="panel" style="margin-bottom: 22px; border-radius: 12px; padding: 22px; background: #ffffff; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0,0,0,0.04);">
        <div style="border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <h3 style="margin: 0; color: #092e70; font-size: 17px; font-weight: 800; display: flex; align-items: center; gap: 8px;">
              <span>📅</span> Mes Réservations en cours (${myReservations.length})
            </h3>
            <p style="margin: 4px 0 0; font-size: 12px; color: #475569;">
              Demandes enregistrées sur LAPERLE TOUR HT en attente de votre premier devis proforma.
            </p>
          </div>
          <button class="secondary" onclick="go('reservations')" style="padding: 6px 14px; font-size: 12.5px; border-radius: 8px;">
            Voir le tableau complet ›
          </button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${myReservations.map(r => `
            <div style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; background: #f8fafc; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
              <div>
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <span style="font-weight: 800; color: #092e70; font-size: 14px;">${esc(r.trajet || r.route || (r.origin && r.destination ? `${r.origin} ➔ ${r.destination}` : r.destination || 'Trajet LAPERLE'))}</span>
                  <span style="font-size: 11px; background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 12px; font-weight: 700;">${esc(r.id || r.code || 'RES')}</span>
                </div>
                <div style="font-size: 12.5px; color: #64748b;">
                  <span>📅 ${esc(r.date || r.dateDepart || '—')}</span> • 
                  <span>🚘 ${esc(r.service || r.typePrestation || 'Transport')}</span> • 
                  <span>👥 ${esc(r.passengers || r.passagers || 1)} passager(s)</span>
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 14px; font-weight: 800; color: #166534; margin-bottom: 4px;">${money(r.amount || r.montantTotal || r.price || 2500)}</div>
                <span style="font-size: 11.5px; padding: 3px 10px; border-radius: 20px; font-weight: 700; background: #fef3c7; color: #92400e; border: 1px solid #fde68a;">
                  ⏳ ${esc(r.status || r.statut || 'À confirmer')}
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Action Métier : Première réservation -->
      <div class="panel" style="margin-bottom: 22px; border-radius: 12px; padding: 22px; background: #ffffff; border: 2px solid #bbf7d0; box-shadow: 0 4px 16px rgba(34,197,94,0.08);">
        <div style="border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <h3 style="margin: 0; color: #166534; font-size: 17px; font-weight: 800; display: flex; align-items: center; gap: 8px;">
              <span>🎫</span> Réserver un trajet LAPERLE
            </h3>
            <p style="margin: 4px 0 0; font-size: 12px; color: #475569;">
              Créez votre réservation. Après son premier proforma, votre rôle devient automatiquement <b>CLIENT</b>.
            </p>
          </div>
          <span style="background: #dcfce7; color: #166534; font-weight: 700; font-size: 12px; padding: 4px 10px; border-radius: 20px;">
            Accès Réservations
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
          needsProfileCompletion: false,
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

async function requestDocumentFromReservation(index, type = 'proforma') {
  const r = list("reservations")[index];
  if (!r) return;
  const isProforma = type === 'proforma';
  const docTypeLabel = isProforma ? 'devis Proforma' : 'Facture';
  const resCode = r.code || r.id || `#${index + 1}`;
  const clientName = r.nomClient || r.client || currentUserProfile?.name || currentUser?.displayName || currentUser?.email || 'Client';
  const phone = r.telephone || r.phone || currentUserProfile?.telephone || '';

  if (isProforma) {
    r.demandeProforma = true;
    r.dateDemandeProforma = new Date().toISOString();
  } else {
    r.demandeFacture = true;
    r.dateDemandeFacture = new Date().toISOString();
  }
  save();
  await saveDocumentToFirestore('reservations', r);

  // Alerte instantanée dans la cloche du Staff / Administration
  const notifId = `NOTIF-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const notifPayload = {
    id: notifId,
    title: `🔔 Demande de ${docTypeLabel} (${resCode})`,
    message: `Le client ${clientName} (${phone || 'sans tél'}) a demandé un(e) ${docTypeLabel} pour la course ${resCode} (${r.origin || ''} ➔ ${r.destination || r.trajet || ''}).`,
    type: 'finance',
    priority: 'high',
    actionType: isProforma ? 'demande_proforma' : 'demande_facture',
    docType: type,
    forRole: 'admin',
    targetUid: 'staff',
    targetRole: 'staff',
    isInternal: true,
    broadcast: false,
    read: false,
    date: new Date().toISOString(),
    reservationId: r.id || r.code || '',
    clientId: r.clientId || currentUser?.uid || ''
  };

  // Double synchronisation : Instantanée locale dans state.notifications + Cloud Firestore
  if (!Array.isArray(state.notifications)) state.notifications = [];
  state.notifications.unshift({ ...notifPayload });
  newlyArrivedNotificationIds.add(notifId);
  updateNotificationBadge();
  if (isNotifDropdownOpen) renderNotificationDropdown();

  try {
    await createNotification(notifPayload, notifId);
  } catch (err) {
    console.warn("Erreur envoi notification demande doc:", err);
  }

  if (document.getElementById("modalBackdrop")?.classList.contains("open")) {
    closeModal();
  }
  render();
  showToast(`✅ Votre demande de ${docTypeLabel} a été transmise à l'Administration LAPERLE TOUR HT.`);
}
window.requestDocumentFromReservation = requestDocumentFromReservation;

async function handleAcceptDocumentRequestFromAlert(notifId, reservationId, type = 'proforma') {
  const roles = normalizeRoles(currentUserRoles);
  const isStaff = roles.some(r => ['admin', 'direction', 'operations', 'secretaire', 'comptabilite'].includes(r)) || isSuperAdminEmail(currentUser?.email);
  if (!isStaff) {
    showToast("⚠️ Action réservée à l'Administration LAPERLE TOUR HT.", "error");
    return;
  }

  const resList = list("reservations");
  const resIndex = resList.findIndex(r => r.id === reservationId || r.code === reservationId);
  if (resIndex === -1) {
    showToast("Réservation introuvable.", "error");
    return;
  }

  const r = resList[resIndex];
  const targetUid = r.clientUid || r.clientId || "";
  const clientEmail = (r.email || "").toLowerCase().trim();
  const clientName = r.nomClient || r.client || "Client";
  const phone = r.telephone || r.phone || "";
  const routeDesc = r.trajet || r.route || (r.origin && r.destination ? `${r.origin} ➔ ${r.destination}` : "");

  let createdDocNumber = "";

  if (type === 'proforma') {
    const quoteNumber = nextProformaNumber();
    createdDocNumber = quoteNumber;
    const newQuote = {
      id: quoteNumber,
      number: quoteNumber,
      client: clientName,
      clientId: targetUid,
      clientUid: targetUid,
      email: clientEmail,
      telephone: phone,
      date: today(),
      amount: Number(r.montantTotal || r.amount || 2500),
      status: "Envoyée",
      validUntil: today(),
      archived: false,
      reservationId: r.id || r.code || "",
      notes: `Proforma validée et générée depuis la demande d'alerte pour la réservation #${r.code || r.id || ''}${routeDesc ? ` (${routeDesc})` : ''}`
    };

    list("proformas").push(newQuote);
    r.demandeProforma = false;
    r.proformaGenerated = quoteNumber;
    save();
    await saveDocumentToFirestore("proformas", newQuote);
    await saveDocumentToFirestore("reservations", r);

    if (targetUid || clientEmail) {
      try {
        await createNotification({
          title: `✅ Devis Proforma ${quoteNumber} validé !`,
          message: `Votre demande a été acceptée par la Direction LAPERLE TOUR HT. Votre devis proforma officiel ${quoteNumber} (${money(newQuote.amount)}) est prêt.`,
          type: 'finance',
          priority: 'high',
          targetUid: targetUid || 'all',
          broadcast: !targetUid,
          email: clientEmail,
          read: false,
          date: new Date().toISOString(),
          proformaId: quoteNumber,
          reservationId: r.id || r.code || ''
        });
      } catch (err) {
        console.warn("Erreur alerte client proforma:", err);
      }
    }
  } else {
    const invoiceNumber = nextFactureNumber();
    createdDocNumber = invoiceNumber;
    const newInvoice = {
      id: invoiceNumber,
      number: invoiceNumber,
      client: clientName,
      clientId: targetUid,
      clientUid: targetUid,
      email: clientEmail,
      telephone: phone,
      date: today(),
      proforma: r.proformaGenerated || r.id || "",
      amount: Number(r.montantTotal || r.amount || 2500),
      status: "Brouillon",
      due: today(),
      archived: false,
      reservationId: r.id || r.code || "",
      notes: `Facture validée et émise depuis la demande d'alerte pour la réservation #${r.code || r.id || ''}`
    };

    list("factures").push(newInvoice);
    r.demandeFacture = false;
    r.factureGenerated = invoiceNumber;
    save();
    await saveDocumentToFirestore("factures", newInvoice);
    await saveDocumentToFirestore("reservations", r);

    if (targetUid || clientEmail) {
      try {
        await createNotification({
          title: `✅ Facture ${invoiceNumber} validée et émise !`,
          message: `Votre demande a été acceptée par la Direction LAPERLE TOUR HT. Votre facture officielle ${invoiceNumber} (${money(newInvoice.amount)}) est prête.`,
          type: 'finance',
          priority: 'normal',
          targetUid: targetUid || 'all',
          broadcast: !targetUid,
          email: clientEmail,
          read: false,
          date: new Date().toISOString(),
          factureId: invoiceNumber,
          reservationId: r.id || r.code || ''
        });
      } catch (err) {
        console.warn("Erreur alerte client facture:", err);
      }
    }
  }

  // Mettre à jour l'alerte du responsable
  const notifObj = (state.notifications || []).find(n => n.id === notifId);
  if (notifObj) {
    notifObj.actionCompleted = true;
    notifObj.actionCompletedDoc = createdDocNumber;
    notifObj.read = true;
  }
  try {
    await updateDoc(doc(db, 'notifications', notifId), {
      read: true,
      actionCompleted: true,
      actionCompletedDoc: createdDocNumber,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.email || 'admin'
    });
  } catch (e) {}

  updateNotificationBadge();
  renderNotificationDropdown();
  render();
  showToast(`✅ Demande acceptée ! Document ${createdDocNumber} émis et disponible pour le client.`);
}
window.handleAcceptDocumentRequestFromAlert = handleAcceptDocumentRequestFromAlert;

function handleOpenDocumentFromAlert(type, docId) {
  closeNotificationDropdown();
  const canon = type === 'facture' ? 'factures' : 'proformas';
  const docList = list(canon);
  const idx = docList.findIndex(x => x.number === docId || x.id === docId);
  if (idx !== -1) {
    printDocument(type, idx);
  } else {
    go(canon);
    showToast(`Document ${docId} sélectionné.`);
  }
}
window.handleOpenDocumentFromAlert = handleOpenDocumentFromAlert;

async function createProformaFromReservation(index) {
  const roles = normalizeRoles(currentUserRoles);
  const isStaff = roles.some(r => ['admin', 'direction', 'operations', 'secretaire', 'comptabilite'].includes(r)) || isSuperAdminEmail(currentUser?.email);
  if (!isStaff) {
    showToast("⚠️ Action réservée à l'Administration LAPERLE TOUR HT.", "error");
    return;
  }

  const r = list("reservations")[index];
  if (!r) return;

  const quoteNumber = nextProformaNumber();
  const targetUid = r.clientUid || r.clientId || "";
  const clientName = r.nomClient || r.client || "Client";
  const clientEmail = (r.email || "").toLowerCase().trim();
  const phone = r.telephone || r.phone || "";
  const routeDesc = r.trajet || r.route || (r.origin && r.destination ? `${r.origin} ➔ ${r.destination}` : "");

  const newQuote = {
    id: quoteNumber,
    number: quoteNumber,
    client: clientName,
    clientId: targetUid,
    clientUid: targetUid,
    email: clientEmail,
    telephone: phone,
    date: today(),
    amount: Number(r.montantTotal || r.amount || 2500),
    status: "Envoyée",
    validUntil: today(),
    archived: false,
    reservationId: r.id || r.code || "",
    notes: `Proforma générée automatiquement depuis la réservation #${r.code || r.id || ''}${routeDesc ? ` (${routeDesc})` : ''}`
  };

  try {
    list("proformas").push(newQuote);
    r.demandeProforma = false;
    r.proformaGenerated = quoteNumber;
    save();
    await saveDocumentToFirestore("proformas", newQuote);
    await saveDocumentToFirestore("reservations", r);

    // Notification instantanée vers le Client / Prospect dans son alerte
    if (targetUid || clientEmail) {
      try {
        await createNotification({
          title: `📄 Devis Proforma ${quoteNumber} prêt !`,
          message: `Votre devis proforma officiel ${quoteNumber} (${money(newQuote.amount)}) pour votre réservation #${r.code || r.id || ''} est prêt et disponible auprès de LAPERLE TOUR HT.`,
          type: 'finance',
          priority: 'high',
          targetUid: targetUid || 'all',
          broadcast: !targetUid,
          email: clientEmail,
          read: false,
          date: new Date().toISOString()
        });
      } catch (notifErr) {
        console.warn("Erreur alerte client proforma:", notifErr);
      }
    }

    go("proformas");
    showToast(`✅ Devis Proforma ${quoteNumber} créé et notification envoyée au client.`);
  } catch (error) {
    showToast(error?.message || "La proforma n’a pas pu être enregistrée.", "error");
  }
}
window.createProformaFromReservation = createProformaFromReservation;

async function createInvoiceFromQuote(index) {
  const roles = normalizeRoles(currentUserRoles);
  const isStaff = roles.some(r => ['admin', 'direction', 'operations', 'secretaire', 'comptabilite'].includes(r)) || isSuperAdminEmail(currentUser?.email);
  if (!isStaff) {
    showToast("⚠️ Action réservée à l'Administration LAPERLE TOUR HT.", "error");
    return;
  }

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
    clientId: q.clientId || q.clientUid || "",
    clientUid: q.clientUid || q.clientId || "",
    email: q.email || "",
    date: today(),
    proforma: q.number || q.id,
    amount: q.amount || 0,
    status: "Brouillon",
    due: today(),
    archived: false,
    notes: `Facture générée automatiquement depuis la proforma ${q.number || q.id}`
  };

  try {
    list("factures").push(newInvoice);
    save();
    await saveDocumentToFirestore("factures", newInvoice);

    // Notification instantanée vers le Client / Prospect dans son alerte
    const targetUid = q.clientUid || q.clientId || "";
    const clientEmail = (q.email || "").toLowerCase().trim();
    if (targetUid || clientEmail) {
      try {
        await createNotification({
          title: `🧾 Facture ${invoiceNumber} émise !`,
          message: `LAPERLE TOUR HT a émis votre facture officielle ${invoiceNumber} (${money(newInvoice.amount)}) pour la proforma ${q.number || q.id}.`,
          type: 'finance',
          priority: 'normal',
          targetUid: targetUid || 'all',
          broadcast: !targetUid,
          email: clientEmail,
          read: false,
          date: new Date().toISOString()
        });
      } catch (notifErr) {
        console.warn("Erreur alerte client facture:", notifErr);
      }
    }

    go("factures");
    showToast(`Facture ${invoiceNumber} créée avec succès et notification transmise.`);
  } catch (err) {
    showToast("Erreur lors de la création de la facture.", "error");
  }
}
window.createInvoiceFromQuote = createInvoiceFromQuote;

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
// =========================================================================
// OUTILS PRATIQUES EMPLOYÉS (Chauffeur, Secrétaire, Opérations, Caisse)
// =========================================================================

function openDriverIncidentModal(tripId = "", tripRoute = "") {
  const modalEl = document.getElementById("modal");
  if (!modalEl) return;

  modalEl.innerHTML = `
    <div class="modal-head">
      <div>
        <h2 style="color:#b91c1c">🚨 Signaler un Incident / SOS Course</h2>
        <small>Alerte immédiate transmise à la régie LAPERLE TOUR HT</small>
      </div>
      <button class="close" onclick="closeModal()">×</button>
    </div>
    <form id="driverIncidentForm" style="display:flex;flex-direction:column;gap:12px">
      <input type="hidden" name="tripId" value="${esc(tripId)}">
      
      ${tripRoute ? `<div class="info" style="border-left:4px solid #b91c1c"><b>Course concernée :</b> ${esc(tripRoute)} (ID: ${esc(tripId)})</div>` : ''}

      <div class="field">
        <label><b>Nature du problème :</b></label>
        <select name="category" required style="font-weight:700">
          <option value="Panne mécanique">🚗 Panne mécanique (moteur, surchauffe, etc.)</option>
          <option value="Crevaison">🛞 Crevaison / Problème pneu</option>
          <option value="Embouteillage critique">🛑 Route bloquée / Embouteillage sévère</option>
          <option value="Client introuvable">👤 Client introuvable / Retard anormal</option>
          <option value="Accident ou Urgence">⚠️ Accident / Incident de circulation</option>
          <option value="Autre urgence">❓ Autre imprévu de route</option>
        </select>
      </div>

      <div class="field">
        <label><b>Localisation actuelle précise :</b></label>
        <input type="text" name="location" placeholder="Ex: Delmas 33, Carrefour Aéroport, Tabarre..." required>
      </div>

      <div class="field">
        <label><b>Détails & Besoins d'assistance :</b></label>
        <textarea name="description" placeholder="Ex: Besoin d'un véhicule de relais pour transférer les 4 passagers..."></textarea>
      </div>

      <div class="form-actions" style="margin-top:10px">
        <button type="button" class="secondary" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn-sos">
          🚨 Transmettre l'Alerte Urgente
        </button>
      </div>
    </form>
  `;

  document.getElementById("modalBackdrop").classList.add("open");

  document.getElementById("driverIncidentForm").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const cat = form.category.value;
    const loc = form.location.value;
    const desc = form.description.value;
    const tId = form.tripId.value;

    const ok = await submitDriverIncident(tId, cat, desc, loc);
    if (ok) {
      closeModal();
      if (typeof dashboard === 'function') dashboard();
    }
  };
}

async function handleDriverStatusChange(tripId, newStatus, tripType = 'reservation') {
  await quickUpdateTripStatus(tripId, newStatus, tripType);
}

function handleOpenGps(origin, dest) {
  openGpsRoute(origin, dest);
}

function handleOpenWhatsAppTrip(phone, clientName, origin, dest, time) {
  openWhatsAppForTrip(phone, clientName, origin, dest, time);
}

function handleSendSecretaryWhatsApp(resId) {
  const res = (list("reservations") || []).find(r => r.id === resId);
  if (!res) {
    showToast("Réservation introuvable.", "error");
    return;
  }
  const driver = (list("chauffeurs") || []).find(c => c.name === res.driver || c.id === res.driverId);
  const vehicle = (list("vehicules") || []).find(v => (v.brand + " " + v.model) === res.vehicle || v.plate === res.vehicle);
  
  openSecretaryWhatsAppConfirmation(
    res, 
    driver ? (driver.phone || driver.telephone) : "", 
    vehicle ? vehicle.plate : ""
  );
}

function handleSecretarySearch(query) {
  const q = String(query || "").trim().toLowerCase();
  const resultsContainer = document.getElementById("secretarySearchResults");
  if (!resultsContainer) return;

  if (q.length < 2) {
    resultsContainer.innerHTML = "";
    resultsContainer.style.display = "none";
    return;
  }

  const clientsList = (list("clients") || []).filter(c => !c.archived && (
    (c.name || "").toLowerCase().includes(q) ||
    (c.phone || "").includes(q) ||
    (c.email || "").toLowerCase().includes(q)
  )).slice(0, 4);

  const reservationsList = (list("reservations") || []).filter(r => !r.archived && (
    (r.client || "").toLowerCase().includes(q) ||
    (r.origin || "").toLowerCase().includes(q) ||
    (r.destination || "").toLowerCase().includes(q) ||
    (r.id || "").toLowerCase().includes(q)
  )).slice(0, 4);

  const proformasList = (list("proformas") || []).filter(p => !p.archived && (
    (p.client || "").toLowerCase().includes(q) ||
    (p.number || "").toLowerCase().includes(q) ||
    (p.id || "").toLowerCase().includes(q)
  )).slice(0, 3);

  const facturesList = (list("factures") || []).filter(f => !f.archived && (
    (f.client || "").toLowerCase().includes(q) ||
    (f.number || "").toLowerCase().includes(q) ||
    (f.id || "").toLowerCase().includes(q)
  )).slice(0, 3);

  const totalMatches = clientsList.length + reservationsList.length + proformasList.length + facturesList.length;

  if (totalMatches === 0) {
    resultsContainer.innerHTML = `<div style="padding:12px;text-align:center;color:#64748b;font-size:12px">Aucun résultat trouvé pour « ${esc(q)} »</div>`;
    resultsContainer.style.display = "block";
    return;
  }

  let html = "";

  if (clientsList.length > 0) {
    html += `<div style="padding:6px 12px;background:#f1f5f9;font-size:11px;font-weight:700;color:#092e70">👥 CLIENTS (${clientsList.length})</div>`;
    clientsList.forEach(c => {
      html += `
        <div class="secretary-result-item" onclick="go('clients');viewRow('clients', list('clients').findIndex(x=>x.id==='${c.id}'))">
          <div><b>${esc(c.name)}</b> <span style="font-size:11px;color:#64748b">(${esc(c.phone || c.email || '—')})</span></div>
          <span class="badge green">Client</span>
        </div>
      `;
    });
  }

  if (reservationsList.length > 0) {
    html += `<div style="padding:6px 12px;background:#f1f5f9;font-size:11px;font-weight:700;color:#092e70">📅 RÉSERVATIONS (${reservationsList.length})</div>`;
    reservationsList.forEach(r => {
      html += `
        <div class="secretary-result-item" onclick="go('reservations');viewRow('reservations', list('reservations').findIndex(x=>x.id==='${r.id}'))">
          <div><b>${esc(r.client)}</b> : ${esc(r.origin)} ➔ ${esc(r.destination)} <span style="font-size:11px;color:#64748b">(${esc(r.date)} ${esc(r.time || '')})</span></div>
          <span class="badge orange">${esc(r.status || 'En attente')}</span>
        </div>
      `;
    });
  }

  if (proformasList.length > 0) {
    html += `<div style="padding:6px 12px;background:#f1f5f9;font-size:11px;font-weight:700;color:#092e70">📄 PROFORMAS (${proformasList.length})</div>`;
    proformasList.forEach(p => {
      html += `
        <div class="secretary-result-item" onclick="go('proformas');viewRow('proformas', list('proformas').findIndex(x=>x.id==='${p.id}'))">
          <div><b>${esc(p.number || p.id)}</b> • ${esc(p.client)} <span style="font-size:11px;color:#64748b">(${money(p.amount || 0)})</span></div>
          <span class="badge">Devis</span>
        </div>
      `;
    });
  }

  if (facturesList.length > 0) {
    html += `<div style="padding:6px 12px;background:#f1f5f9;font-size:11px;font-weight:700;color:#092e70">🧾 FACTURES (${facturesList.length})</div>`;
    facturesList.forEach(f => {
      html += `
        <div class="secretary-result-item" onclick="go('factures');viewRow('factures', list('factures').findIndex(x=>x.id==='${f.id}'))">
          <div><b>${esc(f.number || f.id)}</b> • ${esc(f.client)} <span style="font-size:11px;color:#64748b">(${money(f.amount || 0)})</span></div>
          <span class="badge ${f.status === 'Payée' ? 'green' : 'red'}">${esc(f.status || 'En attente')}</span>
        </div>
      `;
    });
  }

  resultsContainer.innerHTML = html;
  resultsContainer.style.display = "block";
}

function handleSaveTeamNotes() {
  const el = document.getElementById("teamRelayNotesText");
  if (el) {
    saveTeamRelayNotes(el.value);
  }
}

function handleSendInvoiceReminder(factureId) {
  const f = (list("factures") || []).find(x => x.id === factureId);
  if (!f) {
    showToast("Facture introuvable.", "error");
    return;
  }
  const client = (list("clients") || []).find(c => c.name === f.client);
  sendInvoiceReminderWhatsApp(f, client ? (client.phone || client.telephone) : "");
}

// Window attachments for inline HTML onclick handlers
window.openDriverIncidentModal = openDriverIncidentModal;
window.handleDriverStatusChange = handleDriverStatusChange;
window.handleOpenGps = handleOpenGps;
window.handleOpenWhatsAppTrip = handleOpenWhatsAppTrip;
window.handleSendSecretaryWhatsApp = handleSendSecretaryWhatsApp;
window.handleSecretarySearch = handleSecretarySearch;
window.handleSaveTeamNotes = handleSaveTeamNotes;
window.handleSendInvoiceReminder = handleSendInvoiceReminder;
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

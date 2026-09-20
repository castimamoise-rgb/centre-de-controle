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
  ROLES, ROLE_LABELS, STATUS_LABELS, SUPER_ADMIN_EMAIL, normalizeRole, normalizeStatus,
  canAccessModule, hasActionPermission, filterDataForUser,
  loginWithGoogle as authLoginGoogle, logoutUser as authLogout, subscribeAuthState,
  ensureUserProfile,
  getAllUsers, getUserById, updateUserRole, updateUserStatus, updateUserPermissions
} from './services/index.js';

const DBKEY = "LAPERLE_CENTRE_CONTROL_V3";
let currentUser = null;
let currentUserProfile = null;
let currentRole = ROLES.LECTURE_SEULE;
let firestoreUnsubscribers = [];
let isAuthInitialized = false;

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

function updateRoleBadge(role) {
  const badge = document.getElementById("headerUserRole");
  if (!badge) return;
  const safeRole = normalizeRole(role || currentRole);
  badge.textContent = ROLE_LABELS[safeRole] || safeRole.toUpperCase();
  badge.className = `user-role-badge ${safeRole}`;
}

// Check RBAC permissions using centralized permissionService
function hasPermission(action, moduleKey) {
  const canon = canonicalCol(moduleKey);
  return hasActionPermission(currentRole, canon, action, currentUserProfile?.permissions);
}

// Direct Firestore Persistence Functions
async function saveDocumentToFirestore(colKey, item) {
  const col = canonicalCol(colKey);
  const docId = String(item.number || item.id || Date.now());
  const now = new Date().toISOString();
  const userEmail = currentUser?.email || 'admin';

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
  try {
    showToast("Connexion avec votre compte Google...");
    await signInWithPopup(auth, googleProvider);
    closeModal();
    showToast("🎉 Connecté à Google Firebase !");
  } catch (err) {
    console.error("Erreur Google Auth:", err);
    showToast("Erreur de connexion : " + (err.message || "Annulé"));
  }
}

async function logoutUser() {
  try {
    await signOut(auth);
    closeModal();
    showToast("Déconnecté de Firebase.");
  } catch (err) {
    console.error("Erreur déconnexion:", err);
    showToast("Erreur lors de la déconnexion.");
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
        <div style="margin-top:4px"><b>Rôle actif :</b> <span class="user-role-badge ${currentRole}">${currentRole}</span></div>
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
        <button class="primary" style="background:#123c98" onclick="loginWithGoogle()">🔑 Se connecter avec Google</button>
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
    ["role", "Rôle", "select:ADMIN|DIRECTION|COMPTABILITE|OPERATIONS|LECTURE_SEULE"],
    ["status", "Statut du compte", "select:Actif|Suspendu|Inactif"],
    ["notes", "Notes d'habilitation", "textarea"]
  ]
};

// Initial state
let state = loadState();
let current = location.hash.slice(1) || "dashboard";

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
      { id: "castimamoise_gmail_com", name: "Moïse Castima", email: "castimamoise@gmail.com", role: "ADMIN", status: "Actif", notes: "Fondateur & Administrateur Principal" }
    ]
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(DBKEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) return parsed;
    }
  } catch (e) {}
  const initial = getInitialData();
  try { localStorage.setItem(DBKEY, JSON.stringify(initial)); } catch (e) {}
  return initial;
}

function save() {
  localStorage.setItem(DBKEY, JSON.stringify(state));
}

function list(k) {
  const canon = canonicalCol(k);
  if (!Array.isArray(state[canon])) state[canon] = [];
  return state[canon];
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
  NAV_SECTIONS.forEach(sec => {
    const header = document.createElement("div");
    header.className = "nav-section-title";
    header.textContent = sec.title;
    nav.appendChild(header);
    sec.items.forEach(key => {
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

const mobToggle = document.getElementById("mobileToggle");
if (mobToggle) mobToggle.onclick = () => document.getElementById("sidebar")?.classList.toggle("open");

window.addEventListener("hashchange", () => {
  current = location.hash.slice(1) || "dashboard";
  render();
});

// Real-time Firestore sync via onSnapshot respecting RBAC boundaries
function setupFirestoreListeners() {
  firestoreUnsubscribers.forEach(unsub => { try { unsub(); } catch (e) {} });
  firestoreUnsubscribers = [];

  if (!currentUser) return;
  const roleNorm = (currentRole || '').toLowerCase();
  if (roleNorm === 'inactif') return;

  // 1. CHAUFFEUR: Read ONLY assigned documents via indexed queries
  if (roleNorm === 'chauffeur') {
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

  // 2. CLIENT: Read ONLY own documents via indexed queries
  if (roleNorm === 'client') {
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

  // 3. ADMIN, DIRECTION, COMPTABILITE, SECRETAIRE, OPERATIONS, LECTURE_SEULE:
  const modulesToListen = ALL_MODULES.filter(colName => {
    // Only ADMIN can list 'utilisateurs' collection
    if (colName === 'utilisateurs') return roleNorm === 'admin';
    // Only authorized roles can see 'finances'
    if (colName === 'finances') return ['admin', 'direction', 'comptabilite', 'lecture_seule'].includes(roleNorm);
    // Comptabilite only listens to billing/finance/client context
    if (roleNorm === 'comptabilite') {
      return ['finances', 'factures', 'proformas', 'paiements', 'clients', 'abonnements', 'notifications'].includes(colName);
    }
    // Operations & Secretaire: no global finances
    if (['operations', 'secretaire'].includes(roleNorm)) {
      return !['finances'].includes(colName);
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

  // Non-admins listen only to their OWN utilisateur document
  if (roleNorm !== 'admin' && currentUser?.uid) {
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

  // Settings listener: only Admin and Direction
  if (['admin', 'direction'].includes(roleNorm)) {
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
  if (currentRole !== "ADMIN") return;
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

// Authentication state listener with RBAC initialization
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  const avatarEl = document.getElementById("headerAvatar");
  const nameEl = document.getElementById("headerUserName");

  if (user) {
    if (avatarEl) {
      if (user.photoURL) {
        avatarEl.innerHTML = `<img src="${user.photoURL}" class="user-avatar-img" alt="">`;
      } else {
        avatarEl.textContent = (user.displayName || user.email || "A").charAt(0).toUpperCase();
      }
    }
    if (nameEl) {
      nameEl.textContent = user.displayName?.split(" ")[0] || user.email?.split("@")[0] || "Utilisateur";
    }
    updateFirebaseBadge("connected");

    // Secure profile retrieval & initialization in Firestore
    try {
      currentUserProfile = await ensureUserProfile(user);
    } catch (e) {
      console.warn("Erreur profil utilisateur:", e?.message);
    }

    // Verify account status
    if (currentUserProfile && currentUserProfile.status === "inactif") {
      currentRole = "INACTIF";
      updateRoleBadge("Compte Inactif");
      showToast("Votre compte est désactivé. Veuillez contacter un administrateur.", "error");
      firestoreUnsubscribers.forEach(unsub => { try { unsub(); } catch (e) {} });
      firestoreUnsubscribers = [];
      render();
      return;
    }

    // Determine Role strictly from profile
    if (user.email === SUPER_ADMIN_EMAIL) {
      currentRole = "ADMIN";
    } else {
      currentRole = (currentUserProfile?.role || "LECTURE_SEULE").toUpperCase();
    }
    updateRoleBadge(currentRole);

    setupFirestoreListeners();
    if (currentRole === "ADMIN") {
      seedInitialDataToFirestoreIfEmpty();
    }
  } else {
    if (avatarEl) avatarEl.textContent = "?";
    if (nameEl) nameEl.textContent = "Non connecté";
    currentUser = null;
    currentUserProfile = null;
    currentRole = "LECTURE_SEULE";
    updateRoleBadge("Invité");
    updateFirebaseBadge("offline");
    firestoreUnsubscribers.forEach(unsub => { try { unsub(); } catch (e) {} });
    firestoreUnsubscribers = [];
  }
  render();
});

testConnection().then(ok => {
  if (ok) console.log("Firebase Firestore connected and verified.");
});

render();

function go(k) {
  document.getElementById("sidebar")?.classList.remove("open");
  current = k;
  location.hash = k;
  render();
}

function render() {
  updateNavBadges();
  document.querySelectorAll(".nav-item").forEach(x => {
    const key = x.dataset.key;
    x.classList.toggle("active", key === current || canonicalCol(key) === canonicalCol(current));
  });

  const canon = canonicalCol(current);
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
  const received = list("paiements").filter(x => ["Reçu", "Validé", "Payé"].includes(x.status)).reduce((s, x) => s + Number(x.amount || 0), 0);
  const spent = list("finances").reduce((s, x) => s + Number(x.amount || 0), 0);
  const toReceive = list("paiements").filter(x => ["En attente", "À recevoir"].includes(x.status)).reduce((s, x) => s + Number(x.amount || 0), 0);
  const commissions = list("finances").filter(x => String(x.category || '').toLowerCase().includes('chauffeur') || String(x.category || '').toLowerCase().includes('commission')).reduce((s, x) => s + Number(x.amount || 0), 0);
  const netProfit = received - spent;

  const adminName = currentUser ? (currentUser.displayName || currentUser.email.split('@')[0]) : "Castima";

  document.getElementById("page").innerHTML = `
    <div class="welcome">
      <div>
        <h2>👤 Bonjour, ${esc(adminName)} !</h2>
        <p>Centre de contrôle opérationnel et financier LAPERLE TOUR HT • Rôle : <span class="user-role-badge ${currentRole}">${currentRole}</span></p>
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
      ${kpi("💰", "CA Encaissé", money(received), "paiements")}
      ${kpi("⏳", "Paiements en attente", money(toReceive), "paiements")}
      ${kpi("📄", "Proformas", list("proformas").filter(x => !x.archived).length, "proformas")}
      ${kpi("🧾", "Factures", list("factures").filter(x => !x.archived).length, "factures")}
      ${kpi("🚗", "Chauffeurs", list("chauffeurs").filter(x => !x.archived).length, "chauffeurs")}
      ${kpi("🚙", "Véhicules", list("vehicules").filter(x => !x.archived).length, "vehicules")}
      ${kpi("🧾", "Dépenses globales", money(spent), "finances")}
      ${kpi("📊", "Bénéfice Net", money(netProfit), "reports")}
    </div>

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

    <div class="panel" style="margin-top:12px">
      <div class="panel-title">
        <h3>📄 Documents Commerciaux & Opérations LAPERLE</h3>
      </div>
      <div class="quick-list">
        <button onclick="go('proformas')">📄 Module Proformas (${list('proformas').filter(x => !x.archived).length} enregistrées) <b>›</b></button>
        <button onclick="go('factures')">🧾 Module Factures (${list('factures').filter(x => !x.archived).length} émises) <b>›</b></button>
        <button onclick="go('eleves')">🎒 Module Élèves & Transports scolaires (${list('eleves').filter(x => !x.archived).length} inscrits) <b>›</b></button>
        <button onclick="go('abonnements')">🎫 Module Abonnements (${list('abonnements').filter(x => !x.archived).length} actifs) <b>›</b></button>
        <button onclick="go('settings')">⚙️ Module Paramètres & Sauvegarde Cloud <b>›</b></button>
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
                  ${canEdit ? `<button class="tiny edit" onclick="openForm('${canon}',${i})">Modifier</button>` : ""}
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
      list(canon)[index] = obj;
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
      else if (canon === "utilisateurs") obj.id = (obj.email || "").toLowerCase().replace(/[^a-zA-Z0-9]/g, "_");

      list(canon).push(obj);
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
      ${currentRole === "ADMIN" ? `<button class="primary" style="background:#d93025;border-color:#d93025" onclick="executePermanentDelete('${canon}',${index})">🗑️ Supprimer définitivement</button>` : ""}
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
    item.archived = true;
    item.status = "Archivé";
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
    arr.splice(index, 1);
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

function openProfile() {
  const admin = localStorage.getItem("LAPERLE_ADMIN") || "Castima";
  const company = localStorage.getItem("LAPERLE_COMPANY") || "LAPERLE TOUR HT";
  const email = currentUser?.email || localStorage.getItem("LAPERLE_EMAIL") || "laperletourht@gmail.com";
  const isAuth = !!currentUser;

  document.getElementById("modal").innerHTML = `
    <div class="modal-head">
      <div>
        <h2>Profil Administrateur & Session</h2>
        <small>Centre de Contrôle LAPERLE TOUR HT</small>
      </div>
      <button class="close" onclick="closeModal()">×</button>
    </div>
    <div class="info"><b>Utilisateur connecté</b><br>${esc(currentUser?.displayName || admin)}</div>
    <div class="info" style="margin-top:8px"><b>Email</b><br>${esc(email)}</div>
    <div class="info" style="margin-top:8px"><b>Rôle actuel</b><br><span class="user-role-badge ${currentRole}">${currentRole}</span></div>
    <div class="info" style="margin-top:8px;border-left:4px solid #f7941d">
      <b>🔥 Base de données Google Cloud Firestore</b><br>
      ${isAuth ? `<span style="color:#187a43;font-weight:700">Connecté en direct :</span> ${esc(currentUser.email)}<br><small style="color:#64748b">Toutes les opérations sont enregistrées et synchronisées en direct.</small>` : `<span style="color:#64748b">Mode local. Connectez-vous avec Google pour activer la synchronisation permanente.</span>`}
    </div>
    <div class="form-actions" style="margin-top:14px;flex-wrap:wrap">
      <button class="secondary" onclick="closeModal();openFirebaseModal()">🔥 Statut Firestore</button>
      ${isAuth ? `<button class="secondary" style="color:#b42318;border-color:#fca5a5" onclick="logoutUser()">Se déconnecter</button>` : `<button class="primary green" onclick="loginWithGoogle()">🔑 Connexion Google</button>`}
      ${currentRole === "ADMIN" ? `<button class="secondary" onclick="closeModal();go('utilisateurs')">🛡️ Gérer les Rôles</button>` : ""}
      <button class="secondary" onclick="closeModal();go('settings')">⚙️ Paramètres</button>
      <button class="primary" onclick="closeModal()">Fermer</button>
    </div>
  `;
  document.getElementById("modalBackdrop").classList.add("open");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function reportsPage() {
  const rev = list("paiements").filter(x => ["Reçu", "Validé", "Payé"].includes(x.status)).reduce((s, x) => s + Number(x.amount || 0), 0);
  const exp = list("finances").reduce((s, x) => s + Number(x.amount || 0), 0);
  const comm = list("finances").filter(x => String(x.category || '').toLowerCase().includes('chauffeur') || String(x.category || '').toLowerCase().includes('commission')).reduce((s, x) => s + Number(x.amount || 0), 0);
  const net = rev - exp;
  const laperleRev = rev - comm;

  document.getElementById("page").innerHTML = `
    <div class="section-head">
      <div>
        <h2>📊 Rapports & Synthèse Financière</h2>
        <p>Calculs automatiques en temps réel basés sur les données Firestore.</p>
      </div>
      <button class="primary" onclick="exportData()">Exporter les données</button>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-icon">💰</div><div><small>Chiffre d'Affaires Encaissé</small><strong>${money(rev)}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">🧾</div><div><small>Dépenses Globales</small><strong>${money(exp)}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">👨‍✈️</div><div><small>Commissions Chauffeurs</small><strong>${money(comm)}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">💎</div><div><small>Revenus Nets LAPERLE</small><strong>${money(laperleRev)}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">📈</div><div><small>Bénéfice Net</small><strong>${money(net)}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">👥</div><div><small>Clients Actifs</small><strong>${list("clients").filter(x => !x.archived).length}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">🎒</div><div><small>Élèves Inscrits</small><strong>${list("eleves").filter(x => !x.archived).length}</strong></div></div>
      <div class="kpi"><div class="kpi-icon">🎫</div><div><small>Abonnements en cours</small><strong>${list("abonnements").filter(x => !x.archived).length}</strong></div></div>
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
            ${currentUser ? `✅ Connecté : ${esc(currentUser.email)} (Rôle : ${currentRole})` : '⚪ Mode local actif. Connectez-vous avec Google pour activer le Cloud.'}
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

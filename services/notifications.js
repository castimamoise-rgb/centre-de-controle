import { 
  db, 
  auth, 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  handleFirestoreError, 
  OperationType 
} from '../src/lib/firebase.js';

const COLLECTION_NAME = 'notifications';

export const DEFAULT_SERVICE_ALERTS = [
  {
    id: 'ALERT-METEO-01',
    title: 'Alerte Trafic & Réseau Routier',
    message: 'Circulation fluide sur les axes Delmas, Pétion-Ville et Aéroport. Tous les circuits touristiques et navettes scolaires circulent selon le planning normal.',
    type: 'service',
    priority: 'normal',
    targetUid: 'all',
    broadcast: true,
    read: false,
    date: new Date(Date.now() - 1000 * 60 * 15).toISOString()
  },
  {
    id: 'ALERT-FLOTTE-02',
    title: 'Mise à jour Flotte Laperle',
    message: 'Inspection technique et désinfection validées pour les minibus Toyota Coaster #04 et #07. Climatisation et suivi GPS opérationnels.',
    type: 'transport',
    priority: 'normal',
    targetUid: 'all',
    broadcast: true,
    read: false,
    date: new Date(Date.now() - 1000 * 60 * 45).toISOString()
  },
  {
    id: 'ALERT-SYSTEM-03',
    title: 'Mise à jour Système 3.0',
    message: 'Le Centre de Contrôle Laperle a activé la synchronisation des notifications et alertes de service en temps réel via Firebase Cloud.',
    type: 'update',
    priority: 'normal',
    targetUid: 'all',
    broadcast: true,
    read: false,
    date: new Date(Date.now() - 1000 * 60 * 120).toISOString()
  },
  {
    id: 'ALERT-MAINTENANCE-04',
    title: 'Alerte Maintenance Préventive',
    message: 'Contrôle des freins et vidange programmés pour le véhicule VIP Sedan #02 ce vendredi à 18h00.',
    type: 'alerte',
    priority: 'high',
    targetUid: 'all',
    broadcast: true,
    read: false,
    date: new Date(Date.now() - 1000 * 60 * 240).toISOString()
  }
];

export async function createNotification(data = {}, customId) {
  const id = customId || data.id || `NOTIF-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'system';

  // Standardisation stricte de l'aiguillage de destination
  const targetRole = data.targetRole || data.forRole || (data.targetUid === 'staff' || data.targetUid === 'admin' ? 'staff' : undefined);
  const targetUid = data.targetUid || data.clientId || data.clientUid || data.uid || data.userId || (data.broadcast ? 'all' : (targetRole ? 'staff' : 'all'));
  const isBroadcast = data.broadcast === true || (targetUid === 'all' && !targetRole);

  const payload = {
    ...data,
    id,
    title: (data.title || 'Information LAPERLE TOUR').trim().substring(0, 150),
    message: (data.message || '').trim().substring(0, 500),
    type: data.type || 'service', // 'service', 'alerte', 'update', 'transport', 'finance', 'info'
    priority: data.priority || 'normal', // 'urgent', 'high', 'normal', 'low'
    targetUid: targetUid,
    targetRole: targetRole || '',
    forRole: targetRole || '',
    clientId: data.clientId || (targetUid !== 'all' && targetUid !== 'staff' && targetUid !== 'admin' ? targetUid : ''),
    clientUid: data.clientUid || data.clientId || (targetUid !== 'all' && targetUid !== 'staff' && targetUid !== 'admin' ? targetUid : ''),
    broadcast: isBroadcast,
    date: data.date || now,
    read: data.read !== undefined ? data.read : false,
    link: data.link || '',
    proformaId: data.proformaId || '',
    factureId: data.factureId || '',
    reservationId: data.reservationId || '',
    vehiculeId: data.vehiculeId || '',
    senderUid: data.senderUid || auth.currentUser?.uid || 'system',
    senderName: data.senderName || auth.currentUser?.displayName || 'Direction LAPERLE',
    createdBy: data.createdBy || userEmail,
    updatedBy: userEmail,
    createdAt: data.createdAt || now,
    updatedAt: now
  };

  const cleanPayload = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) {
      cleanPayload[k] = v;
    }
  }

  try {
    await setDoc(doc(db, COLLECTION_NAME, id), cleanPayload, { merge: true });
    return cleanPayload;
  } catch (error) {
    console.warn(`[Notification write notice for ${id}]:`, error?.message);
    return cleanPayload;
  }
}

export async function getNotifications() {
  try {
    const snap = await getDocs(collection(db, COLLECTION_NAME));
    const list = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id }));
    list.sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime());
    return list;
  } catch (error) {
    console.warn("[getNotifications notice]:", error?.message);
    return [];
  }
}

export async function markNotificationRead(id) {
  try {
    const ref = doc(db, COLLECTION_NAME, id);
    await updateDoc(ref, {
      read: true,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.currentUser?.email || 'user'
    });
  } catch (error) {
    console.warn(`[markNotificationRead notice for ${id}]:`, error?.message);
  }
}

export async function markAllNotificationsRead(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return;
  const promises = notifications.map(n => {
    if (!n.read) {
      return markNotificationRead(n.id).catch(() => {});
    }
    return Promise.resolve();
  });
  await Promise.all(promises);
}

export async function deleteNotification(id) {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeNotifications(callback) {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items = [];
    snapshot.forEach(doc => items.push({ ...doc.data(), id: doc.id }));
    items.sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime());
    callback(items);
  }, (error) => {
    console.warn(`[Notifications Snapshot Warning]:`, error.message);
  });
}

export async function seedDefaultServiceAlerts() {
  try {
    const existing = await getNotifications();
    if (!existing || existing.length === 0) {
      console.log("[Notifications] Initializing default service alerts in Firestore...");
      for (const alert of DEFAULT_SERVICE_ALERTS) {
        await createNotification(alert, alert.id);
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn("[Notifications] Seeding check error:", err.message);
    return false;
  }
}

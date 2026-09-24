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

export async function createNotification(data, customId) {
  const id = customId || `NOTIF-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'system';

  const payload = {
    id,
    title: (data.title || 'Information LAPERLE TOUR').trim().substring(0, 150),
    message: (data.message || '').trim().substring(0, 500),
    type: data.type || 'service', // 'service', 'alerte', 'update', 'transport', 'finance', 'info'
    priority: data.priority || 'normal', // 'high', 'normal', 'low'
    targetUid: data.targetUid || 'all',
    broadcast: data.broadcast !== undefined ? data.broadcast : (data.targetUid === 'all' || !data.targetUid),
    date: data.date || now,
    read: data.read || false,
    link: data.link || '',
    createdBy: userEmail,
    updatedBy: userEmail,
    createdAt: data.createdAt || now,
    updatedAt: now
  };

  try {
    await setDoc(doc(db, COLLECTION_NAME, id), payload, { merge: true });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `${COLLECTION_NAME}/${id}`);
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
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
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
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
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

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
  OperationType,
  type Unsubscribe 
} from '../src/lib/firebase';

export interface NotificationData {
  id: string;
  title: string;
  message: string;
  date: string;
  read: boolean;
  type?: string;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  targetUid?: string;
  broadcast?: boolean;
  link?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'notifications';

export const DEFAULT_SERVICE_ALERTS: Partial<NotificationData>[] = [
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

export async function createNotification(data: Partial<NotificationData>, customId?: string): Promise<NotificationData> {
  const id = customId || `NOTIF-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'system';

  const payload: NotificationData = {
    id,
    title: (data.title || 'Information LAPERLE TOUR').trim().substring(0, 150),
    message: (data.message || '').trim().substring(0, 500),
    type: data.type || 'service',
    priority: data.priority || 'normal',
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

export async function getNotifications(): Promise<NotificationData[]> {
  try {
    const snap = await getDocs(collection(db, COLLECTION_NAME));
    const list: NotificationData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as NotificationData));
    list.sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime());
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), {
      read: true,
      updatedAt: new Date().toISOString(),
      updatedBy: auth.currentUser?.email || 'user'
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
  }
}

export async function markAllNotificationsRead(notifications: NotificationData[]): Promise<void> {
  if (!Array.isArray(notifications) || notifications.length === 0) return;
  const promises = notifications.map(n => {
    if (!n.read) {
      return markNotificationRead(n.id).catch(() => {});
    }
    return Promise.resolve();
  });
  await Promise.all(promises);
}

export async function deleteNotification(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTION_NAME}/${id}`);
  }
}

export function subscribeNotifications(callback: (items: NotificationData[]) => void): Unsubscribe {
  const colRef = collection(db, COLLECTION_NAME);
  return onSnapshot(colRef, (snapshot) => {
    const items: NotificationData[] = [];
    snapshot.forEach(doc => items.push({ ...doc.data(), id: doc.id } as NotificationData));
    items.sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime());
    callback(items);
  }, (error) => {
    console.warn(`[Notifications Snapshot Warning]:`, error.message);
  });
}

export async function seedDefaultServiceAlerts(): Promise<boolean> {
  try {
    const existing = await getNotifications();
    if (!existing || existing.length === 0) {
      for (const alert of DEFAULT_SERVICE_ALERTS) {
        await createNotification(alert, alert.id);
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn("[Notifications] Seeding check error:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

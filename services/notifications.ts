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
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const COLLECTION_NAME = 'notifications';

export async function createNotification(data: Partial<NotificationData>, customId?: string): Promise<NotificationData> {
  const id = customId || `NOTIF-${Date.now()}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'system';

  const payload: NotificationData = {
    id,
    title: data.title || 'Information LAPERLE TOUR',
    message: data.message || '',
    date: data.date || now,
    read: data.read || false,
    type: data.type || 'info',
    createdBy: userEmail,
    updatedBy: userEmail,
    createdAt: now,
    updatedAt: now
  };

  try {
    await setDoc(doc(db, COLLECTION_NAME, id), payload);
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
    callback(items);
  }, (error) => {
    console.warn(`[Notifications Snapshot Warning]:`, error.message);
  });
}

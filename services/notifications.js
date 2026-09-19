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

export async function createNotification(data, customId) {
  const id = customId || `NOTIF-${Date.now()}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'system';

  const payload = {
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

export async function getNotifications() {
  try {
    const snap = await getDocs(collection(db, COLLECTION_NAME));
    const list = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id }));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function markNotificationRead(id) {
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
    callback(items);
  }, (error) => {
    console.warn(`[Notifications Snapshot Warning]:`, error.message);
  });
}

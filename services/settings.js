import { 
  db, 
  auth, 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot, 
  handleFirestoreError, 
  OperationType 
} from '../src/lib/firebase.js';

const COLLECTION_NAME = 'settings';
const DOC_ID = 'company';

export const DEFAULT_COMPANY_SETTINGS = {
  id: DOC_ID,
  company: 'LAPERLE TOUR HT',
  slogan: "Un coup d'œil sur Haïti",
  phone: '+509 4440-8687',
  whatsapp: '+509 4440-8687',
  email: 'direction@laperletour.ht',
  address: 'Pétion-Ville & Port-au-Prince, Haïti',
  currency: 'HTG',
  notes: 'Transport • Tourisme • Location • Abonnement scolaire et entreprises • Taxi privé',
  updatedAt: new Date().toISOString(),
  updatedBy: 'system'
};

export async function getCompanySettings() {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, DOC_ID));
    if (d.exists()) {
      return { ...DEFAULT_COMPANY_SETTINGS, ...d.data(), id: DOC_ID };
    }
    return DEFAULT_COMPANY_SETTINGS;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${DOC_ID}`);
  }
}

export async function saveCompanySettings(data) {
  const userEmail = auth.currentUser?.email || 'admin';
  const payload = {
    ...DEFAULT_COMPANY_SETTINGS,
    ...data,
    id: DOC_ID,
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail
  };
  try {
    await setDoc(doc(db, COLLECTION_NAME, DOC_ID), payload, { merge: true });
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${DOC_ID}`);
  }
}

export function subscribeCompanySettings(callback) {
  return onSnapshot(doc(db, COLLECTION_NAME, DOC_ID), (snapshot) => {
    if (snapshot.exists()) {
      callback({ ...DEFAULT_COMPANY_SETTINGS, ...snapshot.data(), id: DOC_ID });
    } else {
      callback(DEFAULT_COMPANY_SETTINGS);
    }
  }, (error) => {
    console.warn(`[Settings Snapshot Warning]:`, error.message);
  });
}

import { 
  db, 
  auth, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  query, 
  where, 
  handleFirestoreError, 
  OperationType 
} from '../../src/lib/firebase';

export interface ChauffeurData {
  id?: string;
  name: string;
  phone: string;
  address?: string;
  status?: string;
  vehicle?: string;
  commission?: number;
  documents?: string;
  joinedDate?: string;
  notes?: string;
  history?: string;
  archived?: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

const COLLECTION_NAME = 'chauffeurs';

export async function createChauffeur(data: Omit<ChauffeurData, 'id'>, customId?: string): Promise<ChauffeurData> {
  const id = customId || `CH-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();
  const userEmail = auth.currentUser?.email || 'admin';
  
  const payload: ChauffeurData = {
    ...data,
    id,
    commission: Number(data.commission) || 30,
    status: data.status || 'Disponible',
    archived: false,
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

export async function getChauffeurs(includeArchived = false): Promise<ChauffeurData[]> {
  try {
    const q = includeArchived 
      ? collection(db, COLLECTION_NAME)
      : query(collection(db, COLLECTION_NAME), where('archived', '==', false));
    const snap = await getDocs(q);
    const list: ChauffeurData[] = [];
    snap.forEach(d => list.push({ ...d.data(), id: d.id } as ChauffeurData));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

export async function getChauffeur(id: string): Promise<ChauffeurData | null> {
  try {
    const d = await getDoc(doc(db, COLLECTION_NAME, id));
    if (!d.exists()) return null;
    return { ...d.data(), id: d.id } as ChauffeurData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${COLLECTION_NAME}/${id}`);
  }
}

export async function updateChauffeur(id: string, updates: Partial<ChauffeurData>): Promise<void> {
  const userEmail = auth.currentUser?.email || 'admin';
  const payload = {
    ...updates,
    updatedBy: userEmail,
    updatedAt: new Date().toISOString()
  };

  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTION_NAME}/${id}`);
  }
}

export async function archiveChauffeur(id: string): Promise<void> {
  return updateChauffeur(id, { archived: true, status: 'Inactif' });
}

export async function searchChauffeurs(term: string): Promise<ChauffeurData[]> {
  const all = await getChauffeurs(true);
  const lower = term.toLowerCase().trim();
  if (!lower) return all;
  return all.filter(c => 
    (c.name && c.name.toLowerCase().includes(lower)) ||
    (c.phone && c.phone.toLowerCase().includes(lower)) ||
    (c.vehicle && c.vehicle.toLowerCase().includes(lower)) ||
    (c.address && c.address.toLowerCase().includes(lower))
  );
}

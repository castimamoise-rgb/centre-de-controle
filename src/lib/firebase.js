import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore,
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc,
  deleteDoc, 
  collection, 
  query,
  where,
  orderBy,
  onSnapshot, 
  getDocFromServer,
  serverTimestamp
} from 'firebase/firestore';

export {
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocFromServer,
  serverTimestamp
};

export const firebaseConfig = {
  projectId: "pragmatic-port-83bk6",
  appId: "1:521694060859:web:ae2b6f370b00671486d71e",
  apiKey: "AIzaSyA5bY7uu74D7RyOcq-LnqFO84ggIVQXRfs",
  authDomain: "pragmatic-port-83bk6.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-centredecontrole-21d992ae-a8b2-4e21-be4f-d17f771ab5bf",
  storageBucket: "pragmatic-port-83bk6.firebasestorage.app",
  messagingSenderId: "521694060859",
  measurementId: "",
  oAuthClientId: "521694060859-5870t8r8325vm6f4fi3t3r59bf71ems8.apps.googleusercontent.com",
  recaptchaSiteKey: ""
};

export const app = initializeApp(firebaseConfig);
try {
  initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, firebaseConfig.firestoreDatabaseId);
} catch (e) {
  // If already initialized, getFirestore will return the existing instance
}
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firebase Firestore connected successfully.");
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
    return false;
  }
}

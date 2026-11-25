// Punto de entrada para empaquetar Firebase + DOMPurify en public/vendor/.
// Regenerar con:  cd tools && npm install && npm run vendor
export { initializeApp } from 'firebase/app';
export {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
  sendPasswordResetEmail
} from 'firebase/auth';
export {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  memoryLocalCache, collection, doc, setDoc, updateDoc, deleteDoc, getDoc,
  getDocs, getDocsFromCache, onSnapshot, query, where, writeBatch,
  serverTimestamp, terminate, clearIndexedDbPersistence, Timestamp
} from 'firebase/firestore';
export { default as DOMPurify } from 'dompurify';

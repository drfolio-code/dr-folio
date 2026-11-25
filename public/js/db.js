// Conexión con Firebase: login, modo de dispositivo y base de datos
import {
  initializeApp, getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence, browserSessionPersistence, sendPasswordResetEmail,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  terminate, clearIndexedDbPersistence
} from '../vendor/libs.js';
import { firebaseConfig } from './config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = 'es';

export let db = null;

// Modo del dispositivo: 'trusted' (tu móvil/PC) o 'public' (ordenador compartido)
const MODE_KEY = 'drfolio.mode';
export function getMode() {
  return sessionStorage.getItem(MODE_KEY) || localStorage.getItem(MODE_KEY) || 'trusted';
}
function setMode(mode) {
  localStorage.removeItem(MODE_KEY);
  sessionStorage.removeItem(MODE_KEY);
  (mode === 'public' ? sessionStorage : localStorage).setItem(MODE_KEY, mode);
}

export const onAuth = (cb) => onAuthStateChanged(auth, cb);

export async function login(email, password, isPublic) {
  await setPersistence(auth, isPublic ? browserSessionPersistence : browserLocalPersistence);
  setMode(isPublic ? 'public' : 'trusted');
  return signInWithEmailAndPassword(auth, email, password);
}

export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

/** Inicializa Firestore: con copia offline en dispositivos de confianza, solo en memoria en públicos */
export function initDb() {
  if (db) return db;
  const publicMode = getMode() === 'public';
  db = initializeFirestore(app, {
    localCache: publicMode
      ? memoryLocalCache()
      : persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
  return db;
}

/** Cierra sesión y borra la copia local de los datos de este navegador */
export async function logout() {
  try { await signOut(auth); } catch (e) { console.warn(e); }
  if (db) {
    try { await terminate(db); } catch (e) { console.warn(e); }
    try { await clearIndexedDbPersistence(db); } catch (e) { console.warn(e); }
  }
  localStorage.removeItem(MODE_KEY);
  sessionStorage.clear();
  // La caché del service worker solo guarda la app (HTML/JS), nunca notas.
}

/** Traduce errores de Firebase a mensajes en español */
export function authError(e) {
  const code = e?.code || '';
  const map = {
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/wrong-password': 'Correo o contraseña incorrectos.',
    'auth/user-not-found': 'Correo o contraseña incorrectos.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
    'auth/network-request-failed': 'Sin conexión a internet.',
    'auth/user-disabled': 'Esta cuenta está desactivada.',
    'auth/missing-email': 'Escribe tu correo primero.'
  };
  return map[code] || `No se pudo completar (${code || e?.message || 'error'}).`;
}

// Configuración pública de Firebase (no es secreta: la seguridad la dan las reglas de Firestore).
export const firebaseConfig = {
  apiKey: "AIzaSyC0qlGsRUUX5TXWAJlEk_4JpHxijDJqqW8",
  authDomain: "drfolio-6af54.firebaseapp.com",
  projectId: "drfolio-6af54",
  storageBucket: "drfolio-6af54.firebasestorage.app",
  messagingSenderId: "488943404444",
  appId: "1:488943404444:web:0db86e4b849d1899277459"
};

// Único usuario autorizado (también fijado en firestore.rules).
export const OWNER_UID = "KCrZacB1H1ZdrxeBbiPuzd7Cp0N2";

// Súbela en cada cambio (y la de sw.js) para forzar la actualización en los dispositivos.
export const APP_VERSION = "1.11.3";

// Límites
export const LIMITS = {
  quotaBytes: 1024 * 1024 * 1024,   // 1 GB plan Spark
  maxFileBytes: 25 * 1024 * 1024,   // tamaño máximo de un adjunto
  chunkBytes: 700 * 1024,           // trozo binario por documento (base64 < 1 MiB)
  imageMaxSide: 1600,
  imageTargetBytes: 350 * 1024
};

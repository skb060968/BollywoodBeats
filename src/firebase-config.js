/**
 * Firebase initialization for Bollywood Beats multiplayer.
 * Authentication is ready before any room operation is attempted.
 */

import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

export const authReady = new Promise((resolve, reject) => {
  const unsubscribe = onAuthStateChanged(auth, async (user) => {
    unsubscribe();
    if (user) {
      resolve(user);
      return;
    }

    try {
      const credential = await signInAnonymously(auth);
      resolve(credential.user);
    } catch (error) {
      reject(error);
    }
  }, reject);
});
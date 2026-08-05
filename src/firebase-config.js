/**
 * Firebase initialization for Bollywood Beats multiplayer.
 * Authentication is ready before any room operation is attempted.
 */

import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyD87l2vtWyiwoH3IV5hdvA2e1QQd3CeOXU',
  authDomain: 'snakes-and-ladders3d.firebaseapp.com',
  databaseURL: 'https://snakes-and-ladders3d-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'snakes-and-ladders3d',
  storageBucket: 'snakes-and-ladders3d.firebasestorage.app',
  messagingSenderId: '954516346847',
  appId: '1:954516346847:web:7bcb2989c8b64986c2d66a',
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
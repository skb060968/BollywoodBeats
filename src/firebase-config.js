/**
 * Firebase Configuration for BollywoodBeats Multiplayer
 * Uses the same Firebase project as Card Games
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyD87l2vtWyiwoH3IV5hdvA2e1QQd3CeOXU",
  authDomain: "snakes-and-ladders3d.firebaseapp.com",
  databaseURL: "https://snakes-and-ladders3d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "snakes-and-ladders3d",
  storageBucket: "snakes-and-ladders3d.firebasestorage.app",
  messagingSenderId: "954516346847",
  appId: "1:954516346847:web:7bcb2989c8b64986c2d66a"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

// Sign in anonymously
signInAnonymously(auth).catch((err) => console.error("Firebase Auth error:", err));

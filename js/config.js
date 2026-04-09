// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-analytics.js";
// Auth と Firestore も追加
import { getAuth } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBJiL26c9nvZNyjKkEcoWHFaZQR2VSxVuQ",
  authDomain: "kometaro-x.firebaseapp.com",
  projectId: "kometaro-x",
  storageBucket: "kometaro-x.firebasestorage.app",
  messagingSenderId: "889271140667",
  appId: "1:889271140667:web:9d6d2c843db81ad209371e",
  measurementId: "G-XTRHRDWKE5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, analytics, auth, db };
// ============================================================
// Firebase 設定ファイル
// Firebase コンソール (https://console.firebase.google.com) で
// プロジェクトを作成し、以下の値を置き換えてください
// ============================================================
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBJiL26c9nvZNyjKkEcoWHFaZQR2VSxVuQ",
  authDomain: "kometaro-x.firebaseapp.com",
  projectId: "kometaro-x",
  storageBucket: "kometaro-x.firebasestorage.app",
  messagingSenderId: "889271140667",
  appId: "1:889271140667:web:83bbdcbe5af10d5509371e",
  measurementId: "G-YN7KT387WF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
// ============================================================
// Firebase 設定ファイル
// Firebase コンソール (https://console.firebase.google.com) で
// プロジェクトを作成し、以下の値を置き換えてください
// ============================================================
<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-analytics.js";
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
    appId: "1:889271140667:web:9d6d2c843db81ad209371e",
    measurementId: "G-XTRHRDWKE5"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>
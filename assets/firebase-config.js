// ============================================================
// CRMAmseva — firebase-config.js
// Configuration réelle du projet Firebase "crmamseva".
// Utilise le SDK "compat" (balises <script>, pas de bundler nécessaire)
// pour rester cohérent avec le reste du projet (pas de build Node).
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyBF8jmUGakeMfAS7dhQYGacNOAWE12yRgM",
  authDomain: "crmamseva.firebaseapp.com",
  projectId: "crmamseva",
  storageBucket: "crmamseva.firebasestorage.app",
  messagingSenderId: "267734365992",
  appId: "1:267734365992:web:395ace0a4bfae77ab6421d",
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
// Storage désactivé pour l'instant (nécessite le plan payant Blaze depuis
// février 2026, décision d'Hélène de laisser ça de côté). Pour réactiver :
// décommenter la ligne ci-dessous une fois le projet passé en Blaze.
// const storage = firebase.storage();

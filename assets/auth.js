// ============================================================
// CRMAmseva — auth.js
// Connexion / inscription réelles via Firebase Auth + Firestore.
// ============================================================

document.querySelectorAll(".toggle-eye").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    btn.setAttribute("aria-label", isHidden ? "Masquer le mot de passe" : "Afficher le mot de passe");
  });
});

function afficherErreurLogin(message) {
  let box = document.getElementById("login-error");
  if (!box) {
    box = document.createElement("p");
    box.id = "login-error";
    box.style.color = "#A8402B";
    box.style.fontSize = "13px";
    box.style.marginTop = "-8px";
    box.style.marginBottom = "16px";
    document.getElementById("login-form").insertBefore(box, document.getElementById("login-form").firstChild);
  }
  box.textContent = message;
}

// Redirige selon le rôle stocké dans utilisateurs/{uid}
async function redirigerSelonRole(uid) {
  try {
    const doc = await db.collection("utilisateurs").doc(uid).get();
    if (!doc.exists) {
      // Pas un compte interne : peut-être un compte portail client
      const doePortail = await db.collection("utilisateurs_portail").doc(uid).get();
      if (doePortail.exists) {
        window.location.href = "portail-client.html";
        return;
      }
      afficherErreurLogin("Compte connecté mais aucune fiche utilisateur trouvée. Contacte un administrateur.");
      await auth.signOut();
      return;
    }
    const role = doc.data().role;
    if (role === "travailleur") {
      window.location.href = "espace-travailleur.html";
    } else {
      window.location.href = "dashboard.html";
    }
  } catch (err) {
    console.error(err);
    afficherErreurLogin("Erreur lors de la vérification du compte.");
  }
}

const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;

    try {
      const cred = await auth.signInWithEmailAndPassword(email, password);
      db.collection("utilisateurs").doc(cred.user.uid).update({ derniereConnexion: firebase.firestore.Timestamp.now() }).catch(() => {});
      await redirigerSelonRole(cred.user.uid);
    } catch (err) {
      console.error(err);
      const messages = {
        "auth/invalid-email": "Adresse email invalide.",
        "auth/user-disabled": "Ce compte a été désactivé.",
        "auth/user-not-found": "Aucun compte ne correspond à cet email.",
        "auth/wrong-password": "Mot de passe incorrect.",
        "auth/invalid-credential": "Email ou mot de passe incorrect.",
      };
      afficherErreurLogin(messages[err.code] || "Impossible de se connecter. Réessaie.");
    }
  });
}

// Si déjà connecté et qu'on est sur la page de connexion, redirige directement
auth.onAuthStateChanged((user) => {
  if (user && window.location.pathname.endsWith("index.html")) {
    redirigerSelonRole(user.uid);
  }
});

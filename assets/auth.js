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

const signupForm = document.getElementById("signup-form");
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const demande = {
      nom: document.getElementById("su-nom").value,
      prenom: document.getElementById("su-prenom").value,
      gsm: document.getElementById("su-gsm").value,
      email: document.getElementById("su-email").value,
      statut: "en_attente",
      dateCreation: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
      await db.collection("demandes_acces").add(demande);
      alert("Votre demande a bien été envoyée. Un administrateur va la valider prochainement.");
      signupForm.reset();
    } catch (err) {
      console.error(err);
      alert("Une erreur est survenue lors de l'envoi de la demande. Réessaie dans un instant.");
    }
  });
}

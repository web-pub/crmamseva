// ============================================================
// CRMAmseva — travailleur.js
// Espace restreint : pointage d'heures + prise de stock, connecté
// à Firestore. Un travailleur ne voit que ses propres pointages
// (voir firestore.rules) et le stock en lecture.
// ============================================================

let currentUser = null;
let STOCK_DATA = [];
let PROJETS_DATA = []; // simplifié : offres actives, sans les données commerciales

const LABELS_ROLE = { superadmin: "Super Admin", admin: "Admin", travailleur: "Travailleur" };

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;

  try {
    const doc = await db.collection("utilisateurs").doc(user.uid).get();
    const modules = doc.exists ? (doc.data().modulesAutorises || []) : [];
    appliquerModulesAutorises(modules);
  } catch (err) {
    console.error(err);
  }

  demarrerEcouteurs();
});

function appliquerModulesAutorises(modules) {
  const navItems = document.querySelectorAll("#travailleur-nav .nav-item");
  let premierAutorise = null;

  navItems.forEach((item) => {
    const module = item.dataset.module;
    const autorise = modules.includes(module);
    item.style.display = autorise ? "" : "none";
    if (autorise && !premierAutorise) premierAutorise = item;
  });

  if (!premierAutorise) {
    document.getElementById("no-module-msg").style.display = "block";
    document.querySelectorAll("main > section").forEach((s) => (s.style.display = "none"));
    return;
  }

  // Active la première vue autorisée (au cas où "Mon pointage" ne le serait pas)
  navItems.forEach((i) => i.classList.remove("active"));
  premierAutorise.classList.add("active");
  document.querySelectorAll("main > section").forEach((s) => (s.style.display = "none"));
  document.getElementById("view-" + premierAutorise.dataset.view).style.display = "block";
}

document.getElementById("btn-logout")?.addEventListener("click", () => auth.signOut());

function demarrerEcouteurs() {
  // Liste simplifiée des projets sur lesquels pointer : offres non perdues/abandonnées + une entrée "Tâches internes"
  db.collection("offres").onSnapshot((snap) => {
    PROJETS_DATA = snap.docs
      .filter((d) => !["perdue", "abandonnee"].includes(d.data().statut))
      .map((d) => ({ id: d.id, nom: d.data().numero || d.id }));
    PROJETS_DATA.push({ id: "INTERNE", nom: "Tâches internes / administratif" });
    remplirSelectsProjets();
  });

  db.collection("pointages")
    .where("uid", "==", currentUser.uid)
    .onSnapshot((snap) => {
      const pointages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderPointages(pointages);
    });

  db.collection("stock_articles").onSnapshot((snap) => {
    STOCK_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderStockTravailleur();
  });
}

function nomProjet(id) {
  return PROJETS_DATA.find((p) => p.id === id)?.nom || id;
}

function remplirSelectsProjets() {
  const options = PROJETS_DATA.map((p) => `<option value="${p.id}">${p.nom}</option>`).join("");
  const ptSelect = document.getElementById("pt-projet");
  const takeSelect = document.getElementById("take-projet");
  if (ptSelect) ptSelect.innerHTML = options;
  if (takeSelect) takeSelect.innerHTML = options;
}

function dateToJsDate(ts) {
  return ts?.toDate ? ts.toDate() : new Date(ts);
}

function renderPointages(pointages) {
  const tbody = document.querySelector("#pointages-table tbody");
  if (!tbody) return;
  tbody.innerHTML = [...pointages]
    .sort((a, b) => dateToJsDate(b.date) - dateToJsDate(a.date))
    .map((p) => `
      <tr>
        <td>${dateToJsDate(p.date).toLocaleDateString("fr-BE")}</td>
        <td>${nomProjet(p.projetId)}</td>
        <td>${p.heures} h</td>
        <td>${p.description || "—"}</td>
        <td><span class="tag ${p.statut === "valide" ? "tag-client" : "tag-prospect"}">${p.statut === "valide" ? "Validé" : "En attente"}</span></td>
      </tr>
    `).join("");
}

function renderStockTravailleur() {
  const tbody = document.querySelector("#stock-travailleur-table tbody");
  if (!tbody) return;
  tbody.innerHTML = STOCK_DATA.map((s) => `
    <tr>
      <td>${s.reference}</td>
      <td>${s.designation}</td>
      <td>${s.quantiteStock}</td>
      <td>${s.quantiteStock <= s.seuilAlerte ? '<span class="tag tag-rupture">Stock bas</span>' : '<span class="tag tag-client">OK</span>'}</td>
      <td><button class="btn btn-secondary btn-take-stock" data-id="${s.id}" style="padding:5px 10px;font-size:12px;">Prendre</button></td>
    </tr>
  `).join("");

  document.querySelectorAll(".btn-take-stock").forEach((btn) => {
    btn.addEventListener("click", () => openTakeStockForm(btn.dataset.id));
  });
}

let articleEnCoursId = null;

function openTakeStockForm(articleId) {
  articleEnCoursId = articleId;
  const article = STOCK_DATA.find((a) => a.id === articleId);
  document.getElementById("take-stock-article").textContent = article.designation;
  document.getElementById("take-qte").value = 1;
  document.getElementById("take-qte").max = article.quantiteStock;
  document.getElementById("form-take-stock").style.display = "block";
  document.getElementById("take-stock-status").textContent = "";
}

document.getElementById("btn-cancel-take")?.addEventListener("click", () => {
  document.getElementById("form-take-stock").style.display = "none";
});

document.getElementById("btn-confirm-take")?.addEventListener("click", async () => {
  if (!articleEnCoursId) return;
  const qte = parseInt(document.getElementById("take-qte").value, 10) || 0;
  const projetId = document.getElementById("take-projet").value;
  const statusEl = document.getElementById("take-stock-status");
  const articleRef = db.collection("stock_articles").doc(articleEnCoursId);

  try {
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(articleRef);
      const dispo = doc.data().quantiteStock;
      if (qte <= 0 || qte > dispo) throw new Error("QUANTITE_INVALIDE");
      tx.update(articleRef, { quantiteStock: dispo - qte });
      tx.set(db.collection("stock_mouvements").doc(), {
        articleId: articleEnCoursId,
        type: "sortie",
        quantite: qte,
        motif: "utilisation_projet",
        projetId,
        uid: currentUser.uid,
        date: firebase.firestore.Timestamp.now(),
      });
    });
    document.getElementById("form-take-stock").style.display = "none";
    statusEl.textContent = `${qte} pièce(s) prélevée(s) pour ${nomProjet(projetId)}.`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = err.message === "QUANTITE_INVALIDE" ? "Quantité invalide ou insuffisante en stock." : "Erreur lors de la prise de stock.";
  }
});

document.getElementById("btn-save-pointage")?.addEventListener("click", async () => {
  const projetId = document.getElementById("pt-projet").value;
  const dateStr = document.getElementById("pt-date").value;
  const heures = parseFloat(document.getElementById("pt-heures").value);
  const description = document.getElementById("pt-description").value;

  if (!heures || heures <= 0) {
    alert("Merci d'indiquer un nombre d'heures valide.");
    return;
  }

  try {
    await db.collection("pointages").add({
      uid: currentUser.uid,
      projetId,
      date: dateStr ? firebase.firestore.Timestamp.fromDate(new Date(dateStr)) : firebase.firestore.Timestamp.now(),
      heures,
      description,
      statut: "en_attente",
    });
    document.getElementById("pt-heures").value = "";
    document.getElementById("pt-description").value = "";
  } catch (err) {
    console.error(err);
    alert("Impossible d'enregistrer ce pointage.");
  }
});

// ---------- Navigation (2 entrées) ----------
document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item[data-view]").forEach((i) => i.classList.remove("active"));
    item.classList.add("active");
    const target = item.dataset.view;
    document.querySelectorAll("main > section").forEach((s) => (s.style.display = "none"));
    document.getElementById("view-" + target).style.display = "block";
  });
});

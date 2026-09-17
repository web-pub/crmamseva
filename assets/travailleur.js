// ============================================================
// CRMAmseva — travailleur.js
// Espace restreint : pointage d'heures + prise de stock, connecté
// à Firestore. Un travailleur ne voit que ses propres pointages
// (voir firestore.rules) et le stock en lecture.
// ============================================================

let currentUser = null;
let MON_NOM = "";
let STOCK_DATA = [];
// Liste des projets/offres sur lesquels un travailleur peut pointer
// (nom simplifié, sans les infos commerciales du CRM)
let PROJETS_DATA = []; // une commande = un projet, + "Tâches internes"

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
    MON_NOM = doc.exists ? (doc.data().nom || "") : "";
    appliquerModulesAutorises(modules);
    enregistrerDansAnnuaire(user.uid, MON_NOM, "travailleur");
  } catch (err) {
    console.error(err);
  }

  demarrerEcouteurs();
  demarrerEcouteChat();
});

function appliquerModulesAutorises(modules) {
  const navItems = document.querySelectorAll("#travailleur-nav .nav-item");
  let premierAutorise = null;

  navItems.forEach((item) => {
    const module = item.dataset.module;
    if (!module) return; // ex. Chat : toujours visible, non soumis aux modules
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
  // Un projet = une commande (bon de commande), demande d'Hélène — plus une
  // entrée "Tâches internes" pour ce qui n'est lié à aucune commande précise
  db.collection("commandes").onSnapshot((snap) => {
    PROJETS_DATA = snap.docs.map((d) => ({ id: d.id, nom: d.data().numero || d.id }));
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

// ============================================================
// Chat — canal général + messages privés (identique au tableau de bord)
// ============================================================
let ANNUAIRE_DATA = [];
let conversationPriveeActuelle = null;
let arretEcouteChatPrive = null;
const LABELS_ROLE_CHAT = { superadmin: "Super Admin", admin: "Admin", direction: "Direction", manager: "Manager", commercial: "Commercial", travailleur: "Travailleur" };

function conversationId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

function enregistrerDansAnnuaire(uid, nom, role) {
  db.collection("annuaire").doc(uid).set({ nom, role }, { merge: true }).catch((err) => console.error("annuaire:", err));
}

function demarrerEcouteChat() {
  db.collection("annuaire").onSnapshot((snap) => {
    ANNUAIRE_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.id !== currentUser.uid);
    remplirSelectContacts();
  }, (err) => console.error("annuaire:", err));

  db.collection("chat_general").orderBy("date", "asc").limitToLast(100).onSnapshot((snap) => {
    renderChatGeneral(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => console.error("chat_general:", err));
}

function renderChatGeneral(messages) {
  const wrap = document.getElementById("chat-general-messages");
  if (!wrap) return;
  wrap.innerHTML = messages.length ? messages.map((m) => `
    <div class="chat-msg ${m.uid === currentUser.uid ? "mine" : ""}">
      ${m.uid !== currentUser.uid ? `<div class="chat-auteur">${m.nom || "?"}</div>` : ""}
      ${m.texte}
      <div class="chat-heure">${m.date ? dateToJsDate(m.date).toLocaleString("fr-BE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</div>
    </div>
  `).join("") : `<div class="chat-empty">Aucun message pour l'instant — lance la conversation !</div>`;
  wrap.scrollTop = wrap.scrollHeight;
}

document.getElementById("btn-send-general")?.addEventListener("click", async () => {
  const input = document.getElementById("chat-general-input");
  const texte = input.value.trim();
  if (!texte) return;
  try {
    await db.collection("chat_general").add({ uid: currentUser.uid, nom: MON_NOM || "Moi", texte, date: firebase.firestore.Timestamp.now() });
    input.value = "";
  } catch (err) {
    console.error(err);
    alert("Message non envoyé : " + (err.message || err.code || ""));
  }
});
document.getElementById("chat-general-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-send-general").click();
});

function remplirSelectContacts() {
  const select = document.getElementById("chat-contact-select");
  if (!select) return;
  select.innerHTML = ANNUAIRE_DATA.map((u) => `<option value="${u.id}">${u.nom} (${LABELS_ROLE_CHAT[u.role] || u.role})</option>`).join("") || `<option value="">Aucun collègue trouvé</option>`;
  if (ANNUAIRE_DATA.length && !conversationPriveeActuelle) ouvrirConversationPrivee(ANNUAIRE_DATA[0].id);
}
document.getElementById("chat-contact-select")?.addEventListener("change", (e) => ouvrirConversationPrivee(e.target.value));

function ouvrirConversationPrivee(uidContact) {
  if (!uidContact) return;
  conversationPriveeActuelle = uidContact;
  document.getElementById("chat-contact-select").value = uidContact;
  if (arretEcouteChatPrive) arretEcouteChatPrive();
  const cid = conversationId(currentUser.uid, uidContact);
  arretEcouteChatPrive = db.collection("chat_prive").doc(cid).collection("messages").orderBy("date", "asc").limitToLast(100)
    .onSnapshot((snap) => renderChatPrive(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (err) => console.error("chat_prive:", err));
}

function renderChatPrive(messages) {
  const wrap = document.getElementById("chat-prive-messages");
  if (!wrap) return;
  wrap.innerHTML = messages.length ? messages.map((m) => `
    <div class="chat-msg ${m.uid === currentUser.uid ? "mine" : ""}">
      ${m.texte}
      <div class="chat-heure">${m.date ? dateToJsDate(m.date).toLocaleString("fr-BE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</div>
    </div>
  `).join("") : `<div class="chat-empty">Aucun message avec cette personne pour l'instant.</div>`;
  wrap.scrollTop = wrap.scrollHeight;
}

document.getElementById("btn-send-prive")?.addEventListener("click", async () => {
  const input = document.getElementById("chat-prive-input");
  const texte = input.value.trim();
  if (!texte || !conversationPriveeActuelle) return;
  const cid = conversationId(currentUser.uid, conversationPriveeActuelle);
  try {
    await db.collection("chat_prive").doc(cid).collection("messages").add({ uid: currentUser.uid, texte, date: firebase.firestore.Timestamp.now() });
    input.value = "";
  } catch (err) {
    console.error(err);
    alert("Message non envoyé : " + (err.message || err.code || ""));
  }
});
document.getElementById("chat-prive-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-send-prive").click();
});

// ---------- Onglets du Chat (Général / Messages privés) ----------
document.querySelectorAll(".chat-tab-item").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".chat-tab-item").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".chat-tab-panel").forEach((p) => (p.style.display = "none"));
    document.getElementById("chattab-" + tab.dataset.chattab).style.display = "block";
  });
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

// ============================================================
// CRMAmseva — app.js
// Tableau de bord principal, connecté à Firestore en temps réel.
// ============================================================

const STAGES = [
  { key: "nouveau", label: "Nouveau" },
  { key: "qualifie", label: "Qualifié" },
  { key: "devis_envoye", label: "Devis envoyé(s)" },
  { key: "devis_accepte", label: "Devis accepté" },
  { key: "facture", label: "Facturé" },
  { key: "client_actif", label: "Client actif" },
];

const LABELS_STATUT_DEVIS = { brouillon: "Brouillon", envoye: "Envoyé", accepte: "Accepté", refuse: "Refusé", expire: "Expiré" };
const LABELS_PAIEMENT = { a_payer: "À payer", payee: "Payée", en_retard: "En retard" };
const LABELS_RAPPEL_TYPE = {
  relance_devis: "Relance devis",
  echeance_facture: "Échéance facture",
  prospect_inactif: "Prospect inactif",
  changement_etape: "Changement d'étape",
};
const LABELS_CANAL = { email: "Email", notification: "Notification", les_deux: "Email + notification" };
const LABELS_ROLE = {
  superadmin: "Super Admin", admin: "Admin", direction: "Direction",
  manager: "Manager", commercial: "Commercial", travailleur: "Travailleur",
};

// ---------- État courant (rempli par les écouteurs Firestore) ----------
let currentUser = null;
let currentRole = null;
let currentEquipeId = null;
let MON_NOM = "";

// "tout" = admin/superadmin/direction voient tout ; "equipe" = manager (son équipe) ;
// "perso" = commercial (ses propres dossiers uniquement)
let currentScope = "tout";

let OFFRES_DATA = [];
let LEADS_DATA = [];
let ACTIVITES_DATA = [];
let PLANS_DATA = [];
let PROSPECTS_DATA = [];
let DEVIS_DATA = [];
let COMMANDES_DATA = [];
let FACTURES_DATA = [];
let STOCK_DATA = [];
let RAPPELS_DATA = [];
let USERS_DATA = [];
let DELAIS_DATA = {}; // { etapeKey: jours }

// ============================================================
// Garde d'accès : redirige si non connecté, ou si rôle travailleur
// (le tableau de bord complet ne concerne pas ce rôle restreint)
// ============================================================
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  try {
    const doc = await db.collection("utilisateurs").doc(user.uid).get();
    if (!doc.exists) {
      alert("Aucune fiche utilisateur associée à ce compte. Contacte un administrateur.");
      await auth.signOut();
      return;
    }
    currentRole = doc.data().role;
    currentEquipeId = doc.data().equipeId || null;
    MON_NOM = doc.data().nom || "";

    if (currentRole === "travailleur") {
      window.location.href = "espace-travailleur.html";
      return;
    }

    currentScope = ["superadmin", "admin", "direction"].includes(currentRole) ? "tout"
      : currentRole === "manager" ? "equipe" : "perso";

    document.getElementById("role-badge").textContent = LABELS_ROLE[currentRole] || currentRole;
    document.getElementById("role-badge").className = "role-badge " + (currentRole === "superadmin" ? "super-admin" : currentRole);

    // L'onglet "mots de passe en clair" reste réservé au Super Admin
    if (currentRole !== "superadmin") {
      document.querySelector('.tab-item[data-tab="tab-passwords"]')?.remove();
    }

    // Masque les sections réservées selon le rôle connecté
    document.querySelectorAll('.nav-item[data-restrict="gestion"]').forEach((el) => {
      if (!["superadmin", "admin"].includes(currentRole)) el.remove();
    });
    document.querySelectorAll('.nav-item[data-restrict="tout"]').forEach((el) => {
      if (currentScope !== "tout") el.remove();
    });

    const libelleScope = currentScope === "tout" ? "Vue globale" : currentScope === "equipe" ? `Vue équipe — ${currentEquipeId || "?"}` : "Vue personnelle";
    document.querySelectorAll("#scope-badge-pipeline, #scope-badge-prospects, #scope-badge-leads, #scope-badge-activites, #scope-badge-reporting").forEach((el) => (el.textContent = libelleScope));

    demarrerEcouteursFirestore();
    enregistrerDansAnnuaire(currentUser.uid, MON_NOM, currentRole);
    demarrerEcouteChat();
  } catch (err) {
    console.error(err);
  }
});

document.getElementById("btn-logout")?.addEventListener("click", () => auth.signOut());

// Affiche un bandeau d'erreur visible en haut du contenu (au lieu de laisser
// une erreur Firestore invisible en console) — utile notamment si un index
// manque encore pour une requête filtrée (collectionGroup, etc.)
function afficherErreurGlobale(msg) {
  let bandeau = document.getElementById("erreur-globale");
  if (!bandeau) {
    bandeau = document.createElement("div");
    bandeau.id = "erreur-globale";
    bandeau.style.cssText = "position:sticky;top:0;z-index:50;background:var(--clay-soft);color:var(--clay);padding:10px 16px;border-radius:var(--radius);margin-bottom:16px;font-size:13px;";
    document.querySelector(".main-content")?.prepend(bandeau);
  }
  bandeau.textContent = msg;
  bandeau.style.display = "block";
}

// Applique le filtre de portée (tout / équipe / perso) à une requête Firestore
function avecPortee(query) {
  if (currentScope === "tout") return query;
  if (currentScope === "equipe") return query.where("equipeIds", "array-contains", currentEquipeId || "__aucune__");
  return query.where("responsablesUids", "array-contains", currentUser.uid);
}

// ============================================================
// Écouteurs Firestore temps réel
// ============================================================
function demarrerEcouteursFirestore() {
  avecPortee(db.collection("leads")).onSnapshot((snap) => {
    LEADS_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderLeads();
  }, (err) => console.error("leads:", err));

  avecPortee(db.collection("activites")).onSnapshot((snap) => {
    ACTIVITES_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderActivites();
  }, (err) => console.error("activites:", err));

  // Les plans-modèles sont lisibles par tous (pour être appliqués), gérés en écriture par peutTout()
  db.collection("plans_activites").onSnapshot((snap) => {
    PLANS_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPlans();
  }, (err) => console.error("plans_activites:", err));

  avecPortee(db.collection("prospects")).onSnapshot((snap) => {
    PROSPECTS_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderProspects();
    renderPipeline();
  }, (err) => { console.error("prospects:", err); afficherErreurGlobale("Erreur de chargement des prospects : " + err.message); });

  avecPortee(db.collection("offres")).onSnapshot((snap) => {
    OFFRES_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    remplirSelectOffres();
    renderPipeline();
  }, (err) => { console.error("offres:", err); afficherErreurGlobale("Erreur de chargement des offres : " + err.message); });

  avecPortee(db.collectionGroup("devis")).onSnapshot((snap) => {
    DEVIS_DATA = snap.docs.map((d) => ({ id: d.id, offreId: d.ref.parent.parent.id, ...d.data() }));
    renderDevis();
    renderPipeline();
  }, (err) => { console.error("devis:", err); afficherErreurGlobale("Erreur de chargement des devis : " + err.message + " — si le message parle d'index, vérifie qu'ils sont bien créés et \"Activé\" (pas \"En cours de création\") dans Firestore > Index."); });

  avecPortee(db.collection("commandes")).onSnapshot((snap) => {
    COMMANDES_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCommandes();
  }, (err) => console.error("commandes:", err));

  // Factures : lecture pour tout le monde selon sa portée (un Commercial voit
  // ses propres factures) ; création/modification reste réservée à peutTout()
  avecPortee(db.collection("factures")).onSnapshot((snap) => {
    FACTURES_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderFactures();
  }, (err) => console.error("factures:", err));

  if (currentScope === "tout") {
    db.collection("rappels").onSnapshot((snap) => {
      RAPPELS_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderRappels();
    });
  }

  // Lu par tout le monde (sauf travailleur/portail) : les seuils servent aussi au
  // calcul des notifications pour Commercial/Manager, pas seulement à l'admin
  db.collection("parametres_rappels").onSnapshot((snap) => {
    DELAIS_DATA = {};
    snap.docs.forEach((d) => (DELAIS_DATA[d.id] = d.data().jours));
    renderDelais();
    renderNotifications();
    renderCalendrier();
  });

  db.collection("pointages").where("uid", "==", currentUser.uid).onSnapshot((snap) => {
    MES_POINTAGES_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMesPointages();
  }, (err) => console.error("pointages:", err));

  if (["superadmin", "admin"].includes(currentRole)) {
    db.collection("pointages").onSnapshot((snap) => {
      TOUS_POINTAGES_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderToutesPointages();
    }, (err) => console.error("tous pointages:", err));
  }

  db.collection("stock_articles").onSnapshot((snap) => {
    STOCK_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderStock();
  });

  db.collection("utilisateurs").onSnapshot((snap) => {
    USERS_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderUsers();
    remplirSelectsResponsables();
  });
}

// ---------- Aides ----------
function getProspectNom(prospectId) {
  const p = PROSPECTS_DATA.find((x) => x.id === prospectId);
  return p ? (p.raisonSociale || p.nom || "Prospect") : "—";
}
function getOffre(offreId) {
  return OFFRES_DATA.find((o) => o.id === offreId);
}
function dateToJsDate(ts) {
  if (!ts) return null;
  return ts.toDate ? ts.toDate() : new Date(ts);
}
function joursDepuis(date) {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

// ============================================================
// Pipeline
// ============================================================
function renderPipeline() {
  const board = document.getElementById("pipeline-board");
  if (!board) return;
  board.innerHTML = "";

  let totalOffres = 0, devisEnvoyes = 0, clientsActifs = 0, rappelsEnRetard = 0;

  STAGES.forEach((stage, i) => {
    const offresForStage = OFFRES_DATA.filter((o) => o.etapePipeline === stage.key && o.statut !== "perdue" && o.statut !== "abandonnee");
    if (stage.key !== "client_actif") totalOffres += offresForStage.length;
    if (stage.key === "client_actif") clientsActifs = offresForStage.length;

    const col = document.createElement("div");
    col.className = "pipeline-stage";
    col.innerHTML = `
      <div class="stage-header ${offresForStage.length ? "active-stage" : ""}">
        <span class="step-index">${i + 1}</span>
        <span>${stage.label}</span>
        <span class="stage-count">${offresForStage.length}</span>
      </div>
      <div class="stage-cards"></div>
    `;
    const cardsWrap = col.querySelector(".stage-cards");

    offresForStage.forEach((o) => {
      const devisCount = DEVIS_DATA.filter((d) => d.offreId === o.id).length;
      if (stage.key === "devis_envoye") devisEnvoyes += devisCount;

      const historique = o.historiqueEtapes || [];
      const derniere = historique.length ? dateToJsDate(historique[historique.length - 1].date) : null;
      const delai = DELAIS_DATA[stage.key];
      const jours = joursDepuis(derniere);
      const enRetard = delai != null && jours != null && jours > delai;
      if (enRetard) rappelsEnRetard++;

      const card = document.createElement("div");
      card.className = "card-offre";
      card.innerHTML = `
        <div class="offre-ref">${o.numero || o.id}</div>
        <div class="offre-prospect">${getProspectNom(o.prospectId)}</div>
        <div class="offre-meta"><span>${devisCount} devis lié(s)</span><span>${(o.montantTTC || 0).toFixed(0)} € TTC</span></div>
        ${enRetard ? `<div class="reminder-flag">⏰ ${jours} j sans mouvement</div>` : ""}
        <button class="btn btn-secondary btn-edit-offre" data-id="${o.id}" style="padding:4px 8px;font-size:11px;margin-top:8px;">Modifier</button>
      `;
      card.querySelector(".btn-edit-offre").addEventListener("click", () => ouvrirFormOffre(o.id));
      cardsWrap.appendChild(card);
    });

    board.appendChild(col);
  });

  const grid = document.querySelector("#view-pipeline .stat-grid");
  if (grid) {
    grid.children[0].querySelector(".stat-value").textContent = rappelsEnRetard;
    grid.children[1].querySelector(".stat-value").textContent = totalOffres;
    grid.children[2].querySelector(".stat-value").textContent = devisEnvoyes;
    grid.children[3].querySelector(".stat-value").textContent = clientsActifs;
  }

  renderReporting();
  renderNotifications();
  renderCalendrier();
}

// ============================================================
// Reporting (KPI, sources marketing, performance par commercial)
// Calculé côté client à partir des données déjà chargées (donc déjà
// filtrées selon la portée de l'utilisateur : perso/équipe/globale)
// ============================================================
function formatEuro(n) {
  return (n || 0).toLocaleString("fr-BE", { maximumFractionDigits: 0 }) + " €";
}

// ============================================================
// Notifications (rappels, délais dépassés, relances) — calculées
// côté client à partir des données déjà chargées (déjà filtrées par portée)
// ============================================================
// ============================================================
// Mon pointage (feuille de temps) — ouvert à tous les rôles internes,
// pas seulement Travailleur. Une commande = un projet (demande d'Hélène).
// ============================================================
let MES_POINTAGES_DATA = [];
let TOUS_POINTAGES_DATA = [];

function remplirSelectCommandes() {
  const select = document.getElementById("pointage-commande");
  if (!select) return;
  const options = COMMANDES_DATA.map((c) => `<option value="${c.id}">${c.numero}</option>`).join("");
  select.innerHTML = options + `<option value="INTERNE">Tâches internes / administratif</option>`;
}

function nomCommande(commandeId) {
  if (commandeId === "INTERNE") return "Tâches internes";
  return COMMANDES_DATA.find((c) => c.id === commandeId)?.numero || commandeId;
}

function renderMesPointages() {
  const tbody = document.querySelector("#mes-pointages-table tbody");
  if (!tbody) return;
  tbody.innerHTML = [...MES_POINTAGES_DATA]
    .sort((a, b) => dateToJsDate(b.date) - dateToJsDate(a.date))
    .map((p) => `
      <tr>
        <td>${dateToJsDate(p.date).toLocaleDateString("fr-BE")}</td>
        <td>${nomCommande(p.commandeId)}</td>
        <td>${p.heures} h</td>
        <td>${p.description || "—"}</td>
        <td><span class="tag ${p.statut === "valide" ? "tag-client" : "tag-prospect"}">${p.statut === "valide" ? "Validé" : "En attente"}</span></td>
      </tr>
    `).join("") || `<tr><td colspan="5" class="required-note">Aucun pointage pour l'instant.</td></tr>`;
}

function renderToutesPointages() {
  const wrap = document.getElementById("toutes-pointages-wrap");
  const tbody = document.querySelector("#toutes-pointages-table tbody");
  if (!wrap || !tbody) return;
  if (!["superadmin", "admin"].includes(currentRole)) { wrap.style.display = "none"; return; }
  wrap.style.display = "block";

  tbody.innerHTML = [...TOUS_POINTAGES_DATA]
    .sort((a, b) => dateToJsDate(b.date) - dateToJsDate(a.date))
    .map((p) => `
      <tr>
        <td>${USERS_DATA.find((u) => u.id === p.uid)?.nom || p.uid}</td>
        <td>${dateToJsDate(p.date).toLocaleDateString("fr-BE")}</td>
        <td>${nomCommande(p.commandeId)}</td>
        <td>${p.heures} h</td>
        <td><span class="tag ${p.statut === "valide" ? "tag-client" : "tag-prospect"}">${p.statut === "valide" ? "Validé" : "En attente"}</span></td>
        <td>${p.statut === "valide" ? "" : `<button class="btn btn-secondary btn-valider-pointage" data-id="${p.id}" style="padding:5px 10px;font-size:12px;">Valider</button>`}</td>
      </tr>
    `).join("") || `<tr><td colspan="6" class="required-note">Aucun pointage pour l'instant.</td></tr>`;

  document.querySelectorAll(".btn-valider-pointage").forEach((btn) => {
    btn.addEventListener("click", () => db.collection("pointages").doc(btn.dataset.id).update({ statut: "valide" }).catch((err) => console.error(err)));
  });
}

document.getElementById("btn-save-pointage")?.addEventListener("click", async () => {
  const commandeId = document.getElementById("pointage-commande").value;
  const dateStr = document.getElementById("pointage-date").value;
  const heures = parseFloat(document.getElementById("pointage-heures").value);
  const description = document.getElementById("pointage-description").value;

  if (!heures || heures <= 0 || !dateStr) {
    alert("Merci d'indiquer une date et un nombre d'heures valide.");
    return;
  }

  try {
    await db.collection("pointages").add({
      uid: currentUser.uid,
      commandeId,
      date: firebase.firestore.Timestamp.fromDate(new Date(dateStr)),
      heures,
      description,
      statut: "en_attente",
    });
    document.getElementById("pointage-heures").value = "";
    document.getElementById("pointage-description").value = "";
  } catch (err) {
    console.error(err);
    alert("Impossible d'enregistrer ce pointage : " + (err.message || err.code || ""));
  }
});

// ============================================================
// Calendrier — Activités, échéances de devis, dates de commande
// ============================================================
let calDate = new Date();
calDate.setDate(1);

function memeJour(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function evenementsDuJour(jourDate) {
  const evts = [];
  ACTIVITES_DATA.forEach((a) => {
    if (a.dateEcheance && memeJour(dateToJsDate(a.dateEcheance), jourDate)) {
      evts.push({ type: a.type, titre: a.titre, detail: a.cibleId ? nomCible(a.cibleType, a.cibleId) : "", categorie: "activite" });
    }
  });
  DEVIS_DATA.forEach((d) => {
    if (d.statut === "envoye" && d.dateValidite && memeJour(dateToJsDate(d.dateValidite), jourDate)) {
      evts.push({ type: "devis", titre: `Devis ${d.reference} — expire`, detail: "", categorie: "devis" });
    }
  });
  COMMANDES_DATA.forEach((c) => {
    if (c.dateCommande && memeJour(dateToJsDate(c.dateCommande), jourDate)) {
      evts.push({ type: "commande", titre: `Commande ${c.numero}`, detail: getProspectNom(c.prospectId), categorie: "commande" });
    }
  });
  return evts;
}

function classeDot(type) {
  const map = { appel: "cal-dot-appel", email: "cal-dot-email", reunion: "cal-dot-reunion", tache: "cal-dot-tache", personnalisee: "cal-dot-tache", devis: "cal-dot-devis", commande: "cal-dot-commande" };
  return map[type] || "cal-dot-tache";
}

// ============================================================
// Chat — canal général + messages privés (1-à-1)
// ============================================================
let ANNUAIRE_DATA = [];
let conversationPriveeActuelle = null; // uid du contact sélectionné
let arretEcouteChatPrive = null; // fonction pour désabonner l'écouteur précédent

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
  }, (err) => { console.error("chat_general:", err); afficherErreurGlobale("Erreur de chargement du chat : " + err.message); });
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
  select.innerHTML = ANNUAIRE_DATA.map((u) => `<option value="${u.id}">${u.nom} (${LABELS_ROLE[u.role] || u.role})</option>`).join("") || `<option value="">Aucun collègue trouvé</option>`;
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
    .onSnapshot((snap) => renderChatPrive(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => { console.error("chat_prive:", err); afficherErreurGlobale("Erreur de chargement du message privé : " + err.message); });
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

function renderCalendrier() {
  const grid = document.getElementById("cal-grid");
  const label = document.getElementById("cal-mois-label");
  if (!grid || !label) return;

  const annee = calDate.getFullYear();
  const mois = calDate.getMonth();
  label.textContent = calDate.toLocaleDateString("fr-BE", { month: "long", year: "numeric" });

  const premierJourSemaine = (new Date(annee, mois, 1).getDay() + 6) % 7; // lundi = 0
  const nbJours = new Date(annee, mois + 1, 0).getDate();
  const aujourdhui = new Date();

  const noms = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  let html = noms.map((n) => `<div class="cal-daynames">${n}</div>`).join("");

  for (let i = 0; i < premierJourSemaine; i++) html += `<div class="cal-day cal-empty"></div>`;

  for (let jour = 1; jour <= nbJours; jour++) {
    const jourDate = new Date(annee, mois, jour);
    const evts = evenementsDuJour(jourDate);
    const estAujourdhui = memeJour(jourDate, aujourdhui);
    html += `
      <div class="cal-day ${estAujourdhui ? "cal-today" : ""}" data-jour="${jour}">
        <div class="cal-daynum">${jour}</div>
        <div class="cal-dots">${evts.slice(0, 6).map((e) => `<span class="cal-dot ${classeDot(e.type)}" title="${e.titre}"></span>`).join("")}</div>
      </div>`;
  }

  grid.innerHTML = html;
  grid.querySelectorAll(".cal-day[data-jour]").forEach((el) => {
    el.addEventListener("click", () => afficherJourCalendrier(parseInt(el.dataset.jour, 10)));
  });

  // Sélectionne aujourd'hui par défaut si on est dans le mois affiché
  if (annee === aujourdhui.getFullYear() && mois === aujourdhui.getMonth()) afficherJourCalendrier(aujourdhui.getDate());
  else document.getElementById("cal-jour-detail").innerHTML = "";
}

function afficherJourCalendrier(jour) {
  const jourDate = new Date(calDate.getFullYear(), calDate.getMonth(), jour);
  const evts = evenementsDuJour(jourDate);
  const detail = document.getElementById("cal-jour-detail");
  detail.innerHTML = `
    <div class="cal-jour-card">
      <h2 style="font-size:15px; margin-bottom:10px;">${jourDate.toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" })}</h2>
      ${evts.length ? evts.map((e) => `
        <div class="cal-event"><span class="cal-dot ${classeDot(e.type)}" style="margin-right:8px;"></span><strong>${e.titre}</strong>${e.detail ? " — " + e.detail : ""}</div>
      `).join("") : `<p class="required-note">Rien de prévu ce jour-là.</p>`}
    </div>`;
}

document.getElementById("cal-prev")?.addEventListener("click", () => {
  calDate.setMonth(calDate.getMonth() - 1);
});
document.getElementById("cal-next")?.addEventListener("click", () => {
  calDate.setMonth(calDate.getMonth() + 1);
});

function renderNotifications() {
  const list = document.getElementById("notifications-list");
  const badge = document.getElementById("notif-count");
  if (!list) return;

  const notifs = [];
  const maintenant = Date.now();

  // ---- Offres en retard à une étape du pipeline ----
  OFFRES_DATA.forEach((o) => {
    if (o.statut !== "en_cours" || o.etapePipeline === "client_actif") return;
    const historique = o.historiqueEtapes || [];
    const derniere = historique.length ? dateToJsDate(historique[historique.length - 1].date) : null;
    const delai = DELAIS_DATA[o.etapePipeline];
    const jours = derniere ? Math.floor((maintenant - derniere.getTime()) / 86400000) : null;
    if (delai != null && jours != null && jours > delai) {
      notifs.push({
        icone: "⏰", type: "Offre en retard",
        titre: `${o.numero || o.id} (${getProspectNom(o.prospectId)}) — ${jours} j sans mouvement à l'étape "${STAGES.find((s) => s.key === o.etapePipeline)?.label || o.etapePipeline}"`,
        vue: "pipeline",
      });
    }
  });

  // ---- Devis envoyés expirés ----
  DEVIS_DATA.forEach((d) => {
    if (d.statut !== "envoye" || !d.dateValidite) return;
    if (dateToJsDate(d.dateValidite).getTime() < maintenant) {
      notifs.push({
        icone: "📄", type: "Devis expiré",
        titre: `${d.reference} — validité dépassée, à relancer ou clôturer`,
        vue: "devis",
      });
    }
  });

  // ---- Activités en retard ----
  ACTIVITES_DATA.forEach((a) => {
    if (a.statut !== "a_faire" || !a.dateEcheance) return;
    if (dateToJsDate(a.dateEcheance).getTime() < maintenant) {
      notifs.push({
        icone: "✅", type: "Activité en retard",
        titre: `${LABELS_TYPE_ACTIVITE[a.type] || a.type} — "${a.titre}" (échéance dépassée)`,
        vue: "activites",
      });
    }
  });

  // ---- Prospects sans offre depuis trop longtemps (à relancer) ----
  const seuilProspect = DELAIS_DATA["prospect_inactif"] || 7;
  PROSPECTS_DATA.forEach((p) => {
    if (p.statut !== "prospect" || !p.dateCreation) return;
    const aUneOffre = OFFRES_DATA.some((o) => o.prospectId === p.id);
    if (aUneOffre) return;
    const jours = Math.floor((maintenant - dateToJsDate(p.dateCreation).getTime()) / 86400000);
    if (jours > seuilProspect) {
      notifs.push({
        icone: "📞", type: "Prospect à relancer",
        titre: `${p.raisonSociale || p.nom} — aucune offre depuis ${jours} j`,
        vue: "prospects",
      });
    }
  });

  // ---- Commandes en attente de réception depuis longtemps (>14 j, seuil fixe) ----
  COMMANDES_DATA.forEach((c) => {
    if (c.statut !== "en_attente" || !c.dateCommande) return;
    const jours = Math.floor((maintenant - dateToJsDate(c.dateCommande).getTime()) / 86400000);
    if (jours > 14) {
      notifs.push({
        icone: "📦", type: "Réception en attente",
        titre: `${c.numero} — commandée depuis ${jours} j, réception non confirmée`,
        vue: "commandes",
      });
    }
  });

  if (badge) {
    if (notifs.length > 0) { badge.style.display = "inline-block"; badge.textContent = notifs.length; }
    else badge.style.display = "none";
  }

  list.innerHTML = notifs.length
    ? notifs.map((n) => `
        <div class="notif-item" data-vue="${n.vue}">
          <span class="notif-icon">${n.icone}</span>
          <div>
            <div class="notif-titre">${n.titre}</div>
            <div class="notif-meta">${n.type}</div>
          </div>
        </div>
      `).join("")
    : `<p class="notif-empty">Rien à signaler pour l'instant 👍</p>`;

  list.querySelectorAll(".notif-item").forEach((el) => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".nav-item[data-view]").forEach((i) => i.classList.remove("active"));
      document.querySelector(`.nav-item[data-view="${el.dataset.vue}"]`)?.classList.add("active");
      document.querySelectorAll("main > section").forEach((s) => (s.style.display = "none"));
      document.getElementById("view-" + el.dataset.vue).style.display = "block";
    });
  });
}

function renderReporting() {
  const kpiWrap = document.getElementById("reporting-kpis");
  if (!kpiWrap) return;

  const offresOuvertes = OFFRES_DATA.filter((o) => !["client_actif"].includes(o.etapePipeline) && o.statut === "en_cours");
  const pipelineTotal = offresOuvertes.reduce((sum, o) => sum + (o.montantEstime || 0), 0);
  const revenuPondere = offresOuvertes.reduce((sum, o) => sum + (o.montantEstime || 0) * ((o.probabilite || 0) / 100), 0);
  const leadsConvertis = LEADS_DATA.filter((l) => l.statut === "converti").length;
  const tauxConversion = LEADS_DATA.length ? Math.round((leadsConvertis / LEADS_DATA.length) * 100) : 0;

  kpiWrap.innerHTML = `
    <div class="stat-card highlight">
      <div class="stat-label">Pipeline total (ouvert)</div>
      <div class="stat-value">${formatEuro(pipelineTotal)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Revenu pondéré</div>
      <div class="stat-value">${formatEuro(revenuPondere)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Leads (total)</div>
      <div class="stat-value">${LEADS_DATA.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Taux de conversion</div>
      <div class="stat-value">${tauxConversion}%</div>
    </div>
  `;

  // ---------- Offres par étape (valeur pondérée) ----------
  const parEtape = STAGES.map((s) => ({
    label: s.label,
    valeur: OFFRES_DATA.filter((o) => o.etapePipeline === s.key).reduce((sum, o) => sum + (o.montantEstime || 0), 0),
  }));
  const maxEtape = Math.max(1, ...parEtape.map((e) => e.valeur));
  const barsEtapes = document.getElementById("report-bars-etapes");
  if (barsEtapes) {
    barsEtapes.innerHTML = parEtape.map((e) => `
      <div class="report-bar-row">
        <div class="report-bar-label"><span>${e.label}</span><span class="value">${formatEuro(e.valeur)}</span></div>
        <div class="report-bar-track"><div class="report-bar-fill" style="width:${(e.valeur / maxEtape) * 100}%"></div></div>
      </div>
    `).join("");
  }

  // ---------- Leads par source ----------
  const parSource = {};
  LEADS_DATA.forEach((l) => { const s = l.source || "Non précisée"; parSource[s] = (parSource[s] || 0) + 1; });
  const maxSource = Math.max(1, ...Object.values(parSource));
  const barsSources = document.getElementById("report-bars-sources");
  if (barsSources) {
    barsSources.innerHTML = Object.entries(parSource).sort((a, b) => b[1] - a[1]).map(([source, n]) => `
      <div class="report-bar-row">
        <div class="report-bar-label"><span>${source}</span><span class="value">${n}</span></div>
        <div class="report-bar-track"><div class="report-bar-fill" style="width:${(n / maxSource) * 100}%"></div></div>
      </div>
    `).join("") || `<p class="required-note">Aucun lead pour l'instant.</p>`;
  }

  // ---------- Performance par commercial ----------
  const commerciaux = USERS_DATA.filter((u) => u.role === "commercial");
  const tbody = document.querySelector("#report-commerciaux-table tbody");
  if (tbody) {
    tbody.innerHTML = (commerciaux.length ? commerciaux : USERS_DATA.filter((u) => ROLES_RESPONSABLES.includes(u.role))).map((u) => {
      const leadsUid = LEADS_DATA.filter((l) => (l.responsablesUids || []).includes(u.id));
      const convertisUid = leadsUid.filter((l) => l.statut === "converti").length;
      const tauxUid = leadsUid.length ? Math.round((convertisUid / leadsUid.length) * 100) : 0;
      const offresGagnees = OFFRES_DATA.filter((o) => (o.responsablesUids || []).includes(u.id) && o.etapePipeline === "client_actif");
      const caGagne = offresGagnees.reduce((sum, o) => sum + (o.montantEstime || 0), 0);
      return `
        <tr>
          <td>${u.nom}</td>
          <td>${leadsUid.length}</td>
          <td>${tauxUid}%</td>
          <td>${offresGagnees.length}</td>
          <td>${formatEuro(caGagne)}</td>
        </tr>`;
    }).join("") || `<tr><td colspan="5" class="required-note">Aucun commercial pour l'instant.</td></tr>`;
  }
}

// ============================================================
// Prospects
// ============================================================
function renderProspects() {
  const tbody = document.querySelector("#prospects-table tbody");
  if (!tbody) return;
  tbody.innerHTML = PROSPECTS_DATA.map((p) => {
    const principal = p.responsablePrincipalUid ? USERS_DATA.find((u) => u.id === p.responsablePrincipalUid)?.nom : null;
    const respTexte = principal ? `${principal} ★, ${nomsResponsables((p.responsablesUids || []).filter((u) => u !== p.responsablePrincipalUid))}`.replace(/,\s*$/, "") : nomsResponsables(p.responsablesUids);
    return `
    <tr>
      <td>${p.raisonSociale || p.nom || "—"}</td>
      <td>${p.type === "entreprise" ? "Entreprise" : "Particulier"}</td>
      <td>${p.email || "—"}</td>
      <td>${p.telephone || "—"}</td>
      <td><span class="tag ${p.statut === "client" ? "tag-client" : "tag-prospect"}">${p.statut === "client" ? "Client" : "Prospect"}</span></td>
      <td>${respTexte}</td>
      <td>${p.portailUid ? '<span class="tag tag-client">Actif</span>' : `<button class="btn btn-secondary btn-give-portal" data-id="${p.id}" style="padding:5px 10px;font-size:12px;">Donner accès</button>`}</td>
      <td>
        <button class="btn btn-secondary btn-edit-prospect" data-id="${p.id}" style="padding:5px 10px;font-size:12px;">Modifier</button>
        ${p.statut === "client" ? "" : `<button class="btn btn-secondary btn-to-client" data-id="${p.id}" style="padding:5px 10px;font-size:12px;">Transformer en client</button>`}
      </td>
    </tr>`;
  }).join("");

  document.querySelectorAll(".btn-give-portal").forEach((btn) => {
    btn.addEventListener("click", () => ouvrirFormPortail(btn.dataset.id));
  });
  document.querySelectorAll(".btn-edit-prospect").forEach((btn) => {
    btn.addEventListener("click", () => ouvrirFormProspect(btn.dataset.id));
  });
  document.querySelectorAll(".btn-to-client").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await db.collection("prospects").doc(btn.dataset.id).update({ statut: "client" });
      } catch (err) {
        console.error(err);
        alert("Impossible de transformer ce prospect en client.");
      }
    });
  });
}

let prospectPourPortail = null;
function ouvrirFormPortail(prospectId) {
  const prospect = PROSPECTS_DATA.find((p) => p.id === prospectId);
  if (!prospect) return;
  prospectPourPortail = prospect;
  document.getElementById("portail-prospect-nom").textContent = prospect.raisonSociale || prospect.nom;
  document.getElementById("portail-email").value = prospect.email || "";
  document.getElementById("portail-password").value = Math.random().toString(36).slice(-8);
  document.getElementById("portail-status").textContent = "";
  document.getElementById("form-portail-access").style.display = "block";
}
document.getElementById("btn-cancel-portail")?.addEventListener("click", () => {
  document.getElementById("form-portail-access").style.display = "none";
});
document.getElementById("btn-save-portail")?.addEventListener("click", async () => {
  const email = document.getElementById("portail-email").value;
  const password = document.getElementById("portail-password").value;
  const statusEl = document.getElementById("portail-status");
  if (!prospectPourPortail || !email || !password) {
    statusEl.textContent = "Email et mot de passe sont obligatoires.";
    return;
  }
  statusEl.textContent = "Création du compte en cours...";
  try {
    const uid = await creerCompteAuth(email, password);
    await db.collection("utilisateurs_portail").doc(uid).set({
      nom: prospectPourPortail.raisonSociale || prospectPourPortail.nom,
      email,
      prospectId: prospectPourPortail.id,
      dateCreation: firebase.firestore.Timestamp.now(),
    });
    await db.collection("prospects").doc(prospectPourPortail.id).update({ portailUid: uid });
    document.getElementById("form-portail-access").style.display = "none";
  } catch (err) {
    console.error(err);
    const messages = {
      "auth/email-already-in-use": "Cet email est déjà utilisé par un autre compte.",
      "auth/weak-password": "Le mot de passe doit contenir au moins 6 caractères.",
    };
    statusEl.textContent = messages[err.code] || "Impossible de créer cet accès.";
  }
});

const LABELS_STATUT_LEAD = { nouveau: "Nouveau", qualifie: "Qualifié", converti: "Converti", perdu: "Perdu" };

// Équipes dérivées des fiches utilisateurs (une seule source de vérité : pas de
// collection "équipes" séparée à maintenir — le nom d'équipe des commerciaux/managers suffit)
function listeEquipes() {
  const noms = new Set(
    USERS_DATA.filter((u) => ["commercial", "manager"].includes(u.role) && u.equipeId).map((u) => u.equipeId)
  );
  return Array.from(noms).sort();
}

function remplirSelectEquipes() {
  const options = listeEquipes().map((e) => `<option value="${e}">${e}</option>`).join("");
  const select = document.getElementById("lead-equipe");
  if (select) select.innerHTML = options || `<option value="">Aucune équipe créée</option>`;
}

// Choisit, dans une équipe donnée, le commercial ayant le moins de leads ouverts
// (nouveau/qualifié) — attribution automatique façon "round robin par charge"
function commercialLeChargeMoins(equipeId) {
  const commerciaux = USERS_DATA.filter((u) => u.role === "commercial" && u.equipeId === equipeId);
  if (commerciaux.length === 0) return null;
  const charge = (uid) => LEADS_DATA.filter((l) => (l.responsablesUids || []).includes(uid) && ["nouveau", "qualifie"].includes(l.statut)).length;
  return commerciaux.reduce((moins, u) => (charge(u.id) < charge(moins.id) ? u : moins), commerciaux[0]);
}

// Scoring simple, à base de règles (pas un vrai scoring prédictif/ML — un lead
// avec plus d'informations et d'engagement obtient un score plus élevé).
// Documenté comme heuristique de base dans SCHEMA.md.
function calculerScoreLead(lead) {
  let score = 0;
  if (lead.email) score += 20;
  if (lead.telephone) score += 15;
  if (lead.contact) score += 10;
  if (lead.medium === "recommandation") score += 25;
  else if (lead.medium && lead.medium !== "autre") score += 10;
  const activitesFaites = ACTIVITES_DATA.filter((a) => a.cibleType === "lead" && a.cibleId === lead.id && a.statut === "fait").length;
  score += activitesFaites * 8;
  return Math.min(score, 100);
}

function badgeScore(score) {
  const classe = score >= 60 ? "score-high" : score >= 30 ? "score-mid" : "score-low";
  return `<span class="score-badge ${classe}">${score}</span>`;
}

function renderLeads() {
  const tbody = document.querySelector("#leads-table tbody");
  if (!tbody) return;
  tbody.innerHTML = LEADS_DATA.map((l) => `
    <tr>
      <td>${l.nom || "—"}</td>
      <td>${l.contact || "—"}</td>
      <td>${l.source || "—"}</td>
      <td>${badgeScore(calculerScoreLead(l))}</td>
      <td>${nomsResponsables(l.responsablesUids)}</td>
      <td><span class="tag ${l.statut === "converti" ? "tag-client" : l.statut === "perdu" ? "tag-rupture" : "tag-prospect"}">${LABELS_STATUT_LEAD[l.statut] || l.statut}</span></td>
      <td>${l.statut === "converti" || l.statut === "perdu" ? "" : `
        <button class="btn btn-secondary btn-convertir-lead" data-id="${l.id}" style="padding:5px 10px;font-size:12px;">Convertir en opportunité</button>
        <button class="btn btn-secondary btn-appliquer-plan" data-cible-type="lead" data-cible-id="${l.id}" style="padding:5px 10px;font-size:12px;">Appliquer un plan</button>
      `}</td>
    </tr>
  `).join("");

  document.querySelectorAll(".btn-convertir-lead").forEach((btn) => {
    btn.addEventListener("click", () => convertirLead(btn.dataset.id));
  });

  renderReporting();
  renderNotifications();
  renderCalendrier();
}

async function convertirLead(leadId) {
  const lead = LEADS_DATA.find((l) => l.id === leadId);
  if (!lead) return;
  try {
    const prospectRef = await db.collection("prospects").add({
      raisonSociale: lead.nom,
      type: "entreprise",
      email: lead.email || "",
      telephone: lead.telephone || "",
      source: lead.source || "",
      statut: "prospect",
      responsablesUids: lead.responsablesUids || [],
      equipeIds: lead.equipeIds || [],
      dateCreation: firebase.firestore.Timestamp.now(),
    });
    const numero = `OFF-${new Date().getFullYear()}-${leadId.slice(0, 5).toUpperCase()}`;
    await db.collection("offres").add({
      numero,
      titre: lead.description || lead.nom,
      prospectId: prospectRef.id,
      responsablesUids: lead.responsablesUids || [],
      equipeIds: lead.equipeIds || [],
      etapePipeline: "nouveau",
      statut: "en_cours",
      historiqueEtapes: [{ etape: "nouveau", date: firebase.firestore.Timestamp.now() }],
      leadOrigineId: leadId,
    });
    await db.collection("leads").doc(leadId).update({ statut: "converti", prospectId: prospectRef.id });
  } catch (err) {
    console.error(err);
    alert("Impossible de convertir ce lead en opportunité.");
  }
}

document.getElementById("btn-new-lead")?.addEventListener("click", () => {
  document.getElementById("form-new-lead").style.display = "block";
  remplirSelectEquipes();
});
document.getElementById("btn-cancel-lead")?.addEventListener("click", () => {
  document.getElementById("form-new-lead").style.display = "none";
});
document.getElementById("lead-auto-assign")?.addEventListener("change", (e) => {
  document.getElementById("lead-equipe-field").style.display = e.target.checked ? "block" : "none";
  document.getElementById("lead-responsable-field").style.display = e.target.checked ? "none" : "block";
  if (!e.target.checked) {
    const select = document.getElementById("lead-responsable");
    select.innerHTML = USERS_DATA.filter((u) => ROLES_RESPONSABLES.includes(u.role))
      .map((u) => `<option value="${u.id}">${u.nom} (${LABELS_ROLE[u.role] || u.role})</option>`).join("");
  }
});
document.getElementById("btn-save-lead")?.addEventListener("click", async () => {
  const nom = document.getElementById("lead-nom").value;
  if (!nom) {
    alert("Le nom / l'entreprise est obligatoire.");
    return;
  }

  const autoAssign = document.getElementById("lead-auto-assign").checked;
  let responsablesUids, equipeIds;

  if (autoAssign) {
    const equipeId = document.getElementById("lead-equipe").value;
    const commercial = commercialLeChargeMoins(equipeId);
    if (!commercial) {
      alert("Aucun commercial trouvé dans cette équipe pour l'attribution automatique.");
      return;
    }
    responsablesUids = [commercial.id];
    equipeIds = [equipeId];
  } else {
    ({ responsablesUids, equipeIds } = selectionMultiple("lead-responsable"));
  }

  try {
    await db.collection("leads").add({
      nom,
      contact: document.getElementById("lead-contact").value,
      email: document.getElementById("lead-email").value,
      telephone: document.getElementById("lead-telephone").value,
      source: document.getElementById("lead-source").value,
      medium: document.getElementById("lead-medium").value,
      campagne: document.getElementById("lead-campagne").value,
      description: document.getElementById("lead-description").value,
      responsablesUids,
      equipeIds,
      statut: "nouveau",
      dateCreation: firebase.firestore.Timestamp.now(),
    });
    document.getElementById("form-new-lead").style.display = "none";
    ["lead-nom", "lead-contact", "lead-email", "lead-telephone", "lead-source", "lead-campagne", "lead-description"].forEach((id) => (document.getElementById(id).value = ""));
    document.getElementById("lead-medium").value = "";
  } catch (err) {
    console.error(err);
    alert("Impossible de créer ce lead.");
  }
});

// ============================================================
// Activités & Plans d'activités
// ============================================================
const LABELS_TYPE_ACTIVITE = { appel: "Appel", email: "Email", reunion: "Réunion", tache: "Tâche", personnalisee: "Personnalisée" };

function nomCible(cibleType, cibleId) {
  if (cibleType === "lead") return LEADS_DATA.find((l) => l.id === cibleId)?.nom || "Lead";
  if (cibleType === "offre") return getOffre(cibleId)?.numero || "Offre";
  return "—";
}

function renderActivites() {
  const tbody = document.querySelector("#activites-table tbody");
  if (!tbody) return;
  tbody.innerHTML = [...ACTIVITES_DATA]
    .sort((a, b) => dateToJsDate(a.dateEcheance) - dateToJsDate(b.dateEcheance))
    .map((a) => {
      const enRetard = a.statut === "a_faire" && dateToJsDate(a.dateEcheance) < new Date();
      return `
      <tr>
        <td>${dateToJsDate(a.dateEcheance).toLocaleDateString("fr-BE")} ${enRetard ? '<span class="tag tag-rupture">En retard</span>' : ""}</td>
        <td>${LABELS_TYPE_ACTIVITE[a.type] || a.type}</td>
        <td>${a.titre}</td>
        <td>${a.cibleId ? nomCible(a.cibleType, a.cibleId) : "—"}</td>
        <td>${nomsResponsables(a.responsablesUids)}</td>
        <td><span class="tag ${a.statut === "fait" ? "tag-client" : "tag-prospect"}">${a.statut === "fait" ? "Fait" : "À faire"}</span></td>
        <td>${a.statut === "fait" ? "" : `<button class="btn btn-secondary btn-fait-activite" data-id="${a.id}" style="padding:5px 10px;font-size:12px;">Marquer fait</button>`}</td>
      </tr>`;
    }).join("");

  document.querySelectorAll(".btn-fait-activite").forEach((btn) => {
    btn.addEventListener("click", () => db.collection("activites").doc(btn.dataset.id).update({ statut: "fait" }).catch((err) => console.error(err)));
  });
}

document.getElementById("btn-new-activite")?.addEventListener("click", () => {
  document.getElementById("form-new-activite").style.display = "block";
  const cibleSelect = document.getElementById("activite-cible");
  cibleSelect.innerHTML = `<option value="">— Aucun —</option>` +
    LEADS_DATA.filter((l) => l.statut !== "converti" && l.statut !== "perdu").map((l) => `<option value="lead:${l.id}">Lead — ${l.nom}</option>`).join("") +
    OFFRES_DATA.map((o) => `<option value="offre:${o.id}">Offre — ${o.numero}</option>`).join("");
});
document.getElementById("btn-cancel-activite")?.addEventListener("click", () => {
  document.getElementById("form-new-activite").style.display = "none";
});
document.getElementById("btn-save-activite")?.addEventListener("click", async () => {
  const titre = document.getElementById("activite-titre").value;
  const dateStr = document.getElementById("activite-date").value;
  if (!titre || !dateStr) {
    alert("Le titre et l'échéance sont obligatoires.");
    return;
  }
  const cibleValue = document.getElementById("activite-cible").value;
  const [cibleType, cibleId] = cibleValue ? cibleValue.split(":") : [null, null];

  // Hérite des responsables de la cible si elle en a, sinon assigné à l'utilisateur courant
  let responsablesUids = [currentUser.uid], equipeIds = [];
  if (cibleType === "lead") {
    const lead = LEADS_DATA.find((l) => l.id === cibleId);
    if (lead) { responsablesUids = lead.responsablesUids || responsablesUids; equipeIds = lead.equipeIds || []; }
  } else if (cibleType === "offre") {
    const offre = getOffre(cibleId);
    if (offre) { responsablesUids = offre.responsablesUids || responsablesUids; equipeIds = offre.equipeIds || []; }
  }

  try {
    await db.collection("activites").add({
      type: document.getElementById("activite-type").value,
      titre,
      dateEcheance: firebase.firestore.Timestamp.fromDate(new Date(dateStr)),
      statut: "a_faire",
      cibleType,
      cibleId,
      responsablesUids,
      equipeIds,
    });
    document.getElementById("form-new-activite").style.display = "none";
    ["activite-titre", "activite-date"].forEach((id) => (document.getElementById(id).value = ""));
  } catch (err) {
    console.error(err);
    alert("Impossible de créer cette activité.");
  }
});

// ---------- Appliquer un plan d'activités (depuis la vue Leads) ----------
let cibleActivePlan = null;

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-appliquer-plan");
  if (!btn) return;
  cibleActivePlan = { type: btn.dataset.cibleType, id: btn.dataset.cibleId };
  document.getElementById("apply-plan-select").innerHTML = PLANS_DATA.map((p) => `<option value="${p.id}">${p.nom} (${(p.etapes || []).length} étapes)</option>`).join("") || `<option value="">Aucun plan créé (Administration > Plans d'activités)</option>`;
  document.getElementById("form-apply-plan").style.display = "block";
});
document.getElementById("btn-cancel-apply-plan")?.addEventListener("click", () => {
  document.getElementById("form-apply-plan").style.display = "none";
});
document.getElementById("btn-confirm-apply-plan")?.addEventListener("click", async () => {
  const planId = document.getElementById("apply-plan-select").value;
  const plan = PLANS_DATA.find((p) => p.id === planId);
  if (!plan || !cibleActivePlan) return;

  const cible = cibleActivePlan.type === "lead" ? LEADS_DATA.find((l) => l.id === cibleActivePlan.id) : getOffre(cibleActivePlan.id);
  const responsablesUids = cible?.responsablesUids || [currentUser.uid];
  const equipeIds = cible?.equipeIds || [];

  try {
    const batch = db.batch();
    (plan.etapes || []).forEach((etape) => {
      const ref = db.collection("activites").doc();
      batch.set(ref, {
        type: etape.type,
        titre: etape.titre,
        dateEcheance: firebase.firestore.Timestamp.fromDate(new Date(Date.now() + (etape.jour || 0) * 86400000)),
        statut: "a_faire",
        cibleType: cibleActivePlan.type,
        cibleId: cibleActivePlan.id,
        responsablesUids,
        equipeIds,
      });
    });
    await batch.commit();
    document.getElementById("form-apply-plan").style.display = "none";
  } catch (err) {
    console.error(err);
    alert("Impossible d'appliquer ce plan.");
  }
});

// ---------- Gestion des plans (Administration, Admin/Super Admin) ----------
function renderPlans() {
  const tbody = document.querySelector("#plans-table tbody");
  if (!tbody) return;
  tbody.innerHTML = PLANS_DATA.map((p) => `
    <tr>
      <td>${p.nom}</td>
      <td>${(p.etapes || []).map((e) => `J+${e.jour} ${LABELS_TYPE_ACTIVITE[e.type] || e.type}`).join(" → ")}</td>
      <td><button class="btn btn-secondary btn-delete-plan" data-id="${p.id}" style="padding:5px 10px;font-size:12px;">Supprimer</button></td>
    </tr>
  `).join("");
  document.querySelectorAll(".btn-delete-plan").forEach((btn) => {
    btn.addEventListener("click", () => db.collection("plans_activites").doc(btn.dataset.id).delete().catch((err) => console.error(err)));
  });
}

document.getElementById("btn-new-plan")?.addEventListener("click", () => {
  document.getElementById("form-new-plan").style.display = "block";
});
document.getElementById("btn-cancel-plan")?.addEventListener("click", () => {
  document.getElementById("form-new-plan").style.display = "none";
});
document.getElementById("btn-save-plan")?.addEventListener("click", async () => {
  const nom = document.getElementById("plan-nom").value;
  const lignes = document.getElementById("plan-etapes").value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!nom || lignes.length === 0) {
    alert("Le nom et au moins une étape sont obligatoires.");
    return;
  }
  const etapes = lignes.map((ligne) => {
    const [jour, type, ...titreParts] = ligne.split(";").map((s) => s.trim());
    return { jour: parseInt(jour, 10) || 0, type: type || "tache", titre: titreParts.join(";") || "Étape" };
  });

  try {
    await db.collection("plans_activites").add({ nom, etapes });
    document.getElementById("form-new-plan").style.display = "none";
    document.getElementById("plan-nom").value = "";
    document.getElementById("plan-etapes").value = "";
  } catch (err) {
    console.error(err);
    alert("Impossible d'enregistrer ce plan.");
  }
});

// Rôles qui peuvent être "responsable" d'un prospect/offre (pas les travailleurs)
const ROLES_RESPONSABLES = ["commercial", "manager", "direction", "admin", "superadmin"];

// Lit les uids sélectionnés dans un <select multiple>, et déduit la liste des
// équipes concernées (un dossier peut avoir plusieurs responsables, dans des
// équipes différentes)
function selectionMultiple(selectId) {
  const select = document.getElementById(selectId);
  const uids = select ? [...select.selectedOptions].map((o) => o.value) : [];
  const equipeIds = [...new Set(uids.map((uid) => USERS_DATA.find((u) => u.id === uid)?.equipeId).filter(Boolean))];
  return { responsablesUids: uids.length ? uids : [currentUser.uid], equipeIds };
}

function remplirSelectsResponsables() {
  const options = USERS_DATA
    .filter((u) => ROLES_RESPONSABLES.includes(u.role))
    .map((u) => `<option value="${u.id}">${u.nom} (${LABELS_ROLE[u.role] || u.role})</option>`).join("");
  ["prospect-responsable", "offre-responsable", "lead-responsable"].forEach((id) => {
    const select = document.getElementById(id);
    if (select) select.innerHTML = options || `<option value="${currentUser.uid}">Moi</option>`;
  });
}

function nomsResponsables(uids) {
  if (!uids || !uids.length) return "—";
  return uids.map((uid) => USERS_DATA.find((u) => u.id === uid)?.nom || uid).join(", ");
}

// ---------- Numérotation automatique annuelle (transaction Firestore) ----------
// Compteur par préfixe+année (ex. "offres_2026") : se remet donc à 0 tout seul
// chaque nouvelle année, sans action manuelle.
async function genererNumeroAnnuel(prefixeCompteur, largeur) {
  const annee = new Date().getFullYear();
  const ref = db.collection("compteurs").doc(`${prefixeCompteur}_${annee}`);
  const nouveau = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const dernier = doc.exists ? doc.data().dernier : 0;
    const n = dernier + 1;
    tx.set(ref, { dernier: n, annee }, { merge: true });
    return n;
  });
  return { annee, numero: String(nouveau).padStart(largeur, "0") };
}

// Remplit un <select> "responsable principal" avec les uids actuellement
// cochés dans le <select multiple> correspondant
function synchroniserPrincipal(multipleId, principalId, dejaChoisi) {
  const { responsablesUids } = selectionMultiple(multipleId);
  const select = document.getElementById(principalId);
  if (!select) return;
  select.innerHTML = responsablesUids.map((uid) => `<option value="${uid}">${USERS_DATA.find((u) => u.id === uid)?.nom || uid}</option>`).join("");
  if (dejaChoisi && responsablesUids.includes(dejaChoisi)) select.value = dejaChoisi;
}
document.getElementById("prospect-responsable")?.addEventListener("change", () => synchroniserPrincipal("prospect-responsable", "prospect-principal"));
document.getElementById("offre-responsable")?.addEventListener("change", () => synchroniserPrincipal("offre-responsable", "offre-principal"));

// ---------- Calculs TVA en direct (HTVA -> TVA -> TTC) ----------
function brancherCalculTVA(idHTVA, idTaux, idMontantTVA, idTTC) {
  const recalculer = () => {
    const htva = parseFloat(document.getElementById(idHTVA).value) || 0;
    const taux = parseFloat(document.getElementById(idTaux).value) || 0;
    const montantTVA = htva * (taux / 100);
    document.getElementById(idMontantTVA).value = montantTVA.toFixed(2) + " €";
    document.getElementById(idTTC).value = (htva + montantTVA).toFixed(2) + " €";
  };
  document.getElementById(idHTVA)?.addEventListener("input", recalculer);
  document.getElementById(idTaux)?.addEventListener("change", recalculer);
  return recalculer;
}
const recalculerOffreTVA = brancherCalculTVA("offre-htva", "offre-tva", "offre-montant-tva", "offre-ttc");
const recalculerDevisTVA = brancherCalculTVA("devis-htva", "devis-tva", "devis-montant-tva", "devis-ttc");

let prospectEnEdition = null;

document.getElementById("btn-new-prospect")?.addEventListener("click", () => {
  prospectEnEdition = null;
  document.getElementById("prospect-form-titre").textContent = "Nouveau prospect";
  ["prospect-nom", "prospect-email", "prospect-telephone", "prospect-source"].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("prospect-type").value = "entreprise";
  document.getElementById("form-new-prospect").style.display = "block";
  const respSelect = document.getElementById("prospect-responsable");
  [...respSelect.options].forEach((o) => (o.selected = currentScope === "perso" && o.value === currentUser.uid));
  synchroniserPrincipal("prospect-responsable", "prospect-principal");
});
function ouvrirFormProspect(prospectId) {
  const p = PROSPECTS_DATA.find((x) => x.id === prospectId);
  if (!p) return;
  prospectEnEdition = p;
  document.getElementById("prospect-form-titre").textContent = "Modifier le prospect";
  document.getElementById("prospect-nom").value = p.raisonSociale || p.nom || "";
  document.getElementById("prospect-type").value = p.type || "entreprise";
  document.getElementById("prospect-email").value = p.email || "";
  document.getElementById("prospect-telephone").value = p.telephone || "";
  document.getElementById("prospect-source").value = p.source || "";
  const respSelect = document.getElementById("prospect-responsable");
  [...respSelect.options].forEach((o) => (o.selected = (p.responsablesUids || []).includes(o.value)));
  synchroniserPrincipal("prospect-responsable", "prospect-principal", p.responsablePrincipalUid);
  document.getElementById("form-new-prospect").style.display = "block";
}
document.getElementById("btn-cancel-prospect")?.addEventListener("click", () => {
  document.getElementById("form-new-prospect").style.display = "none";
});
document.getElementById("btn-save-prospect")?.addEventListener("click", async () => {
  const nom = document.getElementById("prospect-nom").value;
  if (!nom) return;
  const { responsablesUids, equipeIds } = selectionMultiple("prospect-responsable");
  const responsablePrincipalUid = document.getElementById("prospect-principal").value || responsablesUids[0];

  const donnees = {
    raisonSociale: nom,
    type: document.getElementById("prospect-type").value,
    email: document.getElementById("prospect-email").value,
    telephone: document.getElementById("prospect-telephone").value,
    source: document.getElementById("prospect-source").value,
    responsablesUids,
    equipeIds,
    responsablePrincipalUid,
  };

  try {
    if (prospectEnEdition) {
      await db.collection("prospects").doc(prospectEnEdition.id).update(donnees);
    } else {
      await db.collection("prospects").add({ ...donnees, statut: "prospect", dateCreation: firebase.firestore.Timestamp.now() });
    }
    document.getElementById("form-new-prospect").style.display = "none";
    prospectEnEdition = null;
  } catch (err) {
    console.error(err);
    alert("Impossible d'enregistrer ce prospect : " + (err.message || err.code || ""));
  }
});

let offreEnEdition = null;

document.getElementById("btn-new-offre")?.addEventListener("click", () => {
  offreEnEdition = null;
  document.getElementById("offre-form-titre").textContent = "Nouvelle offre";
  document.getElementById("offre-titre").value = "";
  document.getElementById("offre-htva").value = "";
  document.getElementById("offre-tva").value = "21";
  document.getElementById("offre-probabilite").value = "50";
  recalculerOffreTVA();
  document.getElementById("form-new-offre").style.display = "block";
  const respSelect = document.getElementById("offre-responsable");
  [...respSelect.options].forEach((o) => (o.selected = currentScope === "perso" && o.value === currentUser.uid));
  const prospectSelect = document.getElementById("offre-prospect");
  if (prospectSelect) prospectSelect.innerHTML = PROSPECTS_DATA.map((p) => `<option value="${p.id}">${p.raisonSociale || p.nom}</option>`).join("");
  synchroniserPrincipal("offre-responsable", "offre-principal");
});
function ouvrirFormOffre(offreId) {
  const o = getOffre(offreId);
  if (!o) return;
  offreEnEdition = o;
  document.getElementById("offre-form-titre").textContent = "Modifier l'offre " + (o.numero || "");
  const prospectSelect = document.getElementById("offre-prospect");
  prospectSelect.innerHTML = PROSPECTS_DATA.map((p) => `<option value="${p.id}">${p.raisonSociale || p.nom}</option>`).join("");
  prospectSelect.value = o.prospectId;
  document.getElementById("offre-titre").value = o.titre || "";
  document.getElementById("offre-htva").value = o.montantHTVA || o.montantEstime || "";
  document.getElementById("offre-tva").value = o.tauxTVA ?? "21";
  document.getElementById("offre-probabilite").value = o.probabilite ?? 50;
  recalculerOffreTVA();
  const respSelect = document.getElementById("offre-responsable");
  [...respSelect.options].forEach((opt) => (opt.selected = (o.responsablesUids || []).includes(opt.value)));
  synchroniserPrincipal("offre-responsable", "offre-principal", o.responsablePrincipalUid);
  document.getElementById("form-new-offre").style.display = "block";
}
document.getElementById("btn-cancel-offre")?.addEventListener("click", () => {
  document.getElementById("form-new-offre").style.display = "none";
});
document.getElementById("btn-save-offre")?.addEventListener("click", async () => {
  const prospectId = document.getElementById("offre-prospect").value;
  if (!prospectId) {
    alert("Le prospect est obligatoire.");
    return;
  }
  const { responsablesUids, equipeIds } = selectionMultiple("offre-responsable");
  const responsablePrincipalUid = document.getElementById("offre-principal").value || responsablesUids[0];
  const montantHTVA = parseFloat(document.getElementById("offre-htva").value) || 0;
  const tauxTVA = parseFloat(document.getElementById("offre-tva").value) || 0;
  const montantTVA = montantHTVA * (tauxTVA / 100);

  const donnees = {
    titre: document.getElementById("offre-titre").value,
    prospectId,
    responsablesUids,
    equipeIds,
    responsablePrincipalUid,
    montantHTVA,
    tauxTVA,
    montantTVA,
    montantTTC: montantHTVA + montantTVA,
    montantEstime: montantHTVA, // conservé pour le calcul du reporting (revenu pondéré)
    probabilite: parseInt(document.getElementById("offre-probabilite").value, 10) || 0,
  };

  try {
    if (offreEnEdition) {
      await db.collection("offres").doc(offreEnEdition.id).update(donnees);
    } else {
      const { annee, numero } = await genererNumeroAnnuel("offres", 5);
      await db.collection("offres").add({
        ...donnees,
        numero: `OFF-${annee}/${numero}`,
        etapePipeline: "nouveau",
        statut: "en_cours",
        historiqueEtapes: [{ etape: "nouveau", date: firebase.firestore.Timestamp.now() }],
      });
    }
    document.getElementById("form-new-offre").style.display = "none";
    offreEnEdition = null;
  } catch (err) {
    console.error(err);
    alert("Impossible d'enregistrer cette offre : " + (err.message || err.code || ""));
  }
});

// ============================================================
// Devis
// ============================================================
function remplirSelectOffres() {
  const select = document.getElementById("devis-offre");
  if (!select) return;
  select.innerHTML = OFFRES_DATA.map((o) => `<option value="${o.id}">${o.numero || o.id} — ${getProspectNom(o.prospectId)}</option>`).join("");
}

function renderDevis() {
  const tbody = document.querySelector("#devis-table tbody");
  if (!tbody) return;
  tbody.innerHTML = DEVIS_DATA.map((d) => {
    const offre = getOffre(d.offreId);
    const commandeExistante = COMMANDES_DATA.find((c) => c.devisId === d.id);
    let colCommande = "—";
    if (commandeExistante) colCommande = `<span class="tag ${commandeExistante.statut === "receptionnee" ? "tag-client" : "tag-prospect"}">${commandeExistante.numero}</span>`;
    else if (d.statut === "accepte" && currentScope === "tout")
      colCommande = `<button class="btn btn-secondary btn-creer-commande" data-offre="${d.offreId}" data-devis="${d.id}" style="padding:5px 10px;font-size:12px;">Créer bon de commande</button>`;
    return `
    <tr>
      <td>${d.reference || d.id}</td>
      <td>${offre ? (offre.numero || offre.id) : d.offreId}</td>
      <td>${offre ? getProspectNom(offre.prospectId) : "—"}</td>
      <td>${d.dateEmission ? dateToJsDate(d.dateEmission).toLocaleDateString("fr-BE") : "—"}</td>
      <td>${(d.totalTTC || 0).toFixed(2)} €</td>
      <td><span class="tag ${d.statut === "accepte" ? "tag-client" : "tag-prospect"}">${LABELS_STATUT_DEVIS[d.statut] || d.statut}</span></td>
      <td>${colCommande}</td>
      <td>${d.statut === "accepte" ? "" : `<button class="btn btn-secondary btn-accept-devis" data-offre="${d.offreId}" data-devis="${d.id}" style="padding:5px 10px;font-size:12px;">Marquer accepté</button>`}</td>
    </tr>`;
  }).join("");

  document.querySelectorAll(".btn-creer-commande").forEach((btn) => {
    btn.addEventListener("click", () => creerCommande(btn.dataset.offre, btn.dataset.devis));
  });

  document.querySelectorAll(".btn-accept-devis").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { offre, devis } = btn.dataset;
      try {
        await db.collection("offres").doc(offre).collection("devis").doc(devis).update({ statut: "accepte" });
        await db.collection("offres").doc(offre).update({
          etapePipeline: "devis_accepte",
          historiqueEtapes: firebase.firestore.FieldValue.arrayUnion({ etape: "devis_accepte", date: firebase.firestore.Timestamp.now() }),
        });
      } catch (err) {
        console.error(err);
        alert("Impossible de marquer ce devis comme accepté.");
      }
    });
  });
}

// ============================================================
// Commandes (bon de commande + réception) — entre le devis accepté et la facture
// ============================================================
const LABELS_STATUT_COMMANDE = { en_attente: "En attente de réception", receptionnee: "Réceptionnée" };

async function creerCommande(offreId, devisId) {
  const devis = DEVIS_DATA.find((d) => d.id === devisId);
  const offre = getOffre(offreId);
  if (!devis || !offre) return;
  try {
    const { annee, numero } = await genererNumeroAnnuel("commandes", 3);
    await db.collection("commandes").add({
      numero: `BC-${annee}-${numero}`,
      offreId,
      devisId,
      prospectId: offre.prospectId,
      montantHTVA: devis.montantHTVA || 0,
      tauxTVA: devis.tauxTVA || 0,
      montantTVA: devis.montantTVA || 0,
      montantTTC: devis.totalTTC || 0,
      statut: "en_attente",
      dateCommande: firebase.firestore.Timestamp.now(),
      responsablesUids: devis.responsablesUids || offre.responsablesUids || [],
      equipeIds: devis.equipeIds || offre.equipeIds || [],
    });
  } catch (err) {
    console.error(err);
    alert("Impossible de créer le bon de commande : " + (err.message || err.code || ""));
  }
}

// ---------- Création MANUELLE d'une commande (sans devis préalable) ----------
function remplirSelectProspectsPourFormulaire(selectId) {
  const select = document.getElementById(selectId);
  if (select) select.innerHTML = PROSPECTS_DATA.map((p) => `<option value="${p.id}">${p.raisonSociale || p.nom}</option>`).join("");
}
document.getElementById("btn-new-commande")?.addEventListener("click", () => {
  remplirSelectProspectsPourFormulaire("commande-prospect");
  document.getElementById("commande-htva").value = "";
  document.getElementById("commande-tva").value = "21";
  recalculerCommandeTVA();
  document.getElementById("form-new-commande").style.display = "block";
});
document.getElementById("btn-cancel-commande")?.addEventListener("click", () => {
  document.getElementById("form-new-commande").style.display = "none";
});
const recalculerCommandeTVA = brancherCalculTVA("commande-htva", "commande-tva", "commande-montant-tva", "commande-ttc");
document.getElementById("btn-save-commande")?.addEventListener("click", async () => {
  const prospectId = document.getElementById("commande-prospect").value;
  if (!prospectId) { alert("Le prospect/client est obligatoire."); return; }
  const montantHTVA = parseFloat(document.getElementById("commande-htva").value) || 0;
  const tauxTVA = parseFloat(document.getElementById("commande-tva").value) || 0;
  const montantTVA = montantHTVA * (tauxTVA / 100);
  const prospect = PROSPECTS_DATA.find((p) => p.id === prospectId);

  try {
    const { annee, numero } = await genererNumeroAnnuel("commandes", 3);
    await db.collection("commandes").add({
      numero: `BC-${annee}-${numero}`,
      offreId: null,
      devisId: null,
      prospectId,
      montantHTVA,
      tauxTVA,
      montantTVA,
      montantTTC: montantHTVA + montantTVA,
      statut: "en_attente",
      dateCommande: firebase.firestore.Timestamp.now(),
      responsablesUids: prospect?.responsablesUids || [currentUser.uid],
      equipeIds: prospect?.equipeIds || [],
    });
    document.getElementById("form-new-commande").style.display = "none";
  } catch (err) {
    console.error(err);
    alert("Impossible de créer cette commande : " + (err.message || err.code || ""));
  }
});

// ---------- Création MANUELLE d'une facture (sans commande préalable) ----------
document.getElementById("btn-new-facture")?.addEventListener("click", () => {
  remplirSelectProspectsPourFormulaire("facture-prospect");
  document.getElementById("facture-htva").value = "";
  document.getElementById("facture-tva").value = "21";
  document.getElementById("facture-echeance").value = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  recalculerFactureTVA();
  document.getElementById("form-new-facture").style.display = "block";
});
document.getElementById("btn-cancel-facture")?.addEventListener("click", () => {
  document.getElementById("form-new-facture").style.display = "none";
});
const recalculerFactureTVA = brancherCalculTVA("facture-htva", "facture-tva", "facture-montant-tva", "facture-ttc");
document.getElementById("btn-save-facture")?.addEventListener("click", async () => {
  const prospectId = document.getElementById("facture-prospect").value;
  if (!prospectId) { alert("Le prospect/client est obligatoire."); return; }
  const montantHTVA = parseFloat(document.getElementById("facture-htva").value) || 0;
  const tauxTVA = parseFloat(document.getElementById("facture-tva").value) || 0;
  const montantTVA = montantHTVA * (tauxTVA / 100);
  const echeanceStr = document.getElementById("facture-echeance").value;
  const prospect = PROSPECTS_DATA.find((p) => p.id === prospectId);

  try {
    const { annee, numero } = await genererNumeroAnnuel("factures", 3);
    await db.collection("factures").add({
      numero: `FAC-${annee}-${numero}`,
      prospectId,
      devisRef: null,
      commandeId: null,
      dateFacturation: firebase.firestore.Timestamp.now(),
      dateEcheance: echeanceStr ? firebase.firestore.Timestamp.fromDate(new Date(echeanceStr)) : firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 86400000)),
      montantHTVA,
      tauxTVA,
      montantTVA,
      totalTTC: montantHTVA + montantTVA,
      statutPaiement: "a_payer",
      exportBob: { exportee: false },
      responsablesUids: prospect?.responsablesUids || [currentUser.uid],
      equipeIds: prospect?.equipeIds || [],
    });
    document.getElementById("form-new-facture").style.display = "none";
  } catch (err) {
    console.error(err);
    alert("Impossible de créer cette facture : " + (err.message || err.code || ""));
  }
});

function renderCommandes() {
  const tbody = document.querySelector("#commandes-table tbody");
  if (!tbody) return;
  tbody.innerHTML = COMMANDES_DATA.map((c) => {
    const devis = DEVIS_DATA.find((d) => d.id === c.devisId);
    const factureExistante = FACTURES_DATA.find((f) => f.commandeId === c.id);
    let action = "—";
    if (factureExistante) action = `<span class="tag tag-client">${factureExistante.numero}</span>`;
    else if (c.statut === "en_attente") action = `<button class="btn btn-secondary btn-confirmer-reception" data-id="${c.id}" style="padding:5px 10px;font-size:12px;">Confirmer réception</button>`;
    else if (c.statut === "receptionnee" && currentScope === "tout") action = `<button class="btn btn-primary btn-generer-facture-cmd" data-id="${c.id}" style="padding:5px 10px;font-size:12px;">Générer facture</button>`;
    return `
    <tr>
      <td>${c.numero}</td>
      <td>${devis?.reference || c.devisId}</td>
      <td>${getProspectNom(c.prospectId)}</td>
      <td>${(c.montantTTC || 0).toFixed(2)} €</td>
      <td><span class="tag ${c.statut === "receptionnee" ? "tag-client" : "tag-prospect"}">${LABELS_STATUT_COMMANDE[c.statut] || c.statut}</span></td>
      <td>${action}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="required-note">Aucune commande pour l'instant — elles se créent depuis un devis accepté (onglet Devis).</td></tr>`;

  document.querySelectorAll(".btn-confirmer-reception").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await db.collection("commandes").doc(btn.dataset.id).update({
          statut: "receptionnee",
          reception: { date: firebase.firestore.Timestamp.now(), confirmePar: currentUser.uid },
        });
      } catch (err) {
        console.error(err);
        alert("Impossible de confirmer la réception : " + (err.message || err.code || ""));
      }
    });
  });
  document.querySelectorAll(".btn-generer-facture-cmd").forEach((btn) => {
    btn.addEventListener("click", () => genererFacture(btn.dataset.id));
  });
  renderDevis(); // la colonne "Commande" du tableau Devis dépend de COMMANDES_DATA
  remplirSelectCommandes();
  renderNotifications();
  renderCalendrier();
}

async function genererFacture(commandeId) {
  const commande = COMMANDES_DATA.find((c) => c.id === commandeId);
  if (!commande) return;
  const devis = DEVIS_DATA.find((d) => d.id === commande.devisId);
  const offre = getOffre(commande.offreId);

  const { annee, numero: num } = await genererNumeroAnnuel("factures", 3);
  const numero = `FAC-${annee}-${num}`;
  const dateFacturation = firebase.firestore.Timestamp.now();
  const dateEcheance = firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 86400000));

  try {
    await db.collection("factures").add({
      numero,
      prospectId: commande.prospectId,
      devisRef: { offreId: commande.offreId, devisId: commande.devisId },
      commandeId,
      dateFacturation,
      dateEcheance,
      montantHTVA: commande.montantHTVA || 0,
      tauxTVA: commande.tauxTVA || 0,
      montantTVA: commande.montantTVA || 0,
      totalTTC: commande.montantTTC || 0,
      statutPaiement: "a_payer",
      exportBob: { exportee: false },
      responsablesUids: commande.responsablesUids || devis?.responsablesUids || offre?.responsablesUids || [],
      equipeIds: commande.equipeIds || devis?.equipeIds || offre?.equipeIds || [],
    });
    if (offre) {
      await db.collection("offres").doc(commande.offreId).update({
        etapePipeline: "facture",
        historiqueEtapes: firebase.firestore.FieldValue.arrayUnion({ etape: "facture", date: firebase.firestore.Timestamp.now() }),
      });
    }
  } catch (err) {
    console.error(err);
    alert("Impossible de générer la facture.");
  }
}

document.getElementById("btn-new-devis")?.addEventListener("click", () => {
  if (OFFRES_DATA.length === 0) {
    alert("Aucune offre disponible pour l'instant. Crée d'abord une offre dans Pipeline (\"+ Nouvelle offre\") avant de pouvoir lui associer un devis.");
    return;
  }
  remplirSelectOffres();
  const offreId = document.getElementById("devis-offre").value;
  prefillDevisDepuisOffre(offreId);
  document.getElementById("devis-doc-note").value = "";
  document.getElementById("form-new-devis").style.display = "block";
});
function prefillDevisDepuisOffre(offreId) {
  const offre = getOffre(offreId);
  document.getElementById("devis-htva").value = offre?.montantHTVA ?? offre?.montantEstime ?? "";
  document.getElementById("devis-tva").value = offre?.tauxTVA ?? "21";
  recalculerDevisTVA();
}
document.getElementById("devis-offre")?.addEventListener("change", (e) => prefillDevisDepuisOffre(e.target.value));
document.getElementById("btn-cancel-devis")?.addEventListener("click", () => {
  document.getElementById("form-new-devis").style.display = "none";
});
document.getElementById("btn-save-devis")?.addEventListener("click", async () => {
  const offreId = document.getElementById("devis-offre").value;
  const montantHTVA = parseFloat(document.getElementById("devis-htva").value) || 0;
  const tauxTVA = parseFloat(document.getElementById("devis-tva").value) || 0;
  const montantTVA = montantHTVA * (tauxTVA / 100);
  const note = document.getElementById("devis-doc-note").value;

  if (!offreId) {
    alert("Merci de sélectionner l'offre liée.");
    return;
  }

  try {
    const offre = getOffre(offreId);
    const { annee, numero } = await genererNumeroAnnuel("devis", 3);
    await db.collection("offres").doc(offreId).collection("devis").add({
      reference: `DEV-${annee}-${numero}`,
      montantHTVA,
      tauxTVA,
      montantTVA,
      totalTTC: montantHTVA + montantTVA,
      statut: "brouillon",
      dateEmission: firebase.firestore.Timestamp.now(),
      dateValidite: firebase.firestore.Timestamp.fromDate(new Date(Date.now() + (DELAIS_DATA["devis_validite"] || 30) * 86400000)),
      documentationTechnique: note ? [{ description: note }] : [],
      prospectId: offre?.prospectId || null,
      // Hérités de l'offre pour que les règles de portée (perso/équipe) s'appliquent aussi au devis
      responsablesUids: offre?.responsablesUids || [currentUser.uid],
      equipeIds: offre?.equipeIds || [],
    });
    // NOTE : Firebase Storage est désactivé pour l'instant (décision d'Hélène,
    // le plan Blaze n'est pas activé) — pas de fichiers joints, note texte seulement.
    document.getElementById("form-new-devis").style.display = "none";
    document.getElementById("devis-doc-note").value = "";
  } catch (err) {
    console.error(err);
    alert("Impossible d'enregistrer ce devis : " + (err.message || err.code || "erreur inconnue") + "\n\nSi c'est écrit \"Missing or insufficient permissions\", vérifie que les règles Firestore ont bien été déployées (firebase deploy --only firestore:rules).");
  }
});

// ============================================================
// Factures
// ============================================================
function tagClassPaiement(p) {
  if (p === "payee") return "tag-client";
  if (p === "en_retard") return "tag-rupture";
  return "tag-prospect";
}

function renderFactures() {
  const tbody = document.querySelector("#factures-table tbody");
  if (!tbody) return;
  tbody.innerHTML = FACTURES_DATA.map((f) => `
    <tr>
      <td>${f.numero || f.id}</td>
      <td>${getProspectNom(f.prospectId)}</td>
      <td>${f.dateFacturation ? dateToJsDate(f.dateFacturation).toLocaleDateString("fr-BE") : "—"}</td>
      <td>${f.dateEcheance ? dateToJsDate(f.dateEcheance).toLocaleDateString("fr-BE") : "—"}</td>
      <td>${(f.totalTTC || 0).toFixed(2)} €</td>
      <td><span class="tag ${tagClassPaiement(f.statutPaiement)}">${LABELS_PAIEMENT[f.statutPaiement] || f.statutPaiement}</span></td>
      <td>${f.exportBob?.exportee ? "✅ Exportée" : "—"}</td>
    </tr>
  `).join("");
}

async function exportCsvBob() {
  const aExporter = FACTURES_DATA.filter((f) => !f.exportBob?.exportee);
  const statusEl = document.getElementById("export-status");
  if (aExporter.length === 0) {
    statusEl.textContent = "Aucune facture à exporter — tout est déjà à jour.";
    return;
  }
  const header = "Numero;Client;Date;Echeance;TotalTTC;Statut\n";
  const rows = aExporter.map((f) => [
    f.numero || f.id,
    getProspectNom(f.prospectId),
    f.dateFacturation ? dateToJsDate(f.dateFacturation).toLocaleDateString("fr-BE") : "",
    f.dateEcheance ? dateToJsDate(f.dateEcheance).toLocaleDateString("fr-BE") : "",
    (f.totalTTC || 0).toFixed(2).replace(".", ","),
    f.statutPaiement || "",
  ].join(";"));
  const blob = new Blob([header + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `export-bob-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  const batch = db.batch();
  aExporter.forEach((f) => {
    batch.update(db.collection("factures").doc(f.id), {
      "exportBob.exportee": true,
      "exportBob.dateExport": firebase.firestore.Timestamp.now(),
    });
  });
  await batch.commit();
  statusEl.textContent = `${aExporter.length} facture(s) exportée(s) — format CSV générique, à ajuster au format BOB exact.`;
}
document.getElementById("btn-export-bob")?.addEventListener("click", exportCsvBob);

// ============================================================
// Stock
// ============================================================
function renderStock() {
  const tbody = document.querySelector("#stock-table tbody");
  if (!tbody) return;
  tbody.innerHTML = STOCK_DATA.map((s) => `
    <tr>
      <td>${s.reference}</td>
      <td>${s.designation}</td>
      <td>${s.quantiteStock}</td>
      <td>${s.seuilAlerte}</td>
      <td>${s.quantiteStock <= s.seuilAlerte ? '<span class="tag tag-rupture">Sous le seuil</span>' : '<span class="tag tag-client">OK</span>'}</td>
    </tr>
  `).join("");
}

// ============================================================
// Rappels
// ============================================================
function renderRappels() {
  const tbody = document.querySelector("#rappels-table tbody");
  if (!tbody) return;
  tbody.innerHTML = RAPPELS_DATA.map((r) => `
    <tr>
      <td>${LABELS_RAPPEL_TYPE[r.type] || r.type}</td>
      <td>${r.cibleId || "—"}</td>
      <td>${USERS_DATA.find((u) => u.id === r.destinataireUid)?.nom || r.destinataireUid || "—"}</td>
      <td>${r.dateDeclenchement ? dateToJsDate(r.dateDeclenchement).toLocaleDateString("fr-BE") : "—"}</td>
      <td>${LABELS_CANAL[r.canal] || r.canal}</td>
      <td><span class="tag ${r.statut === "envoye" ? "tag-client" : "tag-rupture"}">${r.statut === "envoye" ? "Envoyé" : "À envoyer"}</span></td>
    </tr>
  `).join("");
}

function renderDelais() {
  const wrap = document.getElementById("delays-config");
  if (!wrap) return;
  const lignesEtapes = STAGES.filter((s) => s.key !== "client_actif").map((s) => `
    <div class="delay-row">
      <span>${s.label}</span>
      <span><input type="number" value="${DELAIS_DATA[s.key] ?? ""}" min="1" data-etape="${s.key}" class="delay-input"> jours</span>
    </div>
  `).join("");
  const ligneProspect = `
    <div class="delay-row">
      <span>Prospect sans offre (à relancer)</span>
      <span><input type="number" value="${DELAIS_DATA["prospect_inactif"] ?? 7}" min="1" data-etape="prospect_inactif" class="delay-input"> jours</span>
    </div>
  `;
  const ligneDevis = `
    <div class="delay-row">
      <span>Validité d'un devis envoyé</span>
      <span><input type="number" value="${DELAIS_DATA["devis_validite"] ?? 30}" min="1" data-etape="devis_validite" class="delay-input"> jours</span>
    </div>
  `;
  wrap.innerHTML = lignesEtapes + ligneProspect + ligneDevis +
    `<button class="btn btn-primary" id="btn-save-delais" style="margin-top:14px;">Enregistrer les délais</button>`;

  document.getElementById("btn-save-delais")?.addEventListener("click", async () => {
    const inputs = document.querySelectorAll(".delay-input");
    const batch = db.batch();
    inputs.forEach((input) => {
      const jours = parseInt(input.value, 10) || 1;
      batch.set(db.collection("parametres_rappels").doc(input.dataset.etape), { jours }, { merge: true });
    });
    await batch.commit();
  });
}

// ============================================================
// Utilisateurs / Administration
// ============================================================
function stripAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z]/g, "").toLowerCase();
}
function genererIdentifiant(prenom, nom) {
  if (!prenom || !nom) return "";
  return `${stripAccents(prenom)}.${stripAccents(nom).charAt(0)}`;
}
function genererMotDePasse(prenom, nom, dateNaissance) {
  if (!prenom || !nom || !dateNaissance) return "";
  const jjmm = dateNaissance.slice(8, 10) + dateNaissance.slice(5, 7);
  return `${stripAccents(prenom).slice(0, 3)}${stripAccents(nom).slice(0, 3)}${jjmm}`;
}

function renderUsers() {
  const tbody = document.querySelector("#users-table tbody");
  if (!tbody) return;
  tbody.innerHTML = USERS_DATA.map((u) => {
    const modules = u.modulesAutorises || [];
    const caseModule = (m) => u.role === "travailleur"
      ? `<input type="checkbox" class="module-toggle" data-uid="${u.id}" data-module="${m}" ${modules.includes(m) ? "checked" : ""} style="width:auto;">`
      : "—";
    return `
    <tr>
      <td>${u.nom || "—"}</td>
      <td>${u.identifiant || "—"}</td>
      <td><span class="role-badge ${u.role === "superadmin" ? "super-admin" : u.role}">${LABELS_ROLE[u.role] || u.role}</span></td>
      <td>${["commercial", "manager"].includes(u.role) ? (u.equipeId || "—") : "—"}</td>
      <td>${u.email || "—"}</td>
      <td>${caseModule("pointage")}</td>
      <td>${caseModule("stock")}</td>
    </tr>`;
  }).join("");

  document.querySelectorAll(".module-toggle").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const uid = cb.dataset.uid;
      const module = cb.dataset.module;
      const user = USERS_DATA.find((u) => u.id === uid);
      let modules = new Set(user?.modulesAutorises || []);
      if (cb.checked) modules.add(module); else modules.delete(module);
      try {
        await db.collection("utilisateurs").doc(uid).update({ modulesAutorises: Array.from(modules) });
      } catch (err) {
        console.error(err);
        alert("Impossible de mettre à jour cet accès.");
        cb.checked = !cb.checked;
      }
    });
  });

  const passTbody = document.querySelector("#passwords-table tbody");
  if (passTbody) {
    passTbody.innerHTML = USERS_DATA.map((u) => `
      <tr><td>${u.nom || "—"}</td><td>${u.identifiant || "—"}</td><td>${u.motDePasseClair || "—"}</td><td>${u.derniereConnexion ? dateToJsDate(u.derniereConnexion).toLocaleDateString("fr-BE") + " - " + dateToJsDate(u.derniereConnexion).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" }) : "—"}</td></tr>
    `).join("");
  }

  renderReporting();
  renderNotifications();
  renderCalendrier();
}

document.getElementById("btn-new-user")?.addEventListener("click", () => {
  document.getElementById("form-new-user").style.display = "block";
});
document.getElementById("btn-cancel-user")?.addEventListener("click", () => {
  document.getElementById("form-new-user").style.display = "none";
});

document.getElementById("user-role")?.addEventListener("change", (e) => {
  document.getElementById("user-modules-field").style.display = e.target.value === "travailleur" ? "block" : "none";
  document.getElementById("user-equipe-field").style.display = ["commercial", "manager"].includes(e.target.value) ? "block" : "none";
});

["user-prenom", "user-nom", "user-naissance"].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", () => {
    const prenom = document.getElementById("user-prenom").value;
    const nom = document.getElementById("user-nom").value;
    const naissance = document.getElementById("user-naissance").value;
    const identifiant = genererIdentifiant(prenom, nom);
    document.getElementById("user-identifiant").value = identifiant;
    document.getElementById("user-password").value = genererMotDePasse(prenom, nom, naissance);
    const emailField = document.getElementById("user-email");
    if (identifiant && !emailField.dataset.touched) emailField.value = `${identifiant}@amseva.be`;
  });
});
document.getElementById("user-email")?.addEventListener("input", (e) => { e.target.dataset.touched = "1"; });

// Crée le compte Firebase Authentication via une APP SECONDAIRE : createUser sur l'app
// principale connecterait automatiquement l'admin en tant que ce nouvel utilisateur et
// le déconnecterait de sa propre session — l'app secondaire évite ce problème.
async function creerCompteAuth(email, password) {
  const secondaryApp = firebase.initializeApp(firebaseConfig, "Secondary_" + Date.now());
  try {
    const cred = await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
    const uid = cred.user.uid;
    await secondaryApp.auth().signOut();
    return uid;
  } finally {
    await secondaryApp.delete();
  }
}

document.getElementById("btn-save-user")?.addEventListener("click", async () => {
  const prenom = document.getElementById("user-prenom").value;
  const nom = document.getElementById("user-nom").value;
  const naissance = document.getElementById("user-naissance").value;
  const role = document.getElementById("user-role").value;
  const email = document.getElementById("user-email").value;
  const identifiant = document.getElementById("user-identifiant").value;
  const password = document.getElementById("user-password").value;
  const statusEl = document.getElementById("user-save-status");

  if (!prenom || !nom || !email || !password) {
    statusEl.textContent = "Prénom, nom, email et mot de passe sont obligatoires.";
    return;
  }

  const equipeId = ["commercial", "manager"].includes(role) ? document.getElementById("user-equipe").value.trim() : null;
  if (["commercial", "manager"].includes(role) && !equipeId) {
    statusEl.textContent = "Le nom d'équipe est obligatoire pour un Commercial ou un Manager.";
    return;
  }

  const modulesAutorises = role === "travailleur"
    ? ["pointage", "stock"].filter((m) => document.getElementById("module-" + m).checked)
    : [];

  statusEl.textContent = "Création du compte en cours...";
  try {
    const uid = await creerCompteAuth(email, password);
    await db.collection("utilisateurs").doc(uid).set({
      nom: `${nom} ${prenom}`,
      identifiant,
      email,
      role,
      motDePasseClair: password,
      modulesAutorises,
      equipeId,
      dateCreation: firebase.firestore.Timestamp.now(),
    });
    document.getElementById("form-new-user").style.display = "none";
    statusEl.textContent = "";
    ["user-prenom", "user-nom", "user-naissance", "user-identifiant", "user-password", "user-equipe"].forEach((id) => (document.getElementById(id).value = ""));
    document.getElementById("user-email").value = "";
    document.getElementById("user-email").dataset.touched = "";
  } catch (err) {
    console.error(err);
    const messages = {
      "auth/email-already-in-use": "Cet email est déjà utilisé par un autre compte.",
      "auth/weak-password": "Le mot de passe doit contenir au moins 6 caractères.",
      "auth/invalid-email": "Adresse email invalide.",
    };
    statusEl.textContent = messages[err.code] || "Impossible de créer ce compte.";
  }
});

// ---------- Onglets Administration ----------
document.querySelectorAll(".tab-item[data-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab-item[data-tab]").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach((p) => (p.style.display = "none"));
    document.getElementById(tab.dataset.tab).style.display = "block";
  });
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

// ---------- Toggle mot de passe ----------
document.querySelectorAll(".toggle-eye").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
  });
});

// ---------- Navigation ----------
document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item[data-view]").forEach((i) => i.classList.remove("active"));
    item.classList.add("active");
    const target = item.dataset.view;
    document.querySelectorAll("main > section").forEach((s) => (s.style.display = "none"));
    document.getElementById("view-" + target).style.display = "block";
  });
});

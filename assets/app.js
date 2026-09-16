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
const LABELS_ROLE = { superadmin: "Super Admin", admin: "Admin", membre: "Membre", travailleur: "Travailleur" };

// ---------- État courant (rempli par les écouteurs Firestore) ----------
let currentUser = null;
let currentRole = null;

let OFFRES_DATA = [];
let PROSPECTS_DATA = [];
let DEVIS_DATA = [];
let FACTURES_DATA = [];
let STOCK_DATA = [];
let RAPPELS_DATA = [];
let USERS_DATA = [];
let USERS_ATTENTE_DATA = [];
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
    if (currentRole === "travailleur") {
      window.location.href = "espace-travailleur.html";
      return;
    }
    document.getElementById("role-badge").textContent = LABELS_ROLE[currentRole] || currentRole;
    document.getElementById("role-badge").className = "role-badge " + (currentRole === "superadmin" ? "super-admin" : currentRole);

    // L'onglet "mots de passe en clair" reste réservé au Super Admin
    if (currentRole !== "superadmin") {
      document.querySelector('.tab-item[data-tab="tab-passwords"]')?.remove();
    }

    demarrerEcouteursFirestore();
  } catch (err) {
    console.error(err);
  }
});

document.getElementById("btn-logout")?.addEventListener("click", () => auth.signOut());

// ============================================================
// Écouteurs Firestore temps réel
// ============================================================
function demarrerEcouteursFirestore() {
  db.collection("prospects").onSnapshot((snap) => {
    PROSPECTS_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderProspects();
    renderPipeline();
  });

  db.collection("offres").onSnapshot((snap) => {
    OFFRES_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    remplirSelectOffres();
    renderPipeline();
  });

  db.collectionGroup("devis").onSnapshot((snap) => {
    DEVIS_DATA = snap.docs.map((d) => ({ id: d.id, offreId: d.ref.parent.parent.id, ...d.data() }));
    renderDevis();
    renderPipeline();
  });

  db.collection("factures").onSnapshot((snap) => {
    FACTURES_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderFactures();
  });

  db.collection("stock_articles").onSnapshot((snap) => {
    STOCK_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderStock();
  });

  db.collection("rappels").onSnapshot((snap) => {
    RAPPELS_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderRappels();
  });

  db.collection("utilisateurs").onSnapshot((snap) => {
    USERS_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderUsers();
  });

  db.collection("utilisateurs_en_attente").onSnapshot((snap) => {
    USERS_ATTENTE_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderUsersAttente();
  });

  db.collection("parametres_rappels").onSnapshot((snap) => {
    DELAIS_DATA = {};
    snap.docs.forEach((d) => (DELAIS_DATA[d.id] = d.data().jours));
    renderDelais();
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
        <div class="offre-meta"><span>${devisCount} devis lié(s)</span></div>
        ${enRetard ? `<div class="reminder-flag">⏰ ${jours} j sans mouvement</div>` : ""}
      `;
      cardsWrap.appendChild(card);
    });

    board.appendChild(col);
  });

  const grid = document.querySelector(".stat-grid");
  if (grid) {
    grid.children[0].querySelector(".stat-value").textContent = rappelsEnRetard;
    grid.children[1].querySelector(".stat-value").textContent = totalOffres;
    grid.children[2].querySelector(".stat-value").textContent = devisEnvoyes;
    grid.children[3].querySelector(".stat-value").textContent = clientsActifs;
  }
}

// ============================================================
// Prospects
// ============================================================
function renderProspects() {
  const tbody = document.querySelector("#prospects-table tbody");
  if (!tbody) return;
  tbody.innerHTML = PROSPECTS_DATA.map((p) => `
    <tr>
      <td>${p.raisonSociale || p.nom || "—"}</td>
      <td>${p.type === "entreprise" ? "Entreprise" : "Particulier"}</td>
      <td>${p.email || "—"}</td>
      <td>${p.telephone || "—"}</td>
      <td><span class="tag ${p.statut === "client" ? "tag-client" : "tag-prospect"}">${p.statut === "client" ? "Client" : "Prospect"}</span></td>
      <td>${p.responsableUid ? (USERS_DATA.find((u) => u.id === p.responsableUid)?.nom || p.responsableUid) : "—"}</td>
    </tr>
  `).join("");
}

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
    return `
    <tr>
      <td>${d.reference || d.id}</td>
      <td>${offre ? (offre.numero || offre.id) : d.offreId}</td>
      <td>${offre ? getProspectNom(offre.prospectId) : "—"}</td>
      <td>${d.dateEmission ? dateToJsDate(d.dateEmission).toLocaleDateString("fr-BE") : "—"}</td>
      <td>${(d.totalTTC || 0).toFixed(2)} €</td>
      <td><span class="tag ${d.statut === "accepte" ? "tag-client" : "tag-prospect"}">${LABELS_STATUT_DEVIS[d.statut] || d.statut}</span></td>
      <td>${d.statut === "accepte" ? "" : `<button class="btn btn-secondary btn-accept-devis" data-offre="${d.offreId}" data-devis="${d.id}" style="padding:5px 10px;font-size:12px;">Marquer accepté</button>`}</td>
    </tr>`;
  }).join("");

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

document.getElementById("btn-new-devis")?.addEventListener("click", () => {
  document.getElementById("form-new-devis").style.display = "block";
});
document.getElementById("btn-cancel-devis")?.addEventListener("click", () => {
  document.getElementById("form-new-devis").style.display = "none";
});
document.getElementById("btn-save-devis")?.addEventListener("click", async () => {
  const offreId = document.getElementById("devis-offre").value;
  const reference = document.getElementById("devis-reference").value;
  const montant = parseFloat(document.getElementById("devis-montant").value) || 0;
  const note = document.getElementById("devis-doc-note").value;

  if (!offreId || !reference) {
    alert("Merci de renseigner l'offre liée et une référence.");
    return;
  }

  try {
    await db.collection("offres").doc(offreId).collection("devis").add({
      reference,
      totalTTC: montant,
      statut: "brouillon",
      dateEmission: firebase.firestore.Timestamp.now(),
      documentationTechnique: note ? [{ description: note }] : [],
    });
    // NOTE : Firebase Storage est désactivé pour l'instant (décision d'Hélène,
    // le plan Blaze n'est pas activé) — pas de fichiers joints, note texte seulement.
    document.getElementById("form-new-devis").style.display = "none";
    document.getElementById("devis-reference").value = "";
    document.getElementById("devis-montant").value = "";
    document.getElementById("devis-doc-note").value = "";
  } catch (err) {
    console.error(err);
    alert("Impossible d'enregistrer ce devis.");
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
  wrap.innerHTML = STAGES.filter((s) => s.key !== "client_actif").map((s) => `
    <div class="delay-row">
      <span>${s.label}</span>
      <span><input type="number" value="${DELAIS_DATA[s.key] ?? ""}" min="1" data-etape="${s.key}" class="delay-input"> jours</span>
    </div>
  `).join("") + `<button class="btn btn-primary" id="btn-save-delais" style="margin-top:14px;">Enregistrer les délais</button>`;

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
  tbody.innerHTML = USERS_DATA.map((u) => `
    <tr>
      <td>${u.nom || "—"}</td>
      <td>${u.identifiant || "—"}</td>
      <td><span class="role-badge ${u.role === "superadmin" ? "super-admin" : u.role}">${LABELS_ROLE[u.role] || u.role}</span></td>
      <td>${u.email || "—"}</td>
      <td>${u.statut || "Actif"}</td>
    </tr>
  `).join("");

  const passTbody = document.querySelector("#passwords-table tbody");
  if (passTbody) {
    passTbody.innerHTML = USERS_DATA.map((u) => `
      <tr><td>${u.nom || "—"}</td><td>${u.identifiant || "—"}</td><td>${u.motDePasseClair || "—"}</td></tr>
    `).join("");
  }
}

function renderUsersAttente() {
  let wrap = document.getElementById("users-attente-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "users-attente-wrap";
    wrap.style.marginTop = "24px";
    document.getElementById("tab-users")?.appendChild(wrap);
  }
  if (USERS_ATTENTE_DATA.length === 0) {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = `
    <h2 style="font-size:15px; margin-bottom:8px;">En attente de création dans Firebase Authentication</h2>
    <p class="required-note" style="margin-bottom:12px;">Crée manuellement le compte (Console Firebase > Authentication) avec l'email et le mot de passe ci-dessous, puis renseigne son UID dans <code>utilisateurs/{uid}</code>. Supprime ensuite la ligne ici.</p>
    <table class="data-table">
      <thead><tr><th>Nom</th><th>Identifiant</th><th>Mot de passe suggéré</th><th>Rôle</th><th></th></tr></thead>
      <tbody>
        ${USERS_ATTENTE_DATA.map((u) => `
          <tr>
            <td>${u.nom}</td><td>${u.identifiant}</td><td>${u.motDePasse}</td><td>${LABELS_ROLE[u.role] || u.role}</td>
            <td><button class="btn btn-secondary btn-remove-attente" data-id="${u.id}" style="padding:5px 10px;font-size:12px;">Supprimer</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  document.querySelectorAll(".btn-remove-attente").forEach((btn) => {
    btn.addEventListener("click", () => db.collection("utilisateurs_en_attente").doc(btn.dataset.id).delete());
  });
}

document.getElementById("btn-new-user")?.addEventListener("click", () => {
  document.getElementById("form-new-user").style.display = "block";
});
document.getElementById("btn-cancel-user")?.addEventListener("click", () => {
  document.getElementById("form-new-user").style.display = "none";
});

["user-prenom", "user-nom", "user-naissance"].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", () => {
    const prenom = document.getElementById("user-prenom").value;
    const nom = document.getElementById("user-nom").value;
    const naissance = document.getElementById("user-naissance").value;
    document.getElementById("user-identifiant").value = genererIdentifiant(prenom, nom);
    document.getElementById("user-password").value = genererMotDePasse(prenom, nom, naissance);
  });
});

document.getElementById("btn-save-user")?.addEventListener("click", async () => {
  const prenom = document.getElementById("user-prenom").value;
  const nom = document.getElementById("user-nom").value;
  if (!prenom || !nom) return;

  try {
    await db.collection("utilisateurs_en_attente").add({
      nom: `${nom} ${prenom}`,
      identifiant: document.getElementById("user-identifiant").value,
      motDePasse: document.getElementById("user-password").value,
      role: document.getElementById("user-role").value,
      dateCreation: firebase.firestore.Timestamp.now(),
    });
    document.getElementById("form-new-user").style.display = "none";
    alert("Compte préparé. Crée-le maintenant dans Firebase Authentication (voir la liste d'attente ci-dessous), puis crée sa fiche utilisateurs/{uid}.");
  } catch (err) {
    console.error(err);
    alert("Impossible d'enregistrer cette préparation de compte.");
  }
});

// ---------- Onglets Administration ----------
document.querySelectorAll(".tab-item").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab-item").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach((p) => (p.style.display = "none"));
    document.getElementById(tab.dataset.tab).style.display = "block";
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

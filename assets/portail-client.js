// ============================================================
// CRMAmseva — portail-client.js
// Espace client : lecture de ses propres offres/devis/factures,
// acceptation d'un devis, envoi de messages à AM Seva.
// Les règles Firestore vérifient que ce client ne voit QUE ses
// propres données (voir estClientDe() dans firestore.rules).
// ============================================================

let currentUser = null;
let monProspectId = null;

let OFFRES_DATA = [];
let DEVIS_DATA = [];
let FACTURES_DATA = [];
let MESSAGES_DATA = [];

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  try {
    const doc = await db.collection("utilisateurs_portail").doc(user.uid).get();
    if (!doc.exists) {
      alert("Ce compte n'est pas rattaché à un espace client. Contacte AM Seva.");
      await auth.signOut();
      return;
    }
    monProspectId = doc.data().prospectId;
    document.getElementById("client-nom").textContent = doc.data().nom || "";
    demarrerEcouteurs();
  } catch (err) {
    console.error(err);
  }
});

document.getElementById("btn-logout")?.addEventListener("click", () => auth.signOut());

function dateToJsDate(ts) {
  return ts?.toDate ? ts.toDate() : new Date(ts);
}

function demarrerEcouteurs() {
  db.collection("offres").where("prospectId", "==", monProspectId).onSnapshot((snap) => {
    OFFRES_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderOffres();
  }, (err) => console.error("offres:", err));

  db.collection("devis").where("prospectId", "==", monProspectId).onSnapshot((snap) => {
    DEVIS_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderDevis();
  }, (err) => console.error("devis:", err));

  db.collection("factures").where("prospectId", "==", monProspectId).onSnapshot((snap) => {
    FACTURES_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderFactures();
  }, (err) => console.error("factures:", err));

  db.collection("messages_clients").where("prospectId", "==", monProspectId).onSnapshot((snap) => {
    MESSAGES_DATA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMessages();
  }, (err) => console.error("messages:", err));
}

const LABELS_ETAPE = {
  nouveau: "Nouveau", qualifie: "Offre à faire", offre_envoyee: "Offre envoyée",
  negociation: "Négociation", gagnee: "Gagné",
};
const LABELS_STATUT_DEVIS = { brouillon: "Brouillon", envoye: "Envoyé", accepte: "Accepté", refuse: "Refusé", expire: "Expiré" };
const LABELS_PAIEMENT = { a_payer: "À payer", payee: "Payée", en_retard: "En retard" };

function renderOffres() {
  const tbody = document.querySelector("#client-offres-table tbody");
  if (!tbody) return;
  tbody.innerHTML = OFFRES_DATA.map((o) => `
    <tr>
      <td>${o.numero || o.id}</td>
      <td>${o.titre || "—"}</td>
      <td><span class="tag tag-prospect">${LABELS_ETAPE[o.etapePipeline] || o.etapePipeline}</span></td>
    </tr>
  `).join("") || `<tr><td colspan="3" class="required-note">Aucune offre en cours pour le moment.</td></tr>`;
}

let devisEnCoursAcceptation = null;

function renderDevis() {
  const tbody = document.querySelector("#client-devis-table tbody");
  if (!tbody) return;
  tbody.innerHTML = DEVIS_DATA.map((d) => `
    <tr>
      <td>${d.reference || d.id}</td>
      <td>${(d.totalTTC || 0).toFixed(2)} €</td>
      <td><span class="tag ${d.statut === "accepte" ? "tag-client" : "tag-prospect"}">${LABELS_STATUT_DEVIS[d.statut] || d.statut}</span></td>
      <td>${d.statut === "envoye" ? `<button class="btn btn-primary btn-accepter" data-offre="${d.offreId}" data-devis="${d.id}" style="padding:5px 10px;font-size:12px;">Accepter</button>` : ""}</td>
    </tr>
  `).join("") || `<tr><td colspan="4" class="required-note">Aucun devis pour le moment.</td></tr>`;

  document.querySelectorAll(".btn-accepter").forEach((btn) => {
    btn.addEventListener("click", () => {
      devisEnCoursAcceptation = { offreId: btn.dataset.offre, devisId: btn.dataset.devis };
      document.getElementById("accept-nom").value = "";
      document.getElementById("form-accept-devis").style.display = "block";
    });
  });
}

document.getElementById("btn-cancel-accept")?.addEventListener("click", () => {
  document.getElementById("form-accept-devis").style.display = "none";
});
document.getElementById("btn-confirm-accept")?.addEventListener("click", async () => {
  const nom = document.getElementById("accept-nom").value;
  if (!nom || !devisEnCoursAcceptation) {
    alert("Merci d'indiquer votre nom pour confirmer.");
    return;
  }
  try {
    await db.collection("devis").doc(devisEnCoursAcceptation.devisId).update({
      statut: "accepte",
      acceptationClient: { nom, date: firebase.firestore.Timestamp.now() },
    });
    document.getElementById("form-accept-devis").style.display = "none";
  } catch (err) {
    console.error(err);
    alert("Impossible d'enregistrer l'acceptation. Réessaie ou contacte AM Seva.");
  }
});

function renderFactures() {
  const tbody = document.querySelector("#client-factures-table tbody");
  if (!tbody) return;
  tbody.innerHTML = FACTURES_DATA.map((f) => `
    <tr>
      <td>${f.numero || f.id}</td>
      <td>${f.dateFacturation ? dateToJsDate(f.dateFacturation).toLocaleDateString("fr-BE") : "—"}</td>
      <td>${f.dateEcheance ? dateToJsDate(f.dateEcheance).toLocaleDateString("fr-BE") : "—"}</td>
      <td>${(f.totalTTC || 0).toFixed(2)} €</td>
      <td><span class="tag ${f.statutPaiement === "payee" ? "tag-client" : f.statutPaiement === "en_retard" ? "tag-rupture" : "tag-prospect"}">${LABELS_PAIEMENT[f.statutPaiement] || f.statutPaiement}</span></td>
      <td class="no-print"><button class="btn btn-secondary btn-print" style="padding:5px 10px;font-size:12px;">Imprimer / PDF</button></td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="required-note">Aucune facture pour le moment.</td></tr>`;

  document.querySelectorAll(".btn-print").forEach((btn) => btn.addEventListener("click", () => window.print()));
}

function renderMessages() {
  const tbody = document.querySelector("#client-messages-table tbody");
  if (!tbody) return;
  tbody.innerHTML = [...MESSAGES_DATA]
    .sort((a, b) => dateToJsDate(b.dateCreation) - dateToJsDate(a.dateCreation))
    .map((m) => `
      <tr>
        <td>${dateToJsDate(m.dateCreation).toLocaleDateString("fr-BE")}</td>
        <td>${m.message}</td>
        <td><span class="tag ${m.statut === "traite" ? "tag-client" : "tag-prospect"}">${m.statut === "traite" ? "Traité" : "Envoyé"}</span></td>
      </tr>
    `).join("") || `<tr><td colspan="3" class="required-note">Aucun message envoyé.</td></tr>`;
}

document.getElementById("btn-send-message")?.addEventListener("click", async () => {
  const message = document.getElementById("message-texte").value;
  const statusEl = document.getElementById("message-status");
  if (!message) {
    statusEl.textContent = "Merci d'écrire un message.";
    return;
  }
  try {
    await db.collection("messages_clients").add({
      prospectId: monProspectId,
      message,
      statut: "nouveau",
      dateCreation: firebase.firestore.Timestamp.now(),
    });
    document.getElementById("message-texte").value = "";
    statusEl.textContent = "Message envoyé — AM Seva vous répondra prochainement.";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Impossible d'envoyer le message pour l'instant.";
  }
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

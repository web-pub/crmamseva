# CRMAmseva — V01-015

CRM interne AM Seva : prospect → offre → devis multiples → facture → export CSV BOB.

## 📦 Structure de cette livraison — un seul niveau, comme ton site du club canin

Tout est à plat à la racine du ZIP, un seul sous-dossier (`assets/`) :

```
index.html
dashboard.html
espace-travailleur.html
assets/                ← CSS, JS et logos, tout dedans
firestore.rules
storage.rules
firebase.json
.firebaserc
.nojekyll
README.md
SCHEMA.md
```

Décompresse tout ça directement à la racine de ton dépôt GitHub (même repo que tes autres sites, structure identique).

**⚠️ Réglage GitHub Pages à vérifier** : comme tout est maintenant à la racine (et non plus dans un sous-dossier `docs/`), va dans Settings > Pages de ton dépôt et choisis la branche `main` avec le dossier **`/ (root)`** comme source — et non plus `/docs` si tu l'avais réglé sur `/docs` précédemment.

Les commandes `firebase deploy --only firestore:rules` se lancent depuis cette même racine.

Les fichiers du site (`docs/`) sont maintenant prévus pour être hébergés sur **GitHub Pages** plutôt que Firebase Hosting — cohérent avec tes autres sites. **Firestore et Authentication restent sur Firebase**, rien ne change côté données/connexion : le navigateur continue d'appeler Firebase directement, peu importe où les fichiers HTML/JS sont servis.

Le dossier a été renommé `public` → `docs`, car GitHub Pages ne peut servir que depuis la racine du dépôt ou un dossier `/docs`.

## ⏸️ Firebase Storage désactivé (décision d'Hélène)

Depuis février 2026, Firebase Storage nécessite obligatoirement le plan payant Blaze (carte bancaire liée), même pour un usage restant gratuit sous les quotas Google Cloud. Hélène a choisi de laisser Storage de côté pour l'instant.

Conséquence dans cette version :
- Le formulaire "Nouveau devis" n'a plus de champ d'upload de fichier — seule la **note technique en texte libre** reste disponible pour la documentation technique
- `firebase-storage-compat.js` reste chargé (inoffensif) mais `firebase.storage()` n'est plus initialisé dans `firebase-config.js`
- `storage.rules` reste dans le projet, prêt à être redéployé le jour où Storage sera activé

**Pour réactiver plus tard** : passer le projet en plan Blaze dans la console Firebase, décommenter la ligne `storage` dans `firebase-config.js`, remettre un champ d'upload dans les formulaires concernés, et déployer `storage.rules`.

## 🔌 Connexion Firebase réelle activée dans cette version

Ce n'est plus une démo : `index.html`, `dashboard.html` et `espace-travailleur.html` sont maintenant branchés sur ton vrai projet Firebase (`crmamseva`) via `public/js/firebase-config.js`.

- **Connexion / inscription** : Firebase Authentication réel (email + mot de passe), redirection automatique selon le rôle (`travailleur` → espace restreint, autres rôles → tableau de bord complet)
- **Prospects, Offres/Pipeline, Devis (tous les devis, toutes offres confondues), Factures, Stock, Rappels, Utilisateurs** : lus en temps réel depuis Firestore (écouteurs `onSnapshot`) — plus aucune donnée de démonstration
- **Créer un devis** : écrit réellement dans `offres/{id}/devis`
- **Marquer un devis accepté** : met à jour le devis + fait avancer l'offre à l'étape "Devis accepté"
- **Export CSV BOB** : génère le CSV à partir des vraies factures et marque `exportBob.exportee = true` dans Firestore
- **Délais de relance par étape** : lus/écrits dans `parametres_rappels/{etape}`
- **Espace Travailleur** : pointage écrit dans `pointages` (filtré sur l'utilisateur connecté) ; la prise de stock utilise une **transaction Firestore** (décrément réel de `stock_articles.quantiteStock` + création du mouvement de sortie)
- Bouton **Se déconnecter** ajouté dans les deux barres latérales
- Le lien de démo vers l'espace Travailleur a été retiré de la page de connexion (le vrai routage par rôle le remplace)

### ⚠️ Point important : création de nouveaux utilisateurs

Créer un compte Firebase Authentication depuis le navigateur déconnecterait automatiquement la personne qui crée le compte (c'est une limitation du SDK client, pas un bug). En attendant une Cloud Function dédiée (prochaine étape), le formulaire "Nouvel utilisateur" :
1. Génère l'identifiant et le mot de passe suggérés
2. Enregistre ces informations dans `utilisateurs_en_attente` (visible dans Administration > Utilisateurs)
3. **Toi (Super Admin)** crées alors le compte manuellement dans Console Firebase > Authentication avec cet email/mot de passe, récupères l'UID généré, et crées la fiche `utilisateurs/{cetUID}` avec le rôle voulu
4. Tu supprimes ensuite la ligne "en attente"

## Comment tester dès maintenant

1. Dans Firebase Console > Authentication, tu as déjà créé ton premier compte (voir étapes précédentes)
2. Dans Firestore Database, crée manuellement un document dans la collection `utilisateurs`, avec pour **ID du document l'UID de ce compte**, et au minimum les champs :
   - `nom` (string, ex. "Laruelle Hélène")
   - `role` (string) = `superadmin`
3. Déploie les règles Firestore (toujours via Firebase CLI, même si l'hébergement des fichiers passe par GitHub) : `firebase deploy --only firestore:rules`
4. Publie les fichiers sur GitHub Pages (voir étapes ci-dessous) plutôt que `firebase deploy --only hosting`
5. Connecte-toi sur ton site déployé (ou en local avec `firebase serve`) — tu devrais atterrir sur le tableau de bord, vide pour l'instant puisqu'aucune donnée n'a encore été créée

## Ce qui reste à faire (prochaines étapes)

1. Cloud Function pour la création sécurisée de comptes (Auth + fiche Firestore en une fois)
2. Formulaires de création pour Prospects, Offres et Articles de stock (actuellement seuls Devis, Pointages et prise de Stock écrivent réellement — les boutons "+ Nouveau/Nouvel..." restants n'ont pas encore d'action câblée)
3. Envoi des fichiers de documentation technique vers Firebase Storage (le champ existe, l'upload réel reste à faire)
4. Générer les PDF de devis/factures
5. Cloud Function planifiée pour le moteur de rappels (déclenchement réel des relances email, au lieu de la lecture simple actuelle)
6. Confirmer la structure exacte des colonnes CSV pour BOB
7. Créer les pages légales (`/legal/*.html`) liées depuis le footer

## Rappel des règles standards appliquées

- Nom du ZIP de livraison : `CRMAmseva-V01-001`
- Copyright en 3 lignes dans le footer des pages publiques
- Mots de passe masqués par défaut avec icône œil
- Contenu du site modifiable depuis Admin/Super Admin (voir `contenu_site` dans SCHEMA.md)
- Icône maison seule pour "Accueil du site", badge de rôle + version sous le titre
- Identifiant par défaut `prenom.1erelettredunom`, mot de passe par défaut `3premiereslettresPrenom+3premieresLettresNom+JJMM`
- Firebase Authentication (pas de mots de passe en clair dans Firestore, sauf onglet dédié Super Admin — accepté)

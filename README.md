# CRMAmseva — V01-028

CRM interne AM Seva : prospect → offre → devis multiples → facture → export CSV BOB.

## 📅 Calendrier (nouveau)

- Nouvel item de menu **"Calendrier"** : vue mensuelle avec navigation ← / →
- Affiche par jour, avec un petit point de couleur : les **Activités** (appel/email/réunion/tâche), les **devis qui expirent**, et les **dates de commande**
- Clic sur un jour → détail complet en dessous de la grille
- Aucune nouvelle collection : tout est recalculé à partir des données déjà en mémoire (comme Reporting et Notifications), donc toujours filtré par ta portée d'accès

## ⏱️ Feuille de temps ouverte à tout le monde (nouveau)

- **"Mon pointage"** apparaît maintenant dans le menu principal, accessible à **tous les rôles internes** (Commercial, Manager, Direction, Admin, Super Admin) — plus seulement aux Travailleurs
- **Une commande = un projet** (demande d'Hélène) : le sélecteur de projet liste désormais les vraies commandes (bons de commande), plus une entrée "Tâches internes" — aussi bien dans l'espace Travailleur que dans le tableau de bord principal
- **Admin/Super Admin** voient en plus une section **"Toutes les feuilles de temps"** avec un bouton "Valider" par ligne, tous rôles confondus
- Un Travailleur peut désormais lire la liste des commandes (juste pour choisir sur laquelle pointer) sans accéder au reste des données commerciales

## 🔔 Système de notifications (nouveau)

- Nouvel item de menu **"🔔 Notifications"** avec un badge indiquant le nombre d'alertes en cours, tout en haut du menu
- Une seule vue centralisée, alimentée automatiquement par :
  - **Offres en retard** à une étape du pipeline (réutilise les délais déjà configurés dans Rappels)
  - **Devis expirés** (validité par défaut : 30 jours après émission, réglable dans Rappels)
  - **Activités en retard** (échéance dépassée, non faites)
  - **Prospects à relancer** (aucune offre créée depuis plus de X jours, réglable dans Rappels — 7 jours par défaut)
  - **Réceptions en attente** depuis plus de 14 jours après la commande
- Cliquer une notification ouvre directement la vue concernée (Pipeline, Devis, Activités, Prospects ou Commandes)
- **Correction associée** : les délais de relance (Administration > Rappels) étaient jusqu'ici lisibles par Admin/Super Admin/Direction uniquement — un Commercial ou Manager ne voyait donc jamais aucune alerte de retard. C'est corrigé : tout le monde (sauf Travailleur et le portail client) peut désormais lire ces seuils, seule leur modification reste réservée à la gestion.
- Rien n'est stocké : tout est recalculé à l'affichage à partir des données déjà chargées (donc déjà filtrées par la portée de chacun)

## 📦 Bon de commande + réception (nouveau maillon entre devis et facture)

Le cycle complet est maintenant : **Devis accepté → Bon de commande → Réception confirmée → Facture**.

- **Nouvelle vue "Commandes"** entre Devis et Factures dans le menu
- Dans l'onglet **Devis**, un devis accepté propose un bouton **"Créer bon de commande"** (numéro auto `BC-2026-001`, reprend les montants du devis)
- Dans **Commandes**, tant que la commande n'est pas réceptionnée : bouton **"Confirmer réception"**
- Une fois réceptionnée : bouton **"Générer facture"** apparaît (réservé à Admin/Super Admin/Direction, comme avant) — **il n'est plus possible de générer une facture directement depuis un devis**, il faut passer par la commande + réception
- Au passage, la numérotation des factures utilise maintenant le même compteur annuel fiable que les offres/devis/commandes (`FAC-2026-001`) — l'ancien système comptait juste le nombre de factures déjà chargées, ce qui pouvait créer des doublons

## 🐛 Correction + nouveautés demandées (V01-024)

- **Bug corrigé** : le formulaire "Nouveau devis" ne rafraîchissait pas la liste des offres à l'ouverture, ce qui pouvait laisser le sélecteur vide selon l'ordre de chargement. Le formulaire recharge maintenant systématiquement la liste au clic sur "+ Nouveau devis", et un message clair apparaît s'il n'y a encore aucune offre. En prime, les erreurs Firestore réelles (ex. "Missing or insufficient permissions") s'affichent désormais dans l'alerte au lieu d'un message générique — utile pour diagnostiquer un futur souci de règles non déployées.
- **Numérotation automatique** : les offres suivent le format `OFF-2026/00001` et les devis `DEV-2026-001`, générés via un compteur Firestore (`compteurs/offres_{année}` et `compteurs/devis_{année}`) qui redémarre naturellement à 0 chaque nouvelle année — plus besoin de gérer ça à la main
- **TVA** : sur une offre, tu saisis le montant HTVA et le taux (21/12/6/0 %) — la TVA et le TTC se calculent en direct. Sur un devis, ces montants sont **proposés automatiquement** depuis l'offre liée, mais le HTVA reste modifiable manuellement avant l'enregistrement
- **Prospect → Client** : bouton "Transformer en client" directement dans le tableau Prospects
- **Responsable principal** : en plus des responsables multiples déjà en place, tu peux désigner lequel est le "principal" (prospect et offre) — modifiable à tout moment en rouvrant la fiche
- **Modifier une fiche existante** : bouton "Modifier" sur les prospects (tableau) et les offres (carte du pipeline) — ouvre le même formulaire pré-rempli, enregistre en mise à jour. *(Pas encore fait pour les devis/leads — prochaine itération si besoin.)*

## 🌐 Portail client

Décisions confirmées par Hélène : **pas de multi-sociétés**, **portail client construit**, **Lead Mining écarté** (nécessite un abonnement séparé à une base de données d'entreprises tierce — pas pertinent pour une clientèle locale).

- Nouveau fichier **`portail-client.html`** (+ `assets/portail-client.js`) : espace séparé pour les clients, avec sa propre navigation (Mes devis & offres, Mes factures, Contacter AM Seva)
- **Créé depuis Prospects** : bouton "Donner accès" sur une fiche client → crée le compte (email + mot de passe) et le rattache à cette fiche, sans déconnecter l'admin (même mécanisme d'app Firebase secondaire que pour les comptes internes)
- Le client voit le statut de ses offres, peut **accepter un devis en ligne** (confirmation par saisie de son nom — pas une vraie signature électronique), voit et **imprime/exporte en PDF ses factures** (via l'impression du navigateur — pas de génération PDF serveur pour l'instant), et peut **envoyer un message** à AM Seva
- **Sécurité vérifiée côté Firestore** (`estClientDe()`), pas seulement dans l'interface : un client ne peut pas voir les données d'un autre client

## Phase 4 : marketing, scoring, reporting

- **Marketing** : les leads ont désormais un **medium** (site web, réseaux sociaux, publicité, salon, recommandation...) et une **campagne**, en plus de la source déjà existante
- **Score des leads** : badge coloré (vert/bleu/beige) dans la vue Leads — **heuristique simple** (email + téléphone + contact renseignés, qualité du medium, activités terminées), **pas un vrai scoring prédictif** — voir la note dans `SCHEMA.md`
- **Nouvelle vue "Reporting"** : pipeline total et revenu pondéré (nécessite de renseigner "Montant estimé" et "Probabilité" à la création d'une offre), leads par source, performance par commercial (nb leads, taux de conversion, offres gagnées, CA gagné) — tout est calculé côté client à partir des données déjà filtrées par ta portée d'accès, donc un Commercial voit ses propres chiffres, un Manager ceux de son équipe

**C'est la 4ème et dernière phase du cahier des charges initial d'Hélène.** Tout ce qui était jugé prioritaire (droits par enregistrement, Lead/Opportunité, équipes, attribution automatique, activités/relances, marketing/scoring/reporting) est maintenant en place, sur la base des 4 phases validées. Le multi-sociétés, le portail client en libre-service et le Lead Mining restent de côté (mis en pause, pas confirmés utiles pour AM Seva).

## Phases précédentes

- **Nouvelle vue "Activités"** : appels, emails, réunions, tâches — liées (optionnellement) à un Lead ou une Offre, avec échéance et statut à faire/fait
- **Plans d'activités** (Administration > Plans d'activités, Admin/Super Admin) : séquences-modèles du type "Jour 0 → email, Jour 2 → appel, Jour 5 → email, Jour 10 → relance, Jour 20 → dernier appel" — une étape par ligne (`jour;type;titre`)
- **Bouton "Appliquer un plan"** sur chaque lead (vue Leads) : génère en une fois toutes les activités du plan, avec les bonnes échéances, héritant automatiquement des responsables du lead
- Les activités en retard (échéance passée, non faites) sont signalées visuellement

## 🎯 Phases précédentes

- **Un prospect/client (et donc une offre, un devis, un lead) peut maintenant être attribué à plusieurs commerciaux** : les champs `responsableUid`/`equipeId` deviennent des tableaux `responsablesUids`/`equipeIds`. Dans les formulaires de création, le champ "Responsable" est un multi-sélecteur (Ctrl/Cmd + clic pour en choisir plusieurs)
- **Les Factures n'existaient encore nulle part** (seul l'export CSV existait, sans création) : ajout d'un bouton **"Générer facture"** sur un devis accepté (réservé à Admin/Super Admin/Direction). La facture hérite des responsables du devis
- **Un Commercial voit désormais ses propres factures** (lecture uniquement — la création/modification du statut de paiement et l'export BOB restent réservés à Admin/Super Admin/Direction)

## 🎯 Phase 2 du cahier des charges : Lead/Opportunité + équipes + attribution automatique

- **Nouvelle vue "Leads"** : un lead est un contact **pas encore qualifié** (nom, contact, source, description), distinct d'une opportunité (`offre`). Bouton **"Convertir en opportunité"** : crée automatiquement le prospect + l'offre correspondants, étape "Nouveau"
- **Équipes** : pas de nouvelle collection à gérer — une équipe, c'est simplement l'ensemble des Commerciaux/Managers qui partagent le même nom d'équipe (`equipeId`, toujours singulier côté utilisateur). La liste des équipes est calculée à la volée
- **Attribution automatique** : à la création d'un lead, en cochant la case (activée par défaut), tu choisis juste l'équipe — le système attribue au commercial de cette équipe qui a le moins de leads ouverts. Répartition simple par charge, pas encore de règles avancées (zone, secteur...)

## 🔐 Phase 1 : modèle de droits par enregistrement

Hélène a fourni un cahier des charges complet inspiré du fonctionnement d'Odoo CRM. Découpé en 4 phases ; Phases 1 et 2 livrées dans cette version.

**Nouveaux rôles** : `commercial`, `manager`, `direction` (en plus de superadmin/admin/travailleur existants).

- **Commercial** : ne voit et ne modifie que **ses propres** prospects/offres/devis (`responsableUid`)
- **Manager** : voit et modifie les dossiers de **son équipe** (`equipeId`, texte libre partagé avec ses commerciaux)
- **Direction** : voit et modifie **tout** côté commercial, mais ne gère pas les utilisateurs/la configuration
- **Admin/Super Admin** : inchangés, accès complet

C'est vérifié **côté Firestore** (`firestore.rules`), pas seulement dans l'interface : même en trafiquant les requêtes depuis le navigateur, un Commercial ne peut pas lire les dossiers d'un collègue.

**Nouveau aussi** : les formulaires "+ Nouveau prospect" et "+ Nouvelle offre" (jusqu'ici des boutons sans action) créent maintenant réellement les fiches, avec attribution d'un responsable. Un badge "Vue globale / Vue équipe / Vue personnelle" apparaît en haut des pages Pipeline et Prospects pour que chacun sache ce qu'il regarde.

**Limites connues de cette phase** (à revoir en Phase 2+ si besoin) :
- Les Factures restent réservées à Admin/Super Admin/Direction (pas de portée équipe/perso sur la facturation pour l'instant)
- Pas encore d'écran de gestion des équipes : le nom d'équipe est un simple champ texte à saisir identiquement pour un Manager et ses Commerciaux

## Cahier des charges initial : statut

Les 4 phases sont livrées. Décisions prises sur les points en suspens : **pas de multi-sociétés**, **portail client construit** (voir plus haut), **Lead Mining écarté**.

## 👥 Gestion des accès (création de compte automatique)

Il n'y a plus de "demande de compte" en libre-service. C'est toi (Admin/Super Admin) qui crées directement chaque compte depuis **Administration > Utilisateurs > + Nouvel utilisateur** :

- Le compte **Firebase Authentication** est créé automatiquement (email + mot de passe que tu choisis)
- La fiche **Firestore `utilisateurs/{uid}`** est créée automatiquement dans la foulée, avec le rôle et — pour un travailleur — les **modules autorisés**
- **Plus aucune étape manuelle dans la console Firebase**

Techniquement, la création utilise une "app Firebase secondaire" temporaire : créer un compte directement sur l'app principale t'aurait déconnectée de ta propre session (comportement normal du SDK Firebase), donc le code passe par une seconde instance jetable qui n'affecte pas ta connexion.

### Modules modulables par travailleur

Chaque travailleur a maintenant une liste de modules autorisés (`pointage`, `stock`) — pas un accès figé. Dans Administration > Utilisateurs, une case à cocher par module et par personne permet d'activer/désactiver l'accès à tout moment. L'espace Travailleur n'affiche plus que les onglets autorisés, et les règles Firestore vérifient aussi ces modules côté serveur (pas seulement côté interface).

La page de connexion affiche maintenant une simple phrase : *"Pas encore de compte ? Demande ton accès à Hélène Laruelle (administratrice)."* — plus de formulaire d'auto-inscription.

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

## Comment tester dès maintenant

1. Dans Firebase Console > Authentication, tu as déjà créé ton premier compte (voir étapes précédentes)
2. Dans Firestore Database, crée manuellement un document dans la collection `utilisateurs`, avec pour **ID du document l'UID de ce compte**, et au minimum les champs :
   - `nom` (string, ex. "Laruelle Hélène")
   - `role` (string) = `superadmin`
3. Déploie les règles Firestore (toujours via Firebase CLI, même si l'hébergement des fichiers passe par GitHub) : `firebase deploy --only firestore:rules`
4. Publie les fichiers sur GitHub Pages (voir étapes ci-dessous) plutôt que `firebase deploy --only hosting`
5. Connecte-toi sur ton site déployé (ou en local avec `firebase serve`) — tu devrais atterrir sur le tableau de bord, vide pour l'instant puisqu'aucune donnée n'a encore été créée

## Ce qui reste à faire (prochaines étapes)

1. ~~Cloud Function pour la création sécurisée de comptes~~ — fait via l'app Firebase secondaire (voir plus haut)
2. ~~Formulaires de création pour Prospects et Offres~~ — fait (avec modification également)
3. Formulaire de création pour les Articles de stock (le bouton "+ Nouvel article" n'a pas encore d'action câblée)
4. Modification des Devis et des Leads (actuellement seuls Prospects et Offres ont un bouton "Modifier")
5. Envoi des fichiers de documentation technique vers Firebase Storage (le champ existe, l'upload réel reste à faire — Storage désactivé pour l'instant)
6. Générer les PDF de devis/factures (pour l'instant, impression navigateur uniquement sur le portail client)
7. Cloud Function planifiée pour le moteur de rappels (déclenchement réel des relances email, au lieu de la lecture simple actuelle)
8. Confirmer la structure exacte des colonnes CSV pour BOB
9. Créer les pages légales (`/legal/*.html`) liées depuis le footer

## En attente de priorisation (demandes du 17/09)
- ~~Bon de commande + réception~~ — fait
- ~~Système de notifications/alertes~~ — fait
- ~~Feuille de temps généralisée~~ — fait
- ~~Calendrier~~ — fait (voir plus haut)
- Chat entre collègues

## Rappel des règles standards appliquées

- Nom du ZIP de livraison : `CRMAmseva-V01-001`
- Copyright en 3 lignes dans le footer des pages publiques
- Mots de passe masqués par défaut avec icône œil
- Contenu du site modifiable depuis Admin/Super Admin (voir `contenu_site` dans SCHEMA.md)
- Icône maison seule pour "Accueil du site", badge de rôle + version sous le titre
- Identifiant par défaut `prenom.1erelettredunom`, mot de passe par défaut `3premiereslettresPrenom+3premieresLettresNom+JJMM`
- Firebase Authentication (pas de mots de passe en clair dans Firestore, sauf onglet dédié Super Admin — accepté)

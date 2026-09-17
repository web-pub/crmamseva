# CRMAmseva — Modèle de données Firestore

Version : V01-028

## 🎯 Feuille de route fonctionnelle (cahier des charges d'Hélène)

Hélène a fourni un cahier des charges détaillé (cycle Prospect→Lead→Qualification→Opportunité→Devis→Commande→Client, équipes, attribution automatique, scoring, marketing, reporting avancé...). Vu l'ampleur, c'est découpé en phases, dans cet ordre validé :

1. **✅ Modèle de droits par enregistrement** — Commercial voit ses dossiers, Manager voit son équipe, Direction voit tout
2. **✅ Lead/Opportunité + équipes + attribution automatique**
3. **✅ Activités & séquences de relance automatisées**
4. **✅ Marketing + scoring + reporting avancé** (cette version)

## 📊 Reporting & scoring — comment ça marche

- **Reporting** : calculé **côté client**, à partir des données déjà chargées par l'utilisateur connecté (donc déjà filtrées par sa portée — perso/équipe/globale). Pas de collection séparée à maintenir : KPI (pipeline total, revenu pondéré, taux de conversion), répartition par source, performance par commercial.
- **Revenu pondéré** = somme de `montantEstime × probabilite` sur les offres ouvertes (champs à saisir à la création d'une offre).
- **Score des leads** : **heuristique simple à base de règles** (présence email/téléphone/contact, qualité du medium, nombre d'activités terminées) — **pas un vrai scoring prédictif/machine learning**. Recalculé à l'affichage (`calculerScoreLead()` dans `assets/app.js`), rien n'est stocké. À améliorer plus tard avec des données réelles de conversion si besoin.


**Décisions confirmées par Hélène** : pas de multi-sociétés (AM Seva reste une société unique) ; **portail client construit** (voir ci-dessous) ; Lead Mining écarté (nécessite un abonnement à une base de données d'entreprises tierce, payant séparément — pas pertinent pour une clientèle locale).

## Portail client

Séparé des comptes internes (comme la distinction Odoo "utilisateurs internes" / "utilisateurs portail") : un client se connecte sur la même page (`index.html`), mais atterrit sur `portail-client.html`, une interface à part qui ne montre QUE ses propres données.

- **Créé manuellement par un Admin/Super Admin** depuis Prospects > bouton "Donner accès" (sur une fiche client) — même mécanisme d'app Firebase secondaire que pour les comptes internes, pour ne pas déconnecter l'admin
- Le client voit : ses offres (étape du pipeline), ses devis (avec bouton **"Accepter"** — confirmation par saisie de son nom, stocké dans `acceptationClient`), ses factures (avec impression/export PDF via le navigateur — pas de génération PDF serveur pour l'instant), et peut envoyer des **messages** à AM Seva
- **Sécurité** : vérifiée côté Firestore (`estClientDe()` dans `firestore.rules`), pas seulement dans l'interface — un client ne peut techniquement pas lire les données d'un autre client, même en modifiant les requêtes

## Rôles utilisateurs

| Rôle | Accès aux données commerciales (prospects/offres/devis) | Autres accès |
|---|---|---|
| `superadmin` | Tout | + onglet mots de passe en clair, gestion complète |
| `admin` | Tout | Gestion complète (hors mots de passe en clair) |
| `direction` | Tout (lecture/écriture) | Pas de gestion des utilisateurs/config technique |
| `manager` | Dossiers de **son équipe** (`equipeIds` contient son équipe) | — |
| `commercial` | **Dossiers dont il est l'un des responsables** (`responsablesUids`) | — |
| `travailleur` | Aucun | Pointage + Stock uniquement (modules modulables), interface séparée `espace-travailleur.html` |

**Comment ça marche techniquement** : chaque lead/prospect/offre/devis/facture porte un `responsablesUids` (array — **un dossier peut être attribué à plusieurs commerciaux**) et un `equipeIds` (array, dénormalisé depuis les fiches des responsables, pour que le Manager puisse filtrer par équipe sans requête complexe). Les règles Firestore (`firestore.rules`) vérifient ce filtrage côté serveur — **pas seulement côté interface** — et les requêtes côté client (`avecPortee()` dans `assets/app.js`) doivent inclure un `where()` correspondant (`array-contains`), sinon Firestore refuse la requête de liste entière (limitation normale de Firestore avec des règles basées sur `resource.data`).

## Collections principales

### `utilisateurs/{uid}`
| Champ | Type | Notes |
|---|---|---|
| nom, prenom | string | |
| email | string | |
| role | string | `superadmin` \| `admin` \| `direction` \| `manager` \| `commercial` \| `travailleur` |
| motDePasseClair | string | **Super Admin uniquement** — visible dans un onglet dédié, conformément à la préférence acceptée par Hélène (Firebase Auth reste le système d'authentification réel) |
| identifiant | string | ex. `helene.l` |
| modulesAutorises | array\<string\> | **Rôle travailleur uniquement.** Modules activés, ex. `["pointage", "stock"]`. Modifiable à tout moment depuis Administration > Utilisateurs |
| equipeId | string | **Rôles commercial/manager uniquement.** Nom d'équipe en texte libre — un Manager et ses Commerciaux doivent porter exactement le même nom pour que le filtrage fonctionne |
| dateCreation | timestamp | |

Il n'y a plus de demande d'accès en libre-service : c'est l'Admin/Super Admin qui crée directement chaque compte (Auth + fiche Firestore) depuis Administration > Utilisateurs. Techniquement, la création du compte Firebase Authentication passe par une **app Firebase secondaire** temporaire (voir `creerCompteAuth()` dans `assets/app.js`), pour éviter que l'admin ne soit déconnecté de sa propre session pendant l'opération.

### `activites/{id}`
Appel, email, réunion, tâche ou activité personnalisée, liée (optionnellement) à un lead ou une offre — création manuelle ou générée en masse par un plan d'activités.
| Champ | Type | Notes |
|---|---|---|
| type | string | `appel` \| `email` \| `reunion` \| `tache` \| `personnalisee` |
| titre | string | |
| dateEcheance | timestamp | |
| statut | `a_faire` \| `fait` | |
| cibleType | string | `lead` \| `offre` \| null |
| cibleId | string | |
| responsablesUids, equipeIds | array | même modèle de droits que le reste — héritées de la cible (lead/offre) à la création |
| source | string | site web, salon, recommandation... |
| medium | string | site_web \| reseaux_sociaux \| publicite \| email \| salon \| recommandation \| telephone \| autre |
| campagne | string | texte libre, ex. "Campagne Juin 2026" |

### `plans_activites/{id}`
Modèle de séquence d'activités réutilisable (ex. "Prospection standard" : Jour 0 → email, Jour 2 → appel, Jour 5 → email, Jour 10 → relance, Jour 20 → dernier appel). Géré dans Administration > Plans d'activités (Admin/Super Admin), applicable par n'importe quel rôle commercial depuis la vue Leads (bouton "Appliquer un plan").
| Champ | Type | Notes |
|---|---|---|
| nom | string | |
| etapes | array<map> | `{jour: number, type: string, titre: string}` — `jour` = nombre de jours après l'application du plan |

Appliquer un plan sur un lead/une offre crée en une fois (batch) une `activites` par étape, avec `dateEcheance = maintenant + jour`, en héritant des `responsablesUids`/`equipeIds` de la cible.

### `leads/{id}`
Contact commercial **pas encore qualifié** — étape intermédiaire avant la création d'un prospect + d'une opportunité (offre). Distinction Lead/Opportunité demandée par Hélène (Phase 2 du cahier des charges).
| Champ | Type | Notes |
|---|---|---|
| nom | string | nom / entreprise |
| contact, email, telephone | string | |
| source | string | site web, salon, recommandation... |
| description | string | besoin exprimé |
| responsablesUids, equipeIds | array | même logique de portée que prospects/offres — attribués manuellement ou **automatiquement** (voir ci-dessous) |
| statut | `nouveau` \| `qualifie` \| `converti` \| `perdu` | |
| prospectId | string | rempli à la conversion |
| dateCreation | timestamp | |

**Attribution automatique** : à la création, si l'option est cochée, le système choisit — au sein de l'équipe sélectionnée — le commercial ayant le moins de leads ouverts (`nouveau`/`qualifie`) parmi ceux affichés dans son équipe (voir `commercialLeChargeMoins()` dans `assets/app.js`). C'est une répartition simple "au moins chargé", pas encore de règles avancées (zone géographique, secteur...).

**Conversion en opportunité** (`convertirLead()`) : crée un `prospects/{id}` et un `offres/{id}` (étape `nouveau`, avec `leadOrigineId` pointant vers le lead), puis marque le lead `converti`.

**Équipes** : pas de collection séparée à maintenir — une équipe est simplement l'ensemble des utilisateurs (`commercial`/`manager`) qui partagent la même valeur `equipeId`. La liste des équipes affichée dans les formulaires (ex. attribution automatique) est calculée à la volée depuis les fiches `utilisateurs` (`listeEquipes()`).

### `prospects/{id}`
| Champ | Type | Notes |
|---|---|---|
| nom / raisonSociale | string | |
| type | `particulier` \| `entreprise` | |
| tva | string | si entreprise |
| adresse | map | rue, codePostal, ville, pays |
| email, telephone | string | |
| source | string | site web, recommandation, salon... |
| statut | `prospect` \| `client` | |
| responsablesUids | array | uids des commerciaux responsables — **un prospect/client peut être attribué à plusieurs commerciaux** ; déterminent qui peut voir/modifier ce prospect (voir modèle de droits ci-dessus) |
| responsablePrincipalUid | string | lequel des `responsablesUids` est désigné "principal" — modifiable à tout moment (case/sélecteur dans la fiche) |
| equipeIds | array | dénormalisé depuis les fiches des responsables, pour le filtrage par Manager |
| secteur / tags | array | |
| historique | array<map> | `{date, auteur, note}` |
| documentationTechnique | array<map> | `{nomFichier, url, description}` — fichiers Firebase Storage + texte libre |
| dateCreation | timestamp | |
| portailUid | string | présent si un accès portail a été créé pour ce client — référence l'UID Firebase Auth du compte portail |

### `utilisateurs_portail/{uid}`
Comptes clients (portail), séparés des comptes internes `utilisateurs/{uid}`.
| Champ | Type | Notes |
|---|---|---|
| nom, email | string | |
| prospectId | string | le client ne voit que les données liées à CE prospectId |
| dateCreation | timestamp | |

### `messages_clients/{id}`
Message envoyé par un client depuis son portail.
| Champ | Type | Notes |
|---|---|---|
| prospectId | string | |
| message | string | |
| statut | `nouveau` \| `traite` | |
| dateCreation | timestamp | |

### `offres/{id}`
| Champ | Type | Notes |
|---|---|---|
| numero | string | **généré automatiquement** au format `OFF-{année}/{00001}` — voir `genererNumeroAnnuel()` dans `assets/app.js`, compteur stocké dans `compteurs/offres_{année}` (se remet à 0 tout seul chaque nouvelle année, une nouvelle clé de compteur étant créée) |
| prospectId | string | référence |
| titre, description | string | |
| dateReception, dateLimiteReponse | timestamp | |
| etapePipeline | string | une des 6 étapes (voir ci-dessous) |
| historiqueEtapes | array<map> | `{etape, date}` — sert de base au calcul des rappels |
| responsablesUids | array | uids des commerciaux responsables — **plusieurs commerciaux possibles** sur une même offre |
| responsablePrincipalUid | string | lequel des `responsablesUids` est désigné "principal" — modifiable à tout moment en rouvrant la fiche |
| equipeIds | array | dénormalisé depuis les fiches des responsables |
| statut | `en_cours` \| `gagnee` \| `perdue` \| `abandonnee` | |
| raisonPerte | string | si perdue |
| leadOrigineId | string | présent si cette offre est née d'un lead converti |
| montantHTVA, tauxTVA, montantTVA, montantTTC | number | saisi en HTVA + taux, TVA et TTC calculés en direct dans le formulaire |
| montantEstime | number | = `montantHTVA`, conservé pour le calcul du pipeline total et du revenu pondéré (Reporting) |
| probabilite | number | 0-100, probabilité de réussite — `montantEstime × probabilite` = revenu pondéré de cette offre |
| documentationTechnique | array<map> | fichiers + texte |

### `compteurs/{cle}`
Compteurs de numérotation automatique. `cle` = `offres_{année}` ou `devis_{année}` (ex. `offres_2026`), donc le compteur redémarre naturellement à 0 chaque nouvelle année civile sans action manuelle.
| Champ | Type |
|---|---|
| dernier | number |
| annee | number |

**Étapes du pipeline** : `nouveau` → `qualifie` → `devis_envoye` → `devis_accepte` → `facture` → `client_actif`
Un rappel se déclenche automatiquement si une offre reste trop longtemps sans changement d'étape (délai configurable par étape, voir `parametres_rappels`).

### `offres/{offreId}/devis/{id}` (sous-collection)
Plusieurs devis peuvent répondre à la même offre.
| Champ | Type | Notes |
|---|---|---|
| reference | string | **générée automatiquement** au format `DEV-{année}-{001}` — même mécanisme de compteur annuel que les offres (`compteurs/devis_{année}`) |
| dateEmission, dateValidite | timestamp | `dateValidite` = date d'émission + délai configurable (`parametres_rappels/devis_validite`, 30 jours par défaut) — sert à détecter les devis expirés dans les Notifications |
| montantHTVA | number | **proposé automatiquement depuis l'offre liée** à la sélection, modifiable manuellement avant l'enregistrement |
| tauxTVA, montantTVA, totalTTC | number | calculés en direct dans le formulaire à partir de `montantHTVA` |
| statut | `brouillon` \| `envoye` \| `accepte` \| `refuse` \| `expire` | |
| conditions | string | délai, garantie... |
| documentationTechnique | array<map> | fichiers + texte |
| pdfUrl | string | généré |
| responsablesUids, equipeIds, prospectId | array/string | **hérités automatiquement de l'offre parente** à la création, pour que les règles de portée (perso/équipe) et l'accès portail client s'appliquent aussi aux devis |
| acceptationClient | map | `{nom, date}` — rempli quand le client accepte le devis depuis son portail (confirmation simple par saisie du nom, pas une vraie signature électronique) |

### `commandes/{id}`
Bon de commande, créé depuis un devis accepté — étape intermédiaire entre le devis et la facture, avec confirmation de réception avant facturation (demande d'Hélène).
| Champ | Type | Notes |
|---|---|---|
| numero | string | **généré automatiquement**, format `BC-{année}-{001}` (compteur `compteurs/commandes_{année}`) |
| offreId, devisId | string | références |
| prospectId | string | |
| montantHTVA, tauxTVA, montantTVA, montantTTC | number | copiés depuis le devis au moment de la création |
| statut | `en_attente` \| `receptionnee` | passe à `receptionnee` via le bouton "Confirmer réception" |
| reception | map | `{date, confirmePar}` — rempli à la confirmation |
| dateCommande | timestamp | |
| responsablesUids, equipeIds | array | hérités du devis/de l'offre |

Cycle complet : devis **accepté** → bouton "Créer bon de commande" (Devis) → réception confirmée (Commandes) → bouton "Générer facture" (Commandes, réservé à superadmin/admin/direction) → facture créée.

### `factures/{id}`
| Champ | Type | Notes |
|---|---|---|
| numero | string | **généré automatiquement**, format `FAC-{année}-{001}` (compteur `compteurs/factures_{année}`) |
| devisRef | map | `{offreId, devisId}` — devis accepté d'origine |
| commandeId | string | bon de commande d'origine (voir `commandes/{id}`) |
| prospectId | string | |
| dateFacturation, dateEcheance | timestamp | |
| montantHTVA, tauxTVA, montantTVA, totalTTC | number | repris de la commande (donc du devis) |
| statutPaiement | `a_payer` \| `payee` \| `en_retard` | |
| exportBob | map | `{exportee: bool, dateExport, formatCsv}` |
| responsablesUids, equipeIds | array | hérités de la commande/du devis/de l'offre d'origine — **génération** réservée à superadmin/admin/direction (bouton "Générer facture" sur une commande réceptionnée) ; **lecture** ouverte au(x) commercial(aux)/manager concerné(s) |

### `pointages/{id}`
Heures travaillées, ouvert à **tous les rôles internes** (pas seulement Travailleur) — Commercial, Manager, Direction, Admin, Super Admin et Travailleur peuvent tous encoder leur temps depuis "Mon pointage".
| Champ | Type | Notes |
|---|---|---|
| uid | string | référence utilisateur (celui qui a pointé) |
| commandeId | string | référence `commandes/{id}` — **une commande = un projet** (demande d'Hélène) — ou `"INTERNE"` pour les tâches non liées à une commande précise |
| date | timestamp | |
| heures | number | |
| description | string | optionnel |
| statut | `en_attente` \| `valide` | Admin/Super Admin voient et valident les feuilles de temps de tout le monde (vue "Toutes les feuilles de temps" dans Mon pointage) |

### `stock_articles/{id}`
| Champ | Type |
|---|---|
| reference, designation, description | string |
| quantiteStock | number |
| seuilAlerte | number |
| prixAchat, prixVente | number |
| fournisseur | string (optionnel) |

### `stock_mouvements/{id}`
| Champ | Type | Notes |
|---|---|---|
| articleId | string | |
| type | `entree` \| `sortie` | |
| quantite | number | |
| date | timestamp | |
| motif | string | achat, utilisation sur vente, utilisation projet, ajustement |
| factureRef | string | si sortie liée à une facture |
| projetId | string | si sortie liée à un projet (prise par un travailleur) |
| uid | string | utilisateur à l'origine du mouvement — un travailleur ne peut créer qu'un mouvement `sortie` en son propre nom |

### `rappels/{id}`
| Champ | Type |
|---|---|
| type | `relance_devis` \| `prospect_inactif` \| `echeance_facture` \| `changement_etape` |
| cibleId | string (offre/devis/facture concerné) |
| destinataireUid | string |
| dateDeclenchement | timestamp |
| canal | `email` \| `notification` \| `les_deux` |
| statut | `a_envoyer` \| `envoye` \| `traite` |

### `parametres_rappels/{etape}`
Délai (en jours) avant relance automatique. Clés = les 5 étapes du pipeline (hors "Client actif"), plus deux clés spéciales : `prospect_inactif` (jours sans offre avant de suggérer une relance) et `devis_validite` (durée de validité par défaut d'un devis, utilisée pour dater son expiration à la création). Modifiable dans Administration > Rappels (Admin/Super Admin) ; **lu par tous les rôles internes** (pas seulement Admin) pour que les notifications de Commercial/Manager fonctionnent aussi.

## Notifications

Pas de collection dédiée : calculées **côté client** (`renderNotifications()` dans `assets/app.js`), à partir des données déjà chargées (donc déjà filtrées par la portée de l'utilisateur). Catégories couvertes :
- Offres en retard à une étape du pipeline (réutilise les délais `parametres_rappels`)
- Devis envoyés dont la `dateValidite` est dépassée
- Activités en retard (échéance passée, non faites)
- Prospects sans offre depuis plus de `prospect_inactif` jours (à relancer)
- Commandes en attente de réception depuis plus de 14 jours (seuil fixe pour l'instant)

Un badge sur l'item de menu "🔔 Notifications" affiche le nombre total ; cliquer une notification ouvre directement la vue concernée.

## Calendrier

Pas de collection dédiée non plus : vue mensuelle calculée côté client (`renderCalendrier()` dans `assets/app.js`) à partir des données déjà chargées. Affiche, par jour : les Activités (`dateEcheance`), les devis envoyés qui expirent (`dateValidite`), et les dates de commande. Navigation mois précédent/suivant ; clic sur un jour pour le détail.

### `contenu_site/{cle}`
Textes éditables des pages publiques (accueil, mentions légales, etc.) — pour que tout le contenu reste modifiable depuis les interfaces Admin/Super Admin.

## Export CSV vers BOB
Un job (Cloud Function ou action manuelle) génère un CSV à partir des factures marquées `exportBob.exportee = false`, au format attendu par BOB. Le format exact des colonnes est à préciser par Hélène (structure BOB Import) avant l'implémentation finale de l'export.

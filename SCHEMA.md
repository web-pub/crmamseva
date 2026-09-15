# CRMAmseva — Modèle de données Firestore

Version : V01-008

## Rôles utilisateurs

| Rôle | Accès |
|---|---|
| `superadmin` | Accès complet + onglet mots de passe en clair |
| `admin` | Accès complet à la gestion (hors mots de passe en clair) |
| `membre` | Lecture sur les données commerciales, selon droits accordés |
| `travailleur` | **Accès restreint** : uniquement son pointage d'heures et la consultation/prise de stock. Aucun accès aux prospects, offres, devis, factures ni aux autres utilisateurs — voir `espace-travailleur.html` (interface séparée du tableau de bord principal) |

## Collections principales

### `utilisateurs/{uid}`
| Champ | Type | Notes |
|---|---|---|
| nom, prenom | string | |
| email | string | |
| role | string | `superadmin` \| `admin` \| `membre` |
| motDePasseClair | string | **Super Admin uniquement** — visible dans un onglet dédié, conformément à la préférence acceptée par Hélène (Firebase Auth reste le système d'authentification réel) |
| identifiant | string | ex. `helene.l` |
| dateCreation | timestamp | |

### `demandes_membres/{id}`
Formulaire "Devenez membre" de la page de connexion.
| Champ | Type |
|---|---|
| nom, prenom, gsm, email | string |
| statut | `en_attente` \| `validee` \| `refusee` |
| dateCreation | timestamp |

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
| responsableUid | string | référence utilisateur |
| secteur / tags | array | |
| historique | array<map> | `{date, auteur, note}` |
| documentationTechnique | array<map> | `{nomFichier, url, description}` — fichiers Firebase Storage + texte libre |
| dateCreation | timestamp | |

### `offres/{id}`
| Champ | Type | Notes |
|---|---|---|
| numero | string | **numéro unique de l'offre**, ex. `OFF-2026-014` |
| prospectId | string | référence |
| titre, description | string | |
| dateReception, dateLimiteReponse | timestamp | |
| etapePipeline | string | une des 6 étapes (voir ci-dessous) |
| historiqueEtapes | array<map> | `{etape, date}` — sert de base au calcul des rappels |
| responsableUid | string | |
| statut | `en_cours` \| `gagnee` \| `perdue` \| `abandonnee` | |
| raisonPerte | string | si perdue |
| documentationTechnique | array<map> | fichiers + texte |

**Étapes du pipeline** : `nouveau` → `qualifie` → `devis_envoye` → `devis_accepte` → `facture` → `client_actif`
Un rappel se déclenche automatiquement si une offre reste trop longtemps sans changement d'étape (délai configurable par étape, voir `parametres_rappels`).

### `offres/{offreId}/devis/{id}` (sous-collection)
Plusieurs devis peuvent répondre à la même offre.
| Champ | Type | Notes |
|---|---|---|
| reference | string | **référence du devis**, ex. `OFF-2026-015-A` (rattachée au numéro unique de l'offre) |
| dateEmission, dateValidite | timestamp | |
| lignes | array<map> | `{designation, quantite, prixUnitaire, tauxTva}` |
| totalHT, totalTVA, totalTTC | number | calculés |
| statut | `brouillon` \| `envoye` \| `accepte` \| `refuse` \| `expire` | |
| conditions | string | délai, garantie... |
| documentationTechnique | array<map> | fichiers + texte |
| pdfUrl | string | généré |

### `factures/{id}`
| Champ | Type | Notes |
|---|---|---|
| numero | string | séquence configurable, unique |
| devisRef | map | `{offreId, devisId}` — devis accepté d'origine |
| prospectId | string | |
| dateFacturation, dateEcheance | timestamp | |
| lignes, totalHT, totalTVA, totalTTC | — | repris du devis, modifiables |
| statutPaiement | `a_payer` \| `payee` \| `en_retard` | |
| exportBob | map | `{exportee: bool, dateExport, formatCsv}` |

### `pointages/{id}`
Heures travaillées, saisies par un travailleur (ou membre) sur un projet.
| Champ | Type | Notes |
|---|---|---|
| uid | string | référence utilisateur (travailleur) |
| projetId | string | référence offre, ou `"INTERNE"` pour les tâches non liées à un client |
| date | timestamp | |
| heures | number | |
| description | string | optionnel |
| statut | `en_attente` \| `valide` | validé par un Admin |

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
Délai (en jours) avant relance automatique, configurable par étape du pipeline — Super Admin uniquement.

### `contenu_site/{cle}`
Textes éditables des pages publiques (accueil, mentions légales, etc.) — pour que tout le contenu reste modifiable depuis les interfaces Admin/Super Admin.

## Export CSV vers BOB
Un job (Cloud Function ou action manuelle) génère un CSV à partir des factures marquées `exportBob.exportee = false`, au format attendu par BOB. Le format exact des colonnes est à préciser par Hélène (structure BOB Import) avant l'implémentation finale de l'export.

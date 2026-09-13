# Organisation cible de la section CIP (phase 5)

> Orchestrateur, 12/09/2026, après les décisions du § 8 du plan (07). Soumis à l'avis du persona CIP.
> Principe : **organiser par ce que la CIP doit faire aujourd'hui**, pas par l'endroit où les données sont rangées.
> Tout ce qui existe et fonctionne (+ Action, clôture contrôlée, verrou + historique, alertes acquittables, note de profil, notes de suivi, PMSMP, compétences ETI) est **conservé**, déplacé au besoin, jamais réécrit.

## 0. Menu (Layout.jsx, section « RH et Insertion » › « Gestion du personnel »)

| Entrée | Route | Rôles | Changement |
|---|---|---|---|
| **Espace CIP** | `/insertion` | ADMIN, RH, MANAGER | ouvre sur « Mes échéances » ; **pastille = nombre d'échéances rouges** |
| Actions CIP | `/insertion/actions` | A/RH/M | inchangé (+ filtre projet) |
| **Conformité FSE+** | `/insertion/conformite` | ADMIN, RH | **nouveau** — vue transversale par projet |
| **Temps d'accompagnement** | `/insertion/temps` | ADMIN, RH (MANAGER : sa propre feuille) | **nouveau** — feuille de temps mensuelle |
| Pilotage & indicateurs | `/insertion/audit` | A/RH/M | enrichi (lot 6) |
| Effectifs ETP · Compétences · Plan de formation · Prescripteurs | inchangés | | `/skills` : menu aligné sur la route (A/RH/M) |
| Réglages insertion | `/admin/insertion` | ADMIN | + projets cofinancés, critères d'éligibilité, seuils CER/FSE+, **sonde IA** (déplacée) |
| Hors menu | `/eti/renouvellement/:token` | **public à jeton** | remplace `/insertion/renouvellement/:id` (redirection conservée pour les liens déjà copiés) |

## 1. Écran « Mes échéances » (`/insertion`, vue par défaut) — RÉORGANISATION + NOUVEAU

Deux colonnes : **file active** à gauche (§ 2), **échéances** à droite.

| Bloc | Contenu | Règle d'affichage | Source |
|---|---|---|---|
| **Aujourd'hui / Cette semaine** | entretiens avec heure, badge « Préparation IA prête », retards regroupés par salarié | inchangé | `AgendaBloc` (existe) |
| **⛔ Risque réglementaire** | • sortie FSE+ à saisir (J+15 orange, J+25 rouge après `contract_end`) • Pass IAE < 2 mois / expiré / suspendu • CDDI ≥ 23 mois sans dérogation • diagnostic socle incomplet > 30 j • questionnaire FSE+ d'entrée manquant (participant ASI) • catégorie FT = G depuis > 30 j • suivi +6 mois échu | **non acquittable 7 j** : report 48 h maximum, motif obligatoire | nouveau `GET /insertion/echeances` |
| **📅 Échéances périodiques** | actualisation mensuelle FT (référent = FT) • point d'étape avec le référent externe (tous les `insertion.point_etape_referent_mois`, défaut 3) • DTR trimestrielle (rappel informatif, non bloquant) • semaine sous 15 h (arbitrage 4) | acquittable 7 j | idem |
| **⏳ Organisation du suivi** | bilans en retard • RDV non planifié • renouvellements < 42 j (bloc existant avec « Copier le lien » → lien public) • actions critiques en retard | acquittable 7 j | existe (`cohorte/stats`, `renouvellements`) |
| **📊 Ma file active** | 4 KPI (En parcours, Retards, À venir 7 j, Sorties dynamiques année) + jauge objectif + **complétude FSE+ du projet ASI** | | existe + `conformite` |
| Barre d'outils | + Action • exports (Excel / CSV / **FSE+ par projet et trimestre**) • Analyser la cohorte (IA) | ADMIN/RH pour les exports | existe |

## 2. File active (colonne gauche, tous les écrans de l'espace CIP) — CORRECTIF
- `GET /insertion` renvoie **uniquement `insertion_status <> 'none'`** (les permanents sortent), enrichi : `insertion_status`, `cip_referent_user_id`, `prochain_rdv`, `risque` (rouge/orange/aucun), `projets[]`, `brsa`, `pass_iae_statut`.
- Recherche par nom (client) ; filtres : En parcours / Terminés · Mes salariés · Projet (ASI / OCS) · BRSA · Sans diagnostic · Sans RDV planifié · Fin de contrat < 60 j · Risque.
- Ligne : NOM Prénom · prochain RDV · pastille de risque · badges (BRSA, ASI).
- Sous `md` : la liste devient un sélecteur repliable en tête, le contenu passe devant.

## 3. Fiche salarié — 4 onglets — RÉORGANISATION

En-tête (conservé, allégé) : nom, poste/équipe, dates, badges **Parcours n°**, **Pass IAE (statut + fin)**, **CDDI n/24**, **BRSA**, **Projet ASI/OCS**, **Référent unique : CMS / FT / structure**, sélecteur CIP référent ; `AlertesBloc` ; boutons **+ Action**, **+ Entretien**, **Fiche PDF ▾** (Fiche parcours · Fiche d'alimentation du référent · Mon parcours en une page · Bilan de prolongation Pass IAE).

### 3.1 Onglet **Situation** (par défaut) — fusion Synthèse + Freins
Note de profil initial (ADMIN/RH) → **Freins : radar + tableau des deltas** (entrée → dernière évaluation, badge « levé / stable / aggravé » par axe) → **Frise unique** (timeline verticale repliée sous « Voir le détail ») → Check-list d'embauche (tant qu'incomplète) → PMSMP (+ débouché) → Satisfaction de sortie (si bilan de sortie) → bouton « Analyser le profil (IA) » (ADMIN/RH).

### 3.2 Onglet **Suivi** — fusion Entretiens + Objectifs & actions + Compétences
Entretiens & bilans (liste + `EntretienForm` ; nouveaux types `point_etape_referent`, `conciliation` ; **durée** proposée par type et ajustée à la clôture ; **présence / absent / excusé + motif légitime + pièce**) → Objectifs → Actions (+ champs **orientation DORA** : service, URL, résultat ; **aide mobilisée** : nature, organisme, montant) → Notes de suivi (ADMIN/RH) → Compétences ETI (encart repliable) → **Approfondissements du diagnostic** (portefeuille/AFOM, style d'apprentissage, budget détaillé, COA — rattachables à un objectif).

### 3.3 Onglet **Cadre administratif** — NOUVEAU (ADMIN/RH en écriture ; MANAGER lecture sans pièces)
| Bloc | Champs | Source |
|---|---|---|
| Éligibilité IAE | critères cochés (référentiel), date de constat, pièce justificative (upload), source (auto-prescription / prescripteur habilité) ; **bloc « copier-coller Emplois de l'inclusion »** | lot 1 |
| Pass IAE | n°, début, fin, **statut** (actif / suspendu / prolongé / expiré / inconnu), historique des événements (suspension, prolongation, motif), bouton « Bilan de prolongation (PDF) » | lot 1 |
| Orientation & référent | **orienteur** (type + nom), **prescripteur habilité** (référentiel existant), **référent unique** (CMS / FT / structure / autre + nom + contact), actualisation mensuelle FT (oui/non) | lot 1 |
| Statuts | BRSA (+ date), catégorie France Travail (A-G + date), `france_travail_id`, RQTH (lecture du diagnostic) | lot 1 |
| Projets cofinancés | rattachements datés (ASI / OCS), entrée / sortie du projet | lot 2 |
| Dérogation CDDI | motif + date (existe côté schéma) | lot 0 |
| **Dossier de conformité** | 9 pièces avec état (éligibilité, Pass, FSE+ entrée, diagnostic socle, FSE+ sortie, statut de sortie dans le mois, +6 mois, remise des documents, référent renseigné), lien direct vers le champ manquant | lot 2 |

### 3.4 Onglet **Diagnostic** — socle J+30 + approfondissements
Socle (7 rubriques, ~30 champs, 45 min) : 1 Cadre administratif & éligibilité (renvoi/résumé de l'onglet 3.3 + ressources + pièce d'identité + CAF) · 2 **Questionnaire FSE+ d'entrée** (typé, complétude) · 3 Logement · 4 Santé (minimum) · 5 Mobilité · 6 Situation & projet professionnels (+ CECRL) · 7 Expression du salarié + 9 freins. Complétude du socle affichée (jamais bloquante). Approfondissements accessibles depuis l'onglet Suivi.

## 4. Écran **Conformité FSE+** (`/insertion/conformite`) — NOUVEAU (ADMIN/RH)
Sélecteur de projet (ASI / OCS) et de période → tableau participants × pièces (✅ / ⚠ / ⛔ / sans objet), taux de complétude, tri par risque, lien vers le champ manquant → boutons **Export FSE+ (CSV, une colonne par item)** et **Bilan d'exécution (PDF agrégé)**. Pour OCS : la même page affiche l'état des **feuilles de temps** (mois validés / manquants).

## 5. Écran **Temps d'accompagnement** (`/insertion/temps`) — NOUVEAU
Mois × intervenant → lignes composées automatiquement (entretiens réalisés avec durée, actions avec `duree_minutes`, temps collectif saisi) → ventilation par salarié et par projet (ASI / OCS / hors projet) → total imputable, **incohérence avec les congés `employee_leaves` signalée** → validation intervenant puis RH (horodatée) → PDF signé + export CSV.

## 6. Écran **ETI à jeton public** (`/eti/renouvellement/:token`) — CORRECTIF
Même formulaire FALC ; jeton hex 32 généré à la création de l'entretien de renouvellement, invalide à la clôture ou au bout de 30 j ; écrit les 3 champs seulement ; aucune donnée sensible affichée (nom, poste, fin de contrat).

## 7. Fiche collaborateur (`/employees`, onglet Parcours insertion) — RÉDUITE
Résumé : statut, parcours n°, référent CIP, référent unique, prochain RDV, dernier entretien, risque → « Ouvrir dans l'espace CIP ». Les champs administratifs se saisissent dans 3.3.

## 8. Réglages (`/admin/insertion`)
Un seul « Enregistrer » ; sections : paramètres (existants + `post_sortie_mois`, `cer_heures_min/max`, `point_etape_referent_mois`, `alerte_sortie_j1/j2`, durées proposées par type) · projets cofinancés · critères d'éligibilité (référentiel) · partenaires · grilles de compétences · **sonde IA**.

## 9. Ce que le persona CIP doit vérifier
1. L'ordre des blocs de « Mes échéances » correspond-il à un lundi matin réel ?
2. Les 4 onglets : rien d'essentiel n'a disparu ? un geste courant devient-il plus long ?
3. Le socle J+30 : 7 rubriques suffisent-elles ? le questionnaire FSE+ en 2ᵉ position est-il tenable en entretien ?
4. La fiche d'alimentation du référent externe : quel contenu exact, quelle fréquence, quel format (PDF / mail) ?
5. Le compteur 15-20 h avec travail inclus : où l'afficher (en-tête ? Cadre administratif ? fiche d'alimentation ?) et quand alerter ?
6. La feuille de temps : la ventilation par salarié est-elle réaliste, ou faut-il une ventilation par activité seulement ?
7. Le report 48 h des risques réglementaires : acceptable ?

## 10. Amendements après l'avis de la CIP (08b) — tous retenus

| Point | Amendement |
|---|---|
| Ordre des blocs | Aujourd'hui / Cette semaine → **À traiter cette semaine — obligations** (ex-« Risque réglementaire ») → **Organisation du suivi** → **Rendez-vous réguliers et rappels** (ex-« Échéances périodiques ») → Ma file active. Un bloc vide reste affiché avec une phrase verte. |
| Lignes rouges | + **« référent unique non renseigné »** (rouge) ; « semaine sous 15 h » **agrégée** (une ligne « N salariés sous 15 h ») ; **catégorie G en orange** (seul le référent peut la changer). |
| Report | Report 48 h ; motif obligatoire **au 2ᵉ report seulement**, liste fermée. |
| Onglet Situation | **Freins (radar + deltas) AVANT la note de profil.** « Analyser le profil (IA) » → **« Proposition de synthèse (IA) »**. |
| Onglet Suivi | Les approfondissements du diagnostic **retournent dans l'onglet Diagnostic** (section repliée sous le socle). |
| Diagnostic socle | Questionnaire FSE+ en **7ᵉ position** (dernière), **pré-rempli par déduction** des rubriques précédentes (logement → sans domicile stable, famille → foyer monoparental, situation pro → statut avant entrée, durée sans emploi) sur le patron des suggestions de freins : la CIP confirme ou corrige en un clic. |
| Libellés | « Cadre administratif » → **« Dossier administratif »** ; « Conformité FSE+ » → **« Dossiers FSE+ »** (titre : « Dossiers FSE+ — pièces à compléter ») ; `point_etape_referent` → **« Point avec le référent »** (modalité tripartite / bilatérale, hors compteur d'entretiens B1) ; `conciliation` → **« Entretien de conciliation (protection des droits) »**, formulaire commençant par les motifs légitimes ; « Fiche d'alimentation du référent » → **« Fiche pour le référent »**. `cer_elaboration` supprimé. |
| Habilitations | **BRSA et catégorie FT : ADMIN/RH strict** (statuts sociaux, jamais en lecture MANAGER, comme les notes de suivi). |
| File active | Défaut = **en parcours + terminés depuis < 7 mois** (sortie à saisir, +6 mois). |
| Jeton ETI | Validité **60 j** (le bloc renouvellements anticipe à 42 j). |
| Assiduité | Motif d'absence **facultatif** ; une absence sans motif ne s'imprime **jamais** « injustifiée » sur un document destiné au référent. |
| Fiche pour le référent | 9 rubriques, liste blanche serveur (judiciaire et détail santé exclus sans mention), produite **à la demande en un clic** + à 3 moments (entrée, renouvellement, sortie) — jamais par échéance automatique. |
| Compteur 15-20 h | En-tête de fiche (discret) + Dossier administratif ; alerte à **2 semaines consécutives** sous 15 h, jamais pendant un arrêt déclaré ; **jamais présenté au salarié comme un seuil**. |
| Feuille de temps | Ventilation salarié ET activité ; durée par **rangée de boutons** (5 s) à la clôture, jamais début + fin ; durées déclaratives annoncées telles quelles sur le PDF signé. |
| Maquettes à produire (§ G) | 1 Mes échéances chargé (1366 px) · 2 jour calme · 3 fiche milieu de parcours · 4 Dossier administratif complet / vide · 5 diagnostic rubrique 7 pré-remplie · 6 Fiche pour le référent + relevé d'assiduité (PDF, dossier avec judiciaire + santé) · 7 clôture de bilan avec durée · 8 feuille de temps avec incohérence congés · 9 ETI sur téléphone · 10 menu PDF par destinataire. |

**Validation CIP : « je valide sous réserve de quatre points » — les quatre sont retenus ci-dessus.**

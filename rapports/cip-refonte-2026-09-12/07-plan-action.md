# Refonte du module CIP — Plan d'action et d'évolution (phase 4)

> Orchestrateur, 12 septembre 2026. Consolide : exigences de l'autorité (00), reconnaissances (01-03),
> rapports des personas bénéficiaire (04), CIP (05) et autorité (06). **Aucun code n'est écrit avant
> les arbitrages du § 6.**

## 1. Diagnostic en dix lignes

1. Le **dossier individuel** (verrou probant, historique, journalisation, chiffrement art. 9/10, minimisation, « objectif non paramétré », « ASP fait foi ») est solide : les trois personas le disent. On ne le reprend pas, on le complète.
2. Le **volet FSE+ est défaillant** : l'export trimestriel sort **toujours vide** (requête sur des colonnes inexistantes avalée par un `catch`), le questionnaire de sortie **n'a aucun écran**, le questionnaire d'entrée est **la 13ᵉ rubrique sur 14** du diagnostic (celle qui saute), les deux sont du **JSON libre** dans l'export, et le suivi post-sortie est à **+3 mois** alors que l'indicateur de résultat se mesure à **+6 mois**. C'est le seul point où le temps joue contre la structure : une donnée d'entrée non recueillie ne se rattrape pas.
3. Le **Pass IAE n'est saisissable nulle part** (ni frontend, ni `PUT /employees/:id`) : les alertes 7 mois / 2 mois et le bilan de prolongation sont inopérants pour tout salarié non issu d'une candidature saisie.
4. **Aucune donnée du cadre 2026** n'existe : BRSA comme attribut, catégorie France Travail F/G, orienteur ≠ prescripteur ≠ référent unique, critères d'éligibilité IAE typés, CER/points d'étape/avenants/conciliation, suspension du Pass IAE, projet cofinancé.
5. Le **temps d'accompagnement** promis aux certificateurs (durée des entretiens, agrégat d'heures) n'existe pas ; la feuille de temps FSE+ par projet (F3) non plus. Une seule brique répond aux deux.
6. `employee_week_hours` (heures réelles hebdo importées de la paie) **n'est lue par rien** : c'est la brique naturelle du suivi 15-20 h.
7. Le **dénominateur des taux de sortie** ne compte que les sorties portant un bilan de sortie réalisé et classé : un départ sans bilan disparaît du calcul (taux flatteur, non rapprochable de l'ASP).
8. Deux exports nominatifs (FSE+, Excel complet) **ne sont pas journalisés** malgré la promesse écrite ; deux guides diffusés portent l'**échelle des freins inversée**.
9. Côté CIP : ~53 accompagnements par ETP, 250-350 clics par parcours, diagnostic d'1 h 30, liste sans recherche, 7 onglets, écran ETI sans lien public, double saisie avec les plateformes d'État.
10. Côté bénéficiaire : rien ne lui est remis qui dise en une page ses engagements, ceux de la structure, ses heures, son prochain rendez-vous et qui est son référent ; aucun rappel ; aucun moyen de tracer un motif légitime d'absence.

## 2. Convergence des trois personas

| Demande | Bénéficiaire | CIP | Autorité | Verdict |
|---|---|---|---|---|
| Éligibilité IAE typée + pièces + BRSA + catégorie FT | attente 5 (basse) | P1 n° 3, n° 20 | P2 (P1a, A1, S4) | **Retenu, lot 1** |
| Pass IAE saisissable + statut suspendu/prolongé | — | P1 n° 1 | P2 (P1b) | **Retenu, lot 1** |
| Orienteur / prescripteur / référent unique distincts | attente 5 | P2 (A2) | P2 | **Retenu, lot 1** |
| Questionnaires FSE+ entrée/sortie typés, écran de sortie, complétude | — | P1 n° 5, n° 10 | **P1** (F5/F6/F7/§3.1) | **Retenu, lot 2** |
| Export FSE+ réparé, colonnes lisibles, échec bruyant, journalisé | — | P1 n° 6 | **P1** | **Retenu, lot 0** |
| Suivi post-sortie +6 mois | attente 8 | P1 n° 4 | **P1** | **Retenu, lot 0** |
| Alerte sortie non renseignée J+15/J+25 | — | P1 n° 2 | **P1** (F7) | **Retenu, lot 2** |
| Objet « projet cofinancé » + cohorte | — | P1 n° 5 | **P1** (S3/F1) | **Retenu, lot 2 — dépend de l'arbitrage 2** |
| Durée d'entretien + heures d'accompagnement + feuille de temps par projet | — | P1 n° 7 | **P1** (F3) | **Retenu, lot 4 — dépend de l'arbitrage 5** |
| Dénominateur des sorties = toutes les sorties + « non documentée » | — | — | **P1** (§3.4) | **Retenu, lot 6** |
| Échelle des freins corrigée dans les guides | — | — | **P1** (§5.2) | **Retenu, lot 0** |
| CER : type d'entretien, points d'étape, avenants, conciliation, export PDF | attentes 1, 6 | P2 n° 12 | P2 (C1/C6/C7) | **Retenu, lot 3 — forme selon l'arbitrage 1** |
| Compteur 15-20 h depuis `employee_week_hours` | attente 2 | P2 n° 17 | P2 (A4) | **Retenu, lot 3 — dépend de l'arbitrage 4** |
| Assiduité : présent/absent/motif légitime, relevé imprimable | attente 3 | P2 n° 18, P3 n° 15 | P2 (C4/P3/A6) | **Retenu, lot 3** |
| Actualisation mensuelle FT tracée | — | P2 n° 16 | P3 (A3) | **Retenu, lot 3 (léger)** |
| Lien public à jeton pour l'écran ETI | — | P1 n° 8 | — | **Retenu, lot 5** |
| File active : recherche, filtres, permanents exclus | — | P2 n° 9 | — | **Retenu, lot 5** |
| Diagnostic : socle J+30 + approfondissements (Kolb sorti) | — | P2 n° 10 | (F6 en 2ᵉ position) | **Retenu, lot 5** |
| Fiche en 4 onglets + onglet « Cadre administratif » | — | P2 n° 11 | — | **Retenu, lot 5** |
| Tableau de bord « Mes échéances » par obligation | — | P2 (§4.1) | — | **Retenu, lot 5** |
| Dossier de conformité par salarié + vue transversale FSE+ | — | P1 n° 5 | P1 (F8) | **Retenu, lot 2** |
| DORA rattaché au frein + stats par partenaire + freins levés | attente 7 | P2 n° 13 | P2/P3 (S2, P2) | **Retenu, lot 6** |
| Document « une page » salarié (engagements, heures, RDV, référent) | **attente 1** | (Mon Récap n° 19) | P4 | **Retenu, lot 7** |
| Rappels SMS/mail au salarié (RDV-Insertion) | attente 4 | P3 n° 15 | — | **Retenu, lot 7 — dépend de l'arbitrage 7** |
| Espace salarié « Mon parcours » | attente 10 | — | — | **Reporté** (arbitrage 8) |
| Journalisation exports + en-tête de traçabilité partout | — | P1 n° 6 | P2/P3 | **Retenu, lot 0/6** |
| Trois bases ETP → 1 820 h seule en conventionnement, ASP en tête de la synthèse | — | — | P2 | **Retenu, lot 6** |
| Nettoyage UX (compteur menu, bouton unique, modales, sonde IA hors CIP) | — | P3 n° 14 | — | **Retenu, lot 5** |
| AIPD + consultation CSE | — | — | P1 (hors logiciel) | **Direction — hors code ; l'outil fournira les pièces** |
| Intégration API Emplois de l'inclusion | — | non (copier-coller) | — | **Non retenu en v1** (arbitrage 6) |

## 3. Lots de réalisation

Convention : chaque lot = fichiers disjoints, tests de contrat, migrations idempotentes dans `init-db.js`, journalisation RGPD des lectures/exports nominatifs, aucune valeur inventée. **Lot 0 est un correctif immédiat, indépendant des arbitrages.**

### Lot 0 — Correctifs immédiats (backend + docs)
| # | Item | Type | Fichiers |
|---|---|---|---|
| 0.1 | Export FSE+ : heures = `SUM(hours_worked)` type normal/training sur `work_hours` **ET** repli `employee_week_hours` ; requête sans `catch` muet ; **0 ligne → 409 `EXPORT_VIDE` motivé** au lieu d'un CSV vide | correctif | `routes/exports.js` |
| 0.2 | Journalisation `rgpd_audit_log` des exports `/fse-plus` et `/insertion` (pattern `logExportFreins`), en-tête « Informations » (date, générateur, périmètre, nb lignes) sur tous les exports | correctif | `routes/exports.js`, `utils/rgpd-libelles.js` |
| 0.3 | Suivi post-sortie : jalon à **+6 mois** (le +3 mois devient facultatif, paramètre `insertion.post_sortie_mois` défaut 6) | correctif | `services/scheduler.js`, `engine.js` |
| 0.4 | Échelle des freins corrigée dans `GUIDE_CIP_INSERTION.md`, `GUIDE_UTILISATEUR.md` §4.4 (réécrit), `CLAUDE.md` §9 | docs | docs |
| 0.5 | `PUT /employees/:id` accepte `pass_iae_*`, `eligibilite_*`, `france_travail_id`, `cddi_derogation_*` (ADMIN/RH) | correctif | `routes/employees.js` |
| 0.6 | Tests : contrat `exports-fse-plus`, `exports-insertion` (journalisation), scheduler post-sortie | tests | `tests/contract`, `tests/unit` |

### Lot 1 — Cadre administratif de la personne (schéma + API)
| # | Item |
|---|---|
| 1.1 | Table **`insertion_eligibilite_criteres`** (référentiel administrable, seed : BRSA, ASS, AAH, DELD, DETLD, jeune −26, senior 50+, RQTH, QPV, ZRR, réfugié/BPI, sortant de détention, parent isolé, sans domicile, autre) + **`employee_eligibilite`** (employee_id, critere, date_constat, justificatif_ref, source : auto-prescription / prescripteur) ; migration du texte libre `eligibilite_criteres` conservé en note |
| 1.2 | Colonnes `employees` : `brsa BOOLEAN`, `brsa_date_constat`, `ft_categorie` (A/B/C/D/E/F/G, date), `orienteur_type` + `orienteur_nom`, `referent_unique_type` (structure / FT / CMS / autre) + `referent_unique_nom/contact`, `actualisation_ft_mensuelle BOOLEAN` |
| 1.3 | Pass IAE : `pass_iae_statut` (actif / suspendu / prolongé / expiré / inconnu), table **`insertion_pass_iae_evenements`** (suspension, prolongation, motif, dates, référence Emplois de l'inclusion) ; alertes existantes lisent le statut |
| 1.4 | **Pièces justificatives** : table `insertion_pieces` (employee_id, type : éligibilité / CER signé / avenant / entretien signé / autre, fichier, date, déposé par) — upload pattern Refashion, servi authentifié, journalisé, purgé à l'anonymisation |
| 1.5 | Endpoints `GET/PUT /insertion/cadre/:employeeId` (ADMIN/RH ; MANAGER lecture sans pièces), `GET /insertion/eligibilite-criteres` |
| 1.6 | Import ASP : conserver `nb_brsa` dans `etp_asp_mensuel` (colonne) et rapprocher avec le compte BRSA de l'outil |
| 1.7 | Bloc « copier-coller structuré » Emplois de l'inclusion (éligibilité + Pass) dans l'ordre du formulaire officiel (texte, aucune API) |

### Lot 2 — Conformité FSE+
| # | Item |
|---|---|
| 2.1 | Table **`insertion_projets`** (nom, financeur, type : ASI / OCS postes / autre, dates, convention, actif) + **`insertion_projet_participants`** (employee_id, projet_id, date_entree, date_sortie) ; CRUD ADMIN/RH ; filtre « projet » partout |
| 2.2 | **Questionnaire FSE+ typé** : `fse_entree` et `fse_sortie` deviennent des objets à schéma (liste blanche de champs, validation serveur, complétude calculée) — items alignés sur la maquette MDFSE+ **dès réception** (arbitrage 3) ; en attendant : items actuels + champs « situation à la sortie » (emploi durable / formation / autre / inactivité) et « à +6 mois » |
| 2.3 | **Écran de sortie FSE+** dans le bilan de sortie (étape dédiée) + saisie possible **sans bilan** (départ sans entretien) via le dossier de conformité |
| 2.4 | **Alerte « sortie non renseignée »** J+15 / J+25 après `contract_end` (job scheduler + bloc Risque réglementaire), non acquittable 7 j (report 48 h) |
| 2.5 | **Dossier de conformité** `GET /insertion/conformite/:employeeId` (9 pièces avec état) + vue transversale `GET /insertion/conformite?projet=` (complétude par participant, lien vers le champ manquant) |
| 2.6 | Export FSE+ : **une colonne par item** en français, filtre par projet, feuille Informations, journalisé ; « bilan d'exécution » = mêmes données agrégées (entrées, sorties, +6 mois, complétude) |

### Lot 3 — Cadre RSA / CER (forme selon arbitrage 1)
| # | Item |
|---|---|
| 3.1 | Types d'entretien **`cer_elaboration`**, **`cer_point_etape`**, **`conciliation`** (CHECK élargi), champs : `cer_version`, `cer_date_signature`, `cer_duree_mois`, `cer_avenant_de`, `cer_engagements_beneficiaire JSONB`, `cer_engagements_structure JSONB` (aides mobilisées : nature, organisme, montant), remise tracée (`remise_salarie` existant) |
| 3.2 | **Gabarit PDF « Contrat d'engagements réciproques »** composé depuis le diagnostic + objectifs + actions + heures (variante « alimentation du référent externe » si la structure n'est pas référente) |
| 3.3 | **Compteur d'activité hebdomadaire** : lecture de `employee_week_hours` + heures d'accompagnement (lot 4) + PMSMP ; seuil paramétrable `insertion.cer_heures_min/max` (15/20) ; indicateur « semaines ≥ seuil » ; règle d'inclusion du temps de travail selon l'arbitrage 4 |
| 3.4 | **Assiduité** : `insertion_milestones.presence` (présent / absent / excusé), `absence_motif` (liste fermée : santé, administratif, garde, transport, autre), `absence_piece_ref` ; relevé d'assiduité imprimable (entretiens + actions + absences paie `employee_leaves`) pour une conciliation |
| 3.5 | Échéances périodiques : actualisation mensuelle FT (si `referent_unique_type = FT`), points d'étape CER (tous les N mois, `insertion.cer_point_etape_mois`), DTR trimestrielle (rappel informatif) — bloc « Échéances périodiques » du tableau de bord |

### Lot 4 — Temps d'accompagnement et feuille de temps (selon arbitrage 5)
| # | Item |
|---|---|
| 4.1 | `insertion_milestones.duree_minutes` (valeur proposée par type : diagnostic 90, bilan 45, période d'essai 30, renouvellement 30, sortie 60, CER 60, conciliation 45 ; ajustable à la clôture) |
| 4.2 | Agrégats : heures d'accompagnement par salarié / par projet / global (`gatherAuditKpis`, synthèse COPIL, indicateur B5) |
| 4.3 | **Feuille de temps mensuelle par intervenant et par projet** : composée des entretiens + actions (`duree_minutes`) + temps hors-salarié saisi (réunions, ateliers collectifs), rapprochée des congés `employee_leaves` (incohérence signalée), **validation** intervenant + RH horodatée (pattern triple validation), PDF + export ; endpoint `GET/POST /insertion/temps/:userId/:annee/:mois` |

### Lot 5 — Réorganisation de la section CIP (frontend)
| # | Item |
|---|---|
| 5.1 | **Tableau de bord « Mes échéances »** : Aujourd'hui/Cette semaine (conservé) · Risque réglementaire (sorties à saisir, Pass IAE, CDDI, diagnostic > 30 j, FSE+ entrée manquant, catégorie G) · Échéances périodiques · Organisation du suivi · File active (KPI + jauge) |
| 5.2 | **File active** : `GET /insertion` restreint aux `insertion_status <> 'none'` (permanents exclus), enrichi (statut, référent, prochain RDV, pastille de risque, projet, BRSA) ; recherche + filtres (en parcours / mes salariés / projet / BRSA / sans diagnostic / sans RDV / fin < 60 j) |
| 5.3 | **Fiche en 4 onglets** : Situation (note de profil, radar + deltas, frise unique, checklist, PMSMP, satisfaction) · Suivi (entretiens, objectifs, actions, notes, compétences) · **Cadre administratif** (éligibilité, Pass IAE, orienteur/prescripteur/référent, catégorie FT, BRSA, projet FSE+, CER, dérogation CDDI, dossier de conformité) · Diagnostic ; boutons IA déplacés ; sonde IA → `/admin/insertion` |
| 5.4 | **Diagnostic en socle J+30 (7 rubriques, FSE+ en 2ᵉ) + approfondissements** (portefeuille/AFOM, Kolb, budget détaillé, COA) accessibles depuis Suivi ; complétude du socle affichée |
| 5.5 | **Écran ETI à jeton public** `/eti/renouvellement/:token` (pattern `/enquete/:token` : hex 32, hors authentification, expire à la clôture, écrit les 3 champs seulement) |
| 5.6 | Fiche collaborateur `Employees.jsx` réduite à un résumé + « Ouvrir dans l'espace CIP » |
| 5.7 | Nettoyage : compteur d'échéances rouges dans la sidebar, un seul « Enregistrer » dans les réglages, `Modal`/`ConfirmDialog` partagés à la place des modales maison et des `alert()`/`window.confirm`, libellés (`avis_global`, `par_type`), tableau des deltas de freins |

### Lot 6 — Reporting autorité
| # | Item |
|---|---|
| 6.1 | **Dénominateur des sorties** = toutes les fins de parcours de la période (bilan de sortie classé + départs sans bilan en ligne « sortie non documentée ») ; méthode imprimée ; rapprochement avec les sorties ASP |
| 6.2 | Synthèse COPIL / audit : ETP ASP en premier, ERP en contrôle ; **une seule base (1 820 h)** dans les documents de conventionnement ; typologie par critère d'éligibilité, BRSA, catégorie FT, référent unique ; freins **entrée → dernière évaluation** (levés / stables / aggravés) par axe ; PMSMP → débouché ; actions par partenaire ; heures d'accompagnement ; complétude FSE+ ; CER (signés, points d'étape, avenants) |
| 6.3 | Tableau des freins : + BRSA, catégorie FT, critères d'éligibilité, frein levé, référent unique |
| 6.4 | Débouché des PMSMP (`insertion_pmsmp.debouche`) et rattachement immersion → sortie ; DORA : `cip_action_plans.dora_url`, `dora_service`, résultat |
| 6.5 | Reporting RH : indicateur legacy `parcours_termines/total` remplacé par la nomenclature |

### Lot 7 — Le salarié
| # | Item |
|---|---|
| 7.1 | **PDF « Mon parcours en une page »** (FALC) : mes engagements / ceux de la structure / mes heures de la semaine / mon prochain RDV / mon référent unique / mes documents remis ; remise tracée |
| 7.2 | **Récapitulatif de parcours partageable** (Mon Récap) : étapes datées, sans art. 9/10, PDF |
| 7.3 | **Rappels de RDV** au salarié (SMS/mail Brevo, J-1) sur consentement tracé (arbitrage 7) |

### Lot 8 — Documentation et présentation
Guide collaborateurs avec visuels ; présentation de SOLIDATA à l'autorité (réponses aux 9 questions du § 7.2 du persona autorité : qu'est-ce que c'est, qui voit quoi, hébergement, traçabilité des exports, tirage d'un dossier < 5 min, correction tracée, IA pseudonymisée, rétention, droit d'accès) ; mise à jour `GUIDE_CIP`, `NOTE_CERTIFICATEURS` (retirer les promesses non tenues ou les tenir), `DOCUMENTATION_APPLICATIVE`, `CLAUDE.md`.

## 4. Phasage proposé
| PR | Lots | Dépend des arbitrages |
|---|---|---|
| **PR A — « Conformité immédiate »** | 0 + 1 + 2 | 2, 3 |
| **PR B — « Cadre RSA et temps d'accompagnement »** | 3 + 4 | 1, 4, 5 |
| **PR C — « Section CIP réorganisée »** | 5 + 7 | 7, 8 |
| **PR D — « Reporting autorité + documentation »** | 6 + 8 | 9 |
Chaque PR : contrats techniques figés (fichier `08-contrats-techniques.md`), lots à fichiers disjoints, agent sécurité/RGPD en lecture seule + agent debug sur PostgreSQL réel, Jest + Vite verts, revue avant merge.

## 5. Ce qui reste HORS logiciel (direction)
AIPD validée par le DPO et consultation du CSE (RES-01/RES-12 — l'outil fournira le registre et les pièces) ; obtention de la maquette MDFSE+, de l'annexe 2 (cibles) et de la trame Convergence auprès de l'autorité ; recrutement de la seconde CIP (S2) ; information des salariés (document remis, trace).

## 6. Arbitrages demandés à la direction (avant PR A)

| # | Question | Options | Recommandation |
|---|---|---|---|
| **1** | Solidarité Textiles est-elle **référent unique** (loi Plein Emploi) de ses salariés BRSA ? | (a) Oui pour tous les BRSA · (b) Oui pour certains (par personne) · (c) Non, structure d'accueil qui alimente le référent CMS/FT | **(b)** : champ par personne ; le module produit le CER complet quand la structure est référente, et une « fiche d'alimentation du référent » sinon |
| **2** | Quels **projets cofinancés FSE+** 2026-2027 et quel critère d'entrée dans la cohorte ? | (a) ASI BRSA · (b) postes CIP en OCS · (c) les deux · (d) inconnu à ce jour | Créer l'objet projet dans tous les cas ; **rattachement daté saisi par la CIP**, jamais déduit automatiquement du statut BRSA |
| **3** | Disposez-vous de la **liste exacte des questions MDFSE+** entrée/sortie ? | (a) Oui, fournie · (b) À demander à l'autorité · (c) Non | (b) — en attendant, schéma typé sur les 5 items actuels + situation de sortie + +6 mois, extensible sans migration |
| **4** | Le **temps de travail CDDI** compte-t-il dans les 15-20 h du CER ? | (a) Oui · (b) Non, hors temps de travail seulement · (c) À demander au Département | **(c)** — le compteur affichera les deux lignes (travail / accompagnement) séparément, et le seuil s'appliquera selon la réponse |
| **5** | **Feuille de temps FSE+** : qui la tient ? | (a) SOLIDATA compose depuis les saisies CIP, RH valide · (b) badgeuse seule · (c) tableur externe | **(a)** : la badgeuse donne le temps total, SOLIDATA la ventilation par salarié/projet, la RH signe |
| **6** | **Emplois de l'inclusion** : intégration API ? | (a) Non, copier-coller structuré · (b) Étudier l'API en v2 | **(a)** en v1 |
| **7** | **Rappels SMS/mail** aux salariés (Brevo existe) ? | (a) Oui, sur consentement tracé · (b) Non | (a) |
| **8** | **Espace salarié « Mon parcours »** (accès personnel) ? | (a) Reporté, PDF une page seulement · (b) Lancer en PR C | **(a)** — le PDF une page couvre l'essentiel ; l'espace demande un dispositif d'authentification dédié |
| **9** | **Dénominateur des taux de sortie** : passer à « toutes les sorties de la période » avec ligne « non documentée » (rupture de série avec les chiffres présentés en juillet) ? | (a) Oui · (b) Garder + afficher les deux | (a), les deux méthodes imprimées pendant l'exercice 2026 |
| **10** | Ordre des PR | A → B → C → D (recommandé) ou C d'abord (ergonomie) | **A d'abord** : le FSE+ est le seul volet où le retard est irrattrapable |

### Défauts appliqués sauf contre-ordre
- Kolb sort du diagnostic (approfondissement facultatif) ; portefeuille/AFOM différé.
- Seuils : `post_sortie_mois` 6 (le +3 conservé en facultatif), `cer_heures_min/max` 15/20, `cer_point_etape_mois` 3, alerte sortie J+15/J+25, durées d'entretien proposées (90/45/30/30/60/60/45 min).
- Pièces justificatives stockées authentifiées (jamais sous `/uploads` statique), purgées à l'anonymisation, consultation journalisée.
- Aucune API externe ; aucun envoi de données à l'autorité depuis l'outil (exports téléchargés seulement).
- Aucune valeur inventée : un champ non renseigné reste « non renseigné » dans tous les exports.

## 7. Risques
- Charge de la CIP : les nouvelles obligations excèdent ce que l'outil peut économiser (Q7 du persona CIP).
- Rupture de série sur les taux de sortie (arbitrage 9) — à annoncer au dialogue de gestion.
- Format MDFSE+ inconnu : tout schéma posé maintenant sera à aligner (d'où un schéma extensible).
- Migration des données existantes : texte libre d'éligibilité → critères (reprise manuelle par la CIP, assistée par une liste des valeurs rencontrées).

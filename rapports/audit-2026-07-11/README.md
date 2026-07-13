# Audit complet SOLIDATA — 11 juillet 2026

Audit multi-agents (43 agents, 4 volets) de l'ensemble de l'application, réalisé sans modification de code.
**Commencer par** : [`00-synthese-executive.md`](00-synthese-executive.md) puis [`01-plan-action.md`](01-plan-action.md).

## Scores

| Volet | Score moyen | Rapports |
|---|:---:|---|
| Fonctionnel | 6,1/10 | 14 modules — [`fonctionnel/`](fonctionnel/) |
| Technique | 6,4/10 | 14 modules — [`technique/`](technique/) |
| Structurel | 5,4/10 | 4 flux + agents IA — [`structurel/`](structurel/) |
| Personas | 5,5/10 | 10 métiers — [`personas/`](personas/) |

## Contenu

### Synthèse (à lire en premier)
- `00-synthese-executive.md` — verdict global, notes, 7 constats transverses, forces, risques
- `01-plan-action.md` — 5 arbitrages métier + 4 vagues d'action priorisées (P0/P1/P2, efforts S/M/L)

### Réalisation (le plan a été exécuté en entier)
- `02-vague0-realisation.md` — 26 correctifs P0 (sécurité, chiffres faux, écrans morts)
- `03-vague1-realisation.md` — 38 chantiers (chaînes matière/finance/personne/terrain/IA)
- `04-vague2-realisation.md` — 36 chantiers (parties prenantes, rôles, QHSE, tri, mobile)
- `05-vague3-realisation.md` — 8 lots de socle (sécurité sessions, RGPD-IA, transactions, observabilité, hygiène, perf, tests de contrat)

### Audits fonctionnels (`fonctionnel/`) et techniques (`technique/`)
Mêmes 14 périmètres dans les deux volets : `auth-securite-admin`, `recrutement-pcm`, `rh-personnel`, `insertion`, `collecte-cav-capteurs`, `tournees-vehicules-mobile`, `tri-production`, `stock-inventaires`, `logistique-exutoires`, `finance-facturation`, `refashion-metropole-reporting`, `boutiques`, `vak-sumup`, `plateforme-transverse`.

### Audits structurels (`structurel/`)
- `flux-matiere-tracabilite.md` — le kilogramme, du CAV à la DPAV (5/10)
- `flux-personne-insertion.md` — la personne, de la candidature à la sortie (4,5/10)
- `flux-financier.md` — l'euro, de la commande au P&L (5,5/10)
- `flux-temps-reel-jobs.md` — GPS, capteurs, webhooks, jobs planifiés (6,5/10)
- `agents-ia-optimisation.md` — moteurs prédictif, routage, insertion, PCM, chatbot (5,5/10)

### Personas (`personas/`)
`chauffeur` (6,5) · `resp-logistique` (6,5) · `manager-tri` (5,5) · `cip` (7) · `manager-financier` (5,5) · `directeur-operations` (6,5) · `charge-rh` (5) · `resp-qhse` (4,5) · `auditeur-refashion` (**2 — promesse rompue**) · `auditeur-metropole` (5,5).

# SOLIDATA — Guide de Présentation Commerciale

> **L'ERP conçu pour l'économie circulaire textile et l'insertion professionnelle**

---

## Slide 1 — Couverture

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║                        S O L I D A T A                           ║
║                                                                  ║
║           L'ERP de la filière textile circulaire                 ║
║                                                                  ║
║     ♻️ Collecte · Tri · Réemploi · Recyclage · Insertion         ║
║                                                                  ║
║  ┌──────────────────────────────────────────────────────────┐    ║
║  │                                                          │    ║
║  │    ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │    ║
║  │    │Dashboard│  │ Kanban  │  │  Carte  │  │ Mobile  │  │    ║
║  │    │         │  │ Recrut. │  │  CAV    │  │  PWA    │  │    ║
║  │    └─────────┘  └─────────┘  └─────────┘  └─────────┘  │    ║
║  │                                                          │    ║
║  └──────────────────────────────────────────────────────────┘    ║
║                                                                  ║
║              Solidarité Textile — Rouen, Normandie               ║
║                        solidata.online                           ║
╚══════════════════════════════════════════════════════════════════╝
```

**Accroche** : *SOLIDATA digitalise l'intégralité de la chaîne de valeur textile — de la collecte en container au recyclage en usine — tout en pilotant l'insertion professionnelle des salariés en parcours.*

---

## Slide 2 — Le Problème

### La filière textile ESS fait face à des défis majeurs :

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ❌ Traçabilité manuelle         → Erreurs, pertes     │
│  ❌ Excel / papier               → Pas de temps réel   │
│  ❌ Reporting subventions        → Chronophage          │
│  ❌ Suivi insertion              → Fragments éparpillés │
│  ❌ Logistique exutoires         → Appels + fax         │
│  ❌ Multi-sites                  → Données en silo      │
│                                                         │
│  💰 Coût estimé de la gestion manuelle :                │
│     4 à 6 ETP administratifs supplémentaires            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Contexte marché** :
- 700 000 tonnes de textiles collectés/an en France (Refashion)
- 2 500 emplois dans les SIAE textiles
- Obligation de traçabilité renforcée (loi AGEC 2020)
- Reporting réglementaire Refashion, ADEME, collectivités

---

## Slide 3 — La Solution SOLIDATA

### Un ERP complet, du container au client final

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   COLLECTE          TRI            STOCK         EXUTOIRES      │
│  ┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐      │
│  │  📱    │     │  ⚖️    │     │  📦    │     │  🚛    │      │
│  │ App    │ ──▶ │ Chaînes│ ──▶ │ Par    │ ──▶ │ Commande│     │
│  │ Mobile │     │ de tri │     │catégor.│     │ Expéd. │      │
│  │ QR+GPS │     │ 7 types│     │        │     │ Facture│      │
│  └────────┘     └────────┘     └────────┘     └────────┘      │
│       │                                            │            │
│       ▼                                            ▼            │
│  ┌────────┐                                   ┌────────┐       │
│  │  🗺️   │        PILOTAGE CENTRAL           │  📊    │       │
│  │ Carte  │     ┌──────────────────┐          │Rapport │       │
│  │ GPS    │     │   Dashboard      │          │Refashion│      │
│  │ Temps  │     │   KPIs           │          │ADEME   │       │
│  │ Réel   │     │   Alertes        │          │Métropole│      │
│  └────────┘     └──────────────────┘          └────────┘       │
│                         │                                       │
│                         ▼                                       │
│                    ┌────────┐                                   │
│                    │  👥    │                                   │
│                    │ RH     │                                   │
│                    │Insertion│                                  │
│                    │ CDDI   │                                   │
│                    └────────┘                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Slide 4 — Modules en Détail

### 4.1 Collecte Terrain (Application Mobile)

```
┌─────────────────────────────────────┐
│         SOLIDATA MOBILE             │
│    ┌───────────────────────────┐    │
│    │                           │    │
│    │   Tournée du jour         │    │
│    │   8 containers            │    │
│    │   ━━━━━━━━━━━━━━ 62%     │    │
│    │                           │    │
│    │   ┌─────┐ ┌─────┐        │    │
│    │   │ 📷  │ │ 📊  │        │    │
│    │   │Scan │ │Rempl.│        │    │
│    │   │ QR  │ │      │        │    │
│    │   └─────┘ └─────┘        │    │
│    │                           │    │
│    │   Container actuel :      │    │
│    │   CAV-0042 Rue de Paris   │    │
│    │   Remplissage : 75% 🟧   │    │
│    │                           │    │
│    │   [Valider et suivant →]  │    │
│    │                           │    │
│    └───────────────────────────┘    │
│                                     │
└─────────────────────────────────────┘
```

**Fonctionnalités clés** :
- Scan QR code en < 3 secondes
- GPS temps réel (position chauffeur toutes les 10 s)
- Checklist sécurité pré-départ obligatoire
- Mode hors-ligne (synchronisation automatique)
- Calcul CO₂ économisé par tournée
- Boutons larges (48 px) adaptés aux gants de travail

### 4.2 Tableau de Bord

```
┌─────────────────────────────────────────────────────────────┐
│  SOLIDATA — Tableau de bord                    Julien G. ▾  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  12,4 t  │ │    3     │ │   4,2 t  │ │  18,5 t  │      │
│  │ Collecté │ │ Tournées │ │  Trié    │ │  Stock   │      │
│  │ ce mois  │ │en cours  │ │ ce jour  │ │  total   │      │
│  │  ↑ 8%    │ │          │ │  ↑ 12%   │ │  ↓ 3%    │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
│  ┌─────────────────────────┐ ┌────────────────────────┐    │
│  │  Collecte mensuelle     │ │  Alertes               │    │
│  │  ▐                      │ │                        │    │
│  │  ▐   ▐                  │ │  ⚠ Stock CSR bas      │    │
│  │  ▐   ▐ ▐               │ │  ⚠ Maintenance V-003  │    │
│  │  ▐ ▐ ▐ ▐ ▐             │ │  ✓ Backup OK 02:00    │    │
│  │  J F M A M J            │ │                        │    │
│  └─────────────────────────┘ └────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Recrutement (Kanban + PCM)

```
┌─────────────────────────────────────────────────────────────┐
│  Candidats                    [Kanban] [Plan de recrutement]│
├──────────────┬───────────────┬──────────────┬───────────────┤
│   REÇUS (4)  │ENTRETIEN (2)  │RECRUTÉS (3)  │ REFUSÉS (1)  │
│              │               │              │               │
│ ┌──────────┐ │ ┌──────────┐  │ ┌──────────┐ │ ┌──────────┐ │
│ │Marie D.  │ │ │Thomas L. │  │ │Ahmed B.  │ │ │Pierre C. │ │
│ │Trieur    │ │ │Chauffeur │  │ │Manutent. │ │ │Trieur    │ │
│ │CV: ✓     │ │ │PCM: ✓    │  │ │CDDI      │ │ │          │ │
│ │Skills: 4 │ │ │Entretien │  │ │Démarrage │ │ │          │ │
│ └──────────┘ │ │15/03     │  │ │01/04     │ │ └──────────┘ │
│ ┌──────────┐ │ └──────────┘  │ └──────────┘ │               │
│ │Sophie R. │ │               │              │               │
│ │Logist.   │ │               │              │               │
│ │CV: en    │ │               │              │               │
│ │cours...  │ │               │              │               │
│ └──────────┘ │               │              │               │
└──────────────┴───────────────┴──────────────┴───────────────┘
```

**Points forts** :
- Parsing automatique des CV (extraction compétences)
- Test de personnalité PCM intégré (6 profils)
- Plan de recrutement mensuel par poste
- Entretien structuré + mises en situation documentées
- Onboarding digital (livret d'accueil)

### 4.4 Logistique Exutoires

```
┌─────────────────────────────────────────────────────────────┐
│  Commandes Exutoires                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CMD-2026-0042  │  TEXRECYCLE SAS  │  12 tonnes original   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━       │
│  en_attente → confirmée → [en_préparation] → ...           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  PRÉPARATION                                         │   │
│  │  Lieu : Quai de chargement A                         │   │
│  │  Équipe : Ahmed B., Marie D., Thomas L.              │   │
│  │                                                      │   │
│  │  Timeline :                                          │   │
│  │  09:00 ═══ Remorque reçue                            │   │
│  │  09:30 ═══ Début chargement                          │   │
│  │  11:15 ═══ Fin chargement                            │   │
│  │  11:30 ═══ Pesée interne : 12 340 kg                 │   │
│  │  12:00 ═══ Départ                                    │   │
│  │                                                      │   │
│  │  Pesée client : 12 180 kg  │  Écart : 1,3%  ✅      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.5 Carte des Containers (CAV)

```
┌─────────────────────────────────────────────────────────────┐
│  Carte CAV — Métropole Rouen Normandie                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│    ┌──────────────────────────────────────────────────┐     │
│    │                                                  │     │
│    │              Rouen Centre                        │     │
│    │                                                  │     │
│    │         🟢        🔴                             │     │
│    │    🟢       🟡          🟢                       │     │
│    │                                                  │     │
│    │      🟡         🟢                               │     │
│    │           🟢              🟧                     │     │
│    │                                                  │     │
│    │    🟢  CAV-0042 ─────────────────────┐           │     │
│    │        │ Rue de Paris               │           │     │
│    │        │ Remplissage : 45%  🟢      │           │     │
│    │        │ Dernière collecte : 12/03  │           │     │
│    │        │ Prochaine : 16/03         │           │     │
│    │        └────────────────────────────┘           │     │
│    │                                                  │     │
│    └──────────────────────────────────────────────────┘     │
│                                                             │
│  🟢 < 50%   🟡 50-70%   🟧 70-85%   🔴 > 85%              │
│  Total : 48 containers  │  12 à collecter cette semaine    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Slide 5 — Chiffres Clés et Impact

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              IMPACT MESURÉ PAR SOLIDATA                     │
│                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│   │             │  │             │  │             │       │
│   │   ×3        │  │   -70%      │  │   100%      │       │
│   │             │  │             │  │             │       │
│   │  Rapidité   │  │  Temps      │  │ Traçabilité │       │
│   │  reporting  │  │  admin      │  │  collecte   │       │
│   │  Refashion  │  │  gestion    │  │  → recyclage│       │
│   │             │  │  tournées   │  │             │       │
│   └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│   │             │  │             │  │             │       │
│   │   1,493     │  │   Temps     │  │   5         │       │
│   │   kg CO₂    │  │   réel      │  │   rôles     │       │
│   │             │  │             │  │             │       │
│   │  économisé  │  │  GPS +      │  │  RBAC       │       │
│   │  par kg     │  │  Socket.IO  │  │  sécurisé   │       │
│   │  textile    │  │  10s refresh│  │  RGPD ready │       │
│   │             │  │             │  │             │       │
│   └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Slide 6 — Architecture Technique

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ARCHITECTURE SOLIDATA — Production                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    INTERNET                          │   │
│  │                       │                              │   │
│  │                  ┌────▼────┐                         │   │
│  │                  │  NGINX  │  TLS 1.3 + HSTS         │   │
│  │                  │  :443   │  Rate Limiting           │   │
│  │                  └────┬────┘  HTTP/2                  │   │
│  │           ┌───────────┼───────────┐                  │   │
│  │           │           │           │                  │   │
│  │     ┌─────▼────┐ ┌───▼──────┐ ┌──▼───────┐         │   │
│  │     │ Frontend │ │  Mobile  │ │ Backend  │         │   │
│  │     │  React   │ │   PWA    │ │ Express  │         │   │
│  │     │  :3000   │ │  :3002   │ │  :3001   │         │   │
│  │     └──────────┘ └──────────┘ └──┬───────┘         │   │
│  │                                   │                  │   │
│  │                        ┌──────────┼──────────┐      │   │
│  │                        │          │          │      │   │
│  │                   ┌────▼───┐ ┌────▼───┐ ┌───▼───┐  │   │
│  │                   │Postgre │ │ Redis  │ │ Brevo │  │   │
│  │                   │SQL+GIS │ │ Cache  │ │SMS/Mail│  │   │
│  │                   │ :5432  │ │ :6379  │ │  API  │  │   │
│  │                   └────────┘ └────────┘ └───────┘  │   │
│  │                                                     │   │
│  │  Scaleway DEV1-S · Docker Compose · Let's Encrypt   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Stack : React 18 · Node.js 20 · PostgreSQL 15 + PostGIS   │
│          Redis · Socket.IO · Leaflet · Recharts · JWT       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Avantages techniques** :
- **100 % web** : aucune installation, navigateur suffit
- **PWA mobile** : installable comme une app native (Android/iOS)
- **Temps réel** : WebSocket pour GPS et alertes instantanées
- **Sécurisé** : JWT + bcrypt + RBAC + HTTPS + CORS + Rate Limiting
- **RGPD natif** : export, anonymisation, audit trail intégrés
- **Dockerisé** : déploiement en 1 commande, scalable

---

## Slide 7 — Sécurité & Conformité

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              SÉCURITÉ & CONFORMITÉ                          │
│                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │   AUTHENTIFICATION   │  │     AUTORISATION      │        │
│  │                      │  │                       │        │
│  │  ✓ JWT (8h expiry)   │  │  ✓ 5 rôles RBAC      │        │
│  │  ✓ Refresh Token 7j  │  │  ✓ ADMIN              │        │
│  │  ✓ bcrypt 10 rounds  │  │  ✓ MANAGER             │        │
│  │  ✓ Rate limit login  │  │  ✓ RH                  │        │
│  │                      │  │  ✓ COLLABORATEUR       │        │
│  └──────────────────────┘  │  ✓ AUTORITE            │        │
│                            └──────────────────────┘        │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │      TRANSPORT       │  │        RGPD           │        │
│  │                      │  │                       │        │
│  │  ✓ TLS 1.2/1.3      │  │  ✓ Art.15 : Export    │        │
│  │  ✓ HSTS 2 ans       │  │  ✓ Art.17 : Oubli     │        │
│  │  ✓ HTTP/2            │  │  ✓ Art.30 : Registre  │        │
│  │  ✓ CSP Headers      │  │  ✓ Consentement       │        │
│  │  ✓ Cert. Let's      │  │  ✓ Purge auto 24 mois │        │
│  │    Encrypt auto      │  │  ✓ Audit trail        │        │
│  └──────────────────────┘  └──────────────────────┘        │
│                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │     PROTECTION       │  │     INFRASTRUCTURE    │        │
│  │                      │  │                       │        │
│  │  ✓ Anti-injection    │  │  ✓ Docker isolation   │        │
│  │    SQL (100%)        │  │  ✓ Backup quotidien   │        │
│  │  ✓ Firewall UFW      │  │  ✓ Health check /5min │        │
│  │  ✓ Fail2ban          │  │  ✓ Auto-restart       │        │
│  │  ✓ CORS whitelist    │  │  ✓ SSL auto-renew     │        │
│  └──────────────────────┘  └──────────────────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Slide 8 — Parcours d'Insertion Digitalisé

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│    PARCOURS D'INSERTION CDDI — Piloté par SOLIDATA          │
│                                                             │
│    Candidature ─── Entretien ─── Recrutement ─── Intégration│
│        │              │              │              │       │
│        ▼              ▼              ▼              ▼       │
│    ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐    │
│    │ CV auto│    │ PCM    │    │ Livret │    │Parcours│    │
│    │ parsé  │    │ Profil │    │accueil │    │objectifs│   │
│    │        │    │ 6 types│    │ digital│    │évaluat.│    │
│    │Compét. │    │        │    │        │    │progress│    │
│    │détect. │    │Alertes │    │Docs    │    │        │    │
│    └────────┘    │risque  │    │signés  │    │Export  │    │
│                  └────────┘    └────────┘    │DIRECCTE│    │
│                                             └────────┘    │
│                                                             │
│    Évaluation mensuelle ──────────────────────────┐        │
│                                                    │        │
│    ┌────────────────────────────────────────┐      │        │
│    │  Savoir-être    ████████░░  80%        │      │        │
│    │  Technique      ██████░░░░  60%        │      │        │
│    │  Autonomie      █████████░  90%        │      │        │
│    │  Ponctualité    ███████░░░  70%        │      │        │
│    │  Travail équipe ████████░░  80%        │      │        │
│    └────────────────────────────────────────┘      │        │
│                                                    │        │
│    Bilan de sortie exportable pour financeurs ◄────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Valeur ajoutée** :
- Suivi individuel structuré (objectifs + évaluations datées)
- Graphiques de progression pour motiver le salarié
- Export automatique pour les financeurs (DIRECCTE, Conseil Départemental)
- Test PCM pour adapter l'accompagnement au profil de personnalité
- Confidentialité garantie (RBAC + RGPD)

---

## Slide 9 — Logistique Exutoires

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│         CHAÎNE LOGISTIQUE EXUTOIRES                         │
│                                                             │
│  1. COMMANDE        2. PRÉPARATION      3. CONTRÔLE        │
│  ┌──────────┐      ┌──────────┐       ┌──────────┐        │
│  │ Client   │      │ Équipe   │       │ Pesée    │        │
│  │ Produit  │ ───▶ │ Lieu     │ ───▶  │ interne  │        │
│  │ Quantité │      │ Timeline │       │ vs client│        │
│  │ Tarif    │      │ Pesée    │       │          │        │
│  │ Récurren.│      │ interne  │       │ ✅ < 2%  │        │
│  └──────────┘      └──────────┘       │ ⚠️ 2-5% │        │
│                                       │ ❌ > 5%  │        │
│                                       └──────────┘        │
│                          │                                  │
│                          ▼                                  │
│  4. FACTURATION    5. CALENDRIER       6. REPORTING         │
│  ┌──────────┐      ┌──────────┐       ┌──────────┐        │
│  │ Upload   │      │ Prévision│       │ CA/mois  │        │
│  │ facture  │      │ Alertes  │       │ CO₂/type │        │
│  │ OCR auto │      │ Capacité │       │ Tonnage  │        │
│  │ Rappro-  │      │ Stock vs │       │ Refashion│        │
│  │ chement  │      │ commandes│       │ ADEME    │        │
│  └──────────┘      └──────────┘       └──────────┘        │
│                                                             │
│  7 types de produits textiles :                             │
│  Original · CSR · Effiloché blanc/couleur · Jean ·          │
│  Coton blanc/couleur                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Slide 10 — Reporting Multi-Niveaux

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              5 TABLEAUX DE BORD ANALYTIQUES                 │
│                                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────┐│
│  │COLLECTE │ │   RH    │ │PRODUCT. │ │REFASHION│ │MÉTRO-││
│  │         │ │         │ │         │ │         │ │POLE  ││
│  │Tonnages │ │Effectif │ │Rendement│ │Déclar.  │ │Conven-││
│  │Tournées │ │Turnover │ │Catégor. │ │régle-   │ │tion  ││
│  │Rendem.  │ │% Insert.│ │Product. │ │mentaire │ │terri-││
│  │Évolution│ │Heures   │ │Chaînes  │ │éco-org. │ │toriale││
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └──────┘│
│                                                             │
│  Fonctionnalités communes :                                 │
│  ✓ Filtres par période (jour / semaine / mois / année)      │
│  ✓ Graphiques interactifs (Recharts)                        │
│  ✓ Export Excel en 1 clic (ExcelJS)                         │
│  ✓ Données en temps réel                                    │
│                                                             │
│  ┌──────────────────────────────────────────────────┐      │
│  │  Tonnage collecté — 12 derniers mois             │      │
│  │                                                  │      │
│  │  14t ─                              ▐            │      │
│  │  12t ─               ▐    ▐    ▐    ▐    ▐       │      │
│  │  10t ─          ▐    ▐    ▐    ▐    ▐    ▐       │      │
│  │   8t ─     ▐    ▐    ▐    ▐    ▐    ▐    ▐       │      │
│  │   6t ─     ▐    ▐    ▐    ▐    ▐    ▐    ▐  ▐    │      │
│  │   4t ─ ▐   ▐    ▐    ▐    ▐    ▐    ▐    ▐  ▐    │      │
│  │        A   M    J    J    A    S    O    N  D    │      │
│  └──────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Slide 11 — Avantages Concurrentiels

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│            POURQUOI SOLIDATA ?                              │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  1. CONÇU POUR L'ESS TEXTILE                        │   │
│  │     Pas un ERP générique adapté — un outil natif    │   │
│  │     pour la collecte, le tri et le recyclage textile │   │
│  │                                                     │   │
│  │  2. INSERTION INTÉGRÉE                              │   │
│  │     Seul ERP combinant gestion opérationnelle       │   │
│  │     ET suivi des parcours d'insertion CDDI           │   │
│  │                                                     │   │
│  │  3. TRAÇABILITÉ TOTALE                              │   │
│  │     Du container au client recycleur :              │   │
│  │     QR code → GPS → Tri → Stock → Exutoire → Facture│   │
│  │                                                     │   │
│  │  4. MOBILE-FIRST                                    │   │
│  │     PWA terrain pour les chauffeurs, fonctionne     │   │
│  │     avec des gants, hors-ligne, scan QR < 3 s       │   │
│  │                                                     │   │
│  │  5. REPORTING RÉGLEMENTAIRE                         │   │
│  │     Refashion, ADEME, Métropole, DIRECCTE :         │   │
│  │     1 clic pour exporter les données conformes       │   │
│  │                                                     │   │
│  │  6. COÛT MAÎTRISÉ                                   │   │
│  │     Hébergé sur serveur dédié (< 20 €/mois)         │   │
│  │     Open source, pas de licence par utilisateur      │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Slide 12 — Comparatif

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  Fonctionnalité         │ SOLIDATA │ ERP Générique │ Excel  │
│  ────────────────────────┼──────────┼───────────────┼────────│
│  Gestion collecte        │    ✅    │      ❌       │   ⚠️   │
│  Scan QR terrain         │    ✅    │      ❌       │   ❌   │
│  GPS temps réel          │    ✅    │      ❌       │   ❌   │
│  Tri 7 catégories        │    ✅    │      ⚠️       │   ⚠️   │
│  Suivi insertion CDDI    │    ✅    │      ❌       │   ⚠️   │
│  Test PCM personnalité   │    ✅    │      ❌       │   ❌   │
│  Logistique exutoires    │    ✅    │      ⚠️       │   ⚠️   │
│  OCR factures            │    ✅    │      ⚠️       │   ❌   │
│  Contrôle pesée auto     │    ✅    │      ❌       │   ⚠️   │
│  Reporting Refashion     │    ✅    │      ❌       │   ⚠️   │
│  RGPD natif              │    ✅    │      ⚠️       │   ❌   │
│  App mobile (PWA)        │    ✅    │      ⚠️       │   ❌   │
│  Carte CAV interactive   │    ✅    │      ❌       │   ❌   │
│  CO₂ impact tracking     │    ✅    │      ❌       │   ❌   │
│  Coût mensuel            │  < 20 € │   200-500 €   │  Gratuit│
│                                                              │
│  ✅ = Natif   ⚠️ = Partiel/Manuel   ❌ = Non disponible      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Slide 13 — Écosystème et Partenaires

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              ÉCOSYSTÈME SOLIDATA                            │
│                                                             │
│                    ┌──────────┐                             │
│                    │ SOLIDATA │                             │
│                    │   ERP    │                             │
│                    └─────┬────┘                             │
│              ┌───────────┼───────────┐                     │
│              │           │           │                     │
│         ┌────▼────┐ ┌────▼────┐ ┌────▼────┐               │
│         │Refashion│ │Métropole│ │DIRECCTE │               │
│         │Éco-org. │ │ Rouen   │ │Insertion│               │
│         │textile  │ │Normandie│ │profess. │               │
│         └─────────┘ └─────────┘ └─────────┘               │
│                                                             │
│     ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│     │Recycleurs│  │Boutiques│  │Transport│  │Donateurs│   │
│     │Industriels│ │Frip & Co│  │eurs     │  │Citoyens │   │
│     └─────────┘  └─────────┘  └─────────┘  └─────────┘   │
│                                                             │
│  SOLIDATA connecte tous les acteurs de la filière           │
│  textile circulaire en un seul outil.                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Slide 14 — Feuille de Route

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              ROADMAP SOLIDATA 2026-2027                     │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                                                      │  │
│  │  T1 2026 ✅  Modules Collecte + Tri + Stocks         │  │
│  │              Application Mobile PWA                   │  │
│  │              Dashboard + Reporting de base           │  │
│  │                                                      │  │
│  │  T2 2026 ✅  Module Exutoires complet                │  │
│  │              Recrutement (Kanban + PCM + Plan)        │  │
│  │              Parcours Insertion CDDI                  │  │
│  │              RGPD + Audit Trail                       │  │
│  │                                                      │  │
│  │  T3 2026 🔄  Mode offline renforcé (IndexedDB)       │  │
│  │              Accessibilité WCAG 2.2 AA complet       │  │
│  │              Monitoring Prometheus + Grafana          │  │
│  │              Chiffrement données sensibles            │  │
│  │                                                      │  │
│  │  T4 2026 📋  Intégration transporteurs (API)         │  │
│  │              Facturation automatisée                  │  │
│  │              Multi-sites (plusieurs structures)       │  │
│  │              Dashboard prédictif IA avancé             │  │
│  │                                                      │  │
│  │  2027   🔮  Module boutiques Frip & Co (POS)         │  │
│  │              IoT capteurs containers                  │  │
│  │              API partenaires (Refashion directe)      │  │
│  │              Version multi-tenant (SaaS)              │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Slide 15 — Appel à l'Action

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║                        S O L I D A T A                           ║
║                                                                  ║
║         L'outil qui donne du sens aux données textiles           ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────┐      ║
║  │                                                        │      ║
║  │   Demandez une démonstration en ligne                  │      ║
║  │                                                        │      ║
║  │   🌐  solidata.online                                  │      ║
║  │   📱  m.solidata.online (essayez la PWA mobile)        │      ║
║  │                                                        │      ║
║  │   Solidarité Textile                                   │      ║
║  │   Rouen, Normandie                                     │      ║
║  │                                                        │      ║
║  └────────────────────────────────────────────────────────┘      ║
║                                                                  ║
║   ♻️ Collecte · Tri · Réemploi · Recyclage · Insertion           ║
║   📊 Traçabilité · Reporting · RGPD · CO₂                       ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## Annexe — Données Chiffrées pour Argumentaire

| Indicateur | Valeur | Source |
|-----------|--------|--------|
| Textiles collectés France/an | 700 000 tonnes | Refashion 2024 |
| Taux de valorisation textile | 90 % | Refashion |
| Emplois SIAE textile | 2 500 | UDES |
| CO₂ évité par kg collecté | 1,493 kg | ADEME/Refashion ACV |
| Obligation traçabilité | Loi AGEC 2020 | Code environnement |
| Containers gérés (SOLIDATA) | 48+ | Métropole Rouen |
| Catégories de tri | 7 types | Solidarité Textile |
| Temps scan QR | < 3 s | Mesure interne |
| Coût hébergement mensuel | < 20 € | Scaleway |
| Temps déploiement | < 30 min | Script automatisé |

---

*Guide de présentation commerciale SOLIDATA ERP — Solidarité Textile, Rouen — Mars 2026*
*Visuels ASCII pour projection et impression. Adaptable en slides PowerPoint/Google Slides.*

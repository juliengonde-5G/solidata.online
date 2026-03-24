# Conformité réglementaire — Système de pointage par badge

## Cadre applicable

- **Convention collective** : Ateliers et Chantiers d'Insertion (ACI)
- **RGPD** : Règlement (UE) 2016/679
- **Code du travail** : Articles L.3171-1 à L.3171-4 (décompte du temps de travail)
- **CNIL** : Délibération n°2019-001 (biométrie) — *non applicable ici (badge non biométrique)*
- **Effectif concerné** : ~40 collaborateurs (managers + bénéficiaires en insertion)
- **DPO** : Julien Gondé (DPO interne)

---

## 1. Obligations légales — Code du travail

### Article L.3171-1 : Obligation de décompte du temps de travail
> L'employeur doit établir un document de décompte de la durée du travail pour chaque salarié.

**Conformité** : Le système de pointage automatise ce décompte via le registre des mouvements (`pointage_events`) et le tableau des heures (`work_hours`).

### Article L.3171-2 : Moyens de décompte
> Lorsque les salariés d'un atelier, d'un service ou d'une équipe ne travaillent pas selon le même horaire collectif, la durée du travail est décomptée quotidiennement.

**Conformité** : Le badge enregistre les 4 passages quotidiens (entrée/sortie matin + après-midi).

### Article L.3171-4 : Preuve des heures
> En cas de litige, l'employeur fournit les éléments de nature à justifier les horaires effectivement réalisés.

**Conformité** : Le registre des mouvements constitue une preuve horodatée et infalsifiable. Les saisies manuelles sont tracées avec l'identité du manager.

---

## 2. RGPD — Protection des données personnelles

### 2.1 Base légale du traitement
**Intérêt légitime de l'employeur** (Article 6.1.f du RGPD) :
- L'employeur a l'obligation légale de décompter le temps de travail
- Le badge NFC (non biométrique) est proportionné à cet objectif

### 2.2 Données collectées

| Donnée | Finalité | Durée de conservation |
|---|---|---|
| UID du badge (identifiant technique) | Identification au passage | Durée d'emploi + 5 ans |
| Date et heure de passage | Décompte du temps | 5 ans (prescription sociale) |
| Nom et prénom du salarié | Identification | Durée d'emploi + 5 ans |
| Heures calculées | Paie et gestion | 5 ans |
| Registre des mouvements | Traçabilité | 5 ans |

### 2.3 Inscription au registre des traitements

Le traitement doit être inscrit au registre des traitements de l'association avec les mentions suivantes :

```
Traitement : Gestion du temps de travail par badge NFC
Responsable : Solidarité Textiles (Julien Gondé, DPO)
Finalité : Décompte quotidien du temps de travail (obligation légale L.3171-1)
Base légale : Intérêt légitime / obligation légale employeur
Catégories de personnes : Salariés en CDI/CDD/insertion du centre de tri et logistique
Catégories de données : Identifiant badge, date/heure passage, nom, heures travaillées
Destinataires : Service RH, managers, prestataire paie
Transferts hors UE : Non
Durée de conservation : 5 ans après fin du contrat
Mesures de sécurité : Authentification, chiffrement TLS, logs d'accès
```

### 2.4 Droits des personnes

Les salariés disposent des droits suivants :
- **Accès** : Consultation de leurs propres données de pointage (lecture seule dans Solidata)
- **Rectification** : Demande de correction d'une erreur de pointage
- **Effacement** : Non applicable (obligation légale de conservation)
- **Opposition** : Non applicable (obligation légale)
- **Portabilité** : Export de leurs données sur demande

### 2.5 Analyse d'impact (AIPD)
Une AIPD n'est **pas obligatoire** pour un système de badge NFC classique (pas de biométrie, pas de surveillance systématique). Cependant, il est recommandé d'en réaliser une simplifiée.

---

## 3. Information des salariés

### 3.1 Obligation d'information préalable
Avant la mise en place du système, chaque salarié doit être informé individuellement par une note écrite contenant :

---

### MODÈLE DE NOTE D'INFORMATION AUX SALARIÉS

**Objet : Mise en place d'un système de pointage par badge NFC**

Cher(e) collègue,

Dans le cadre de nos obligations légales de décompte du temps de travail (Article L.3171-1 du Code du travail), nous mettons en place un système de pointage par badge NFC à compter du [DATE].

**Fonctionnement :**
- Un badge personnel vous sera remis. Il est strictement personnel et non transférable.
- Vous devez présenter votre badge devant le lecteur situé à l'entrée du centre de tri :
  - À votre arrivée le matin
  - À votre départ en pause méridienne
  - À votre retour de pause méridienne
  - À votre départ en fin de journée
- Le système enregistre uniquement la date et l'heure de chaque passage.

**Données collectées :**
- Identifiant technique du badge (numéro unique)
- Date et heure de chaque passage
- Calcul automatique des heures travaillées

**Vos droits :**
- Vous pouvez consulter vos données de pointage dans l'application Solidata (accès en lecture)
- Vous pouvez demander la rectification d'une erreur auprès de votre manager
- Pour toute question relative à vos données personnelles, contactez le DPO : [EMAIL DPO]

**Responsable du traitement :** Solidarité Textiles
**DPO :** Julien Gondé — [EMAIL]
**Durée de conservation :** 5 ans après la fin de votre contrat
**Base légale :** Obligation légale de l'employeur (décompte du temps de travail)

Fait à [VILLE], le [DATE]

La Direction

---

### 3.2 Affichage obligatoire
Un exemplaire de cette note doit être affiché dans les locaux (salle de pause ou à proximité du lecteur).

---

## 4. Consultation du CSE

### Situation actuelle
Les élections du CSE sont en cours. **Le système peut être préparé techniquement**, mais la mise en service effective doit respecter les étapes suivantes :

### Procédure à suivre
1. **Dès l'élection du CSE** : Information-consultation sur le projet de pointage
2. **Présentation au CSE** :
   - Objectif du système
   - Données collectées
   - Modalités de fonctionnement
   - Note d'information aux salariés
3. **Avis du CSE** : Le CSE rend un avis (consultatif, non bloquant)
4. **Information individuelle** : Distribution de la note à chaque salarié
5. **Mise en service** : Après un délai raisonnable (recommandé : 15 jours)

### Articles applicables
- **L.2312-38** : Le CSE est informé et consulté sur les moyens ou techniques permettant un contrôle de l'activité des salariés
- **L.1222-4** : Aucune information concernant personnellement un salarié ne peut être collectée par un dispositif qui n'a pas été porté préalablement à sa connaissance

---

## 5. Convention collective ACI — Temps de travail

### Durée du travail
- **Durée légale** : 35h/semaine (ou 26h pour les contrats d'insertion à temps partiel)
- **Heures supplémentaires** : Au-delà de 35h (ou 26h), majoration selon la CC
- **Repos quotidien** : 11 heures consécutives minimum
- **Pause méridienne** : 1 heure (non comptée dans le temps de travail)

### Spécificités ACI
- Les bénéficiaires en parcours d'insertion peuvent avoir des horaires aménagés
- Le suivi du temps de travail est un outil d'accompagnement (pas uniquement de contrôle)
- Le temps de formation est compté comme temps de travail effectif

### Travail le samedi
- Autorisé une fois par mois pendant les périodes VAK
- Pas de travail le dimanche
- Le système gère ce cas via le planning hebdomadaire (`schedule`)

---

## 6. Sécurité des données

### Mesures techniques
- **Chiffrement** : TLS 1.3 entre le lecteur et le serveur
- **Authentification** : JWT avec expiration, rôles (ADMIN/RH/MANAGER)
- **Logs d'accès** : Toute consultation du registre est tracée
- **Sauvegarde** : Backup quotidien de la base PostgreSQL
- **Hébergement** : VPS Scaleway (France), conforme RGPD

### Mesures organisationnelles
- Accès aux données de pointage limité aux profils ADMIN, RH et MANAGER
- Les collaborateurs ne voient que leurs propres données (lecture seule)
- Les modifications manuelles sont tracées (identité du manager + horodatage)
- Le badge est strictement personnel, non cédable
- En cas de perte/vol : désactivation immédiate dans Solidata

---

## 7. Checklist de mise en conformité

- [ ] Inscrire le traitement au registre des traitements
- [ ] Rédiger et faire valider la note d'information aux salariés
- [ ] Consulter le CSE (dès élection)
- [ ] Distribuer la note d'information individuellement + affichage
- [ ] Configurer les durées de conservation dans Solidata
- [ ] Vérifier la politique de backup
- [ ] Documenter la procédure de perte/vol de badge
- [ ] Former les managers à l'utilisation du module

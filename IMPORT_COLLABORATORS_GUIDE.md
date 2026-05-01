# Guide d'Import de Collaborateurs

## Vue d'ensemble

Solidata inclut maintenant une fonctionnalité complète pour importer rapidement une liste de collaborateurs depuis un CSV.

## Accès à la page d'import

1. Se connecter avec un compte **ADMIN**
2. Naviguer vers `/admin-collaborators-import`
3. Ou via le menu d'administration (si configuré)

## Format du CSV requis

Le CSV doit contenir les colonnes suivantes (les en-têtes peuvent être en français ou en anglais) :

| Colonne | Variantes acceptées | Valeur exemple |
|---------|-------------------|-----------------|
| Identifiant Malibou | `malibou_id`, `ID` | `00482` |
| Prénom | `first_name`, `Prénom` | `Maria José` |
| Nom | `last_name`, `Nom` | `EROUART` |
| Poste | `position`, `Poste` | `Encadrante Technique` |
| Type de contrat | `contract_type`, `Type de contrat` | `CDI`, `CDD`, ou `Apprentissage` |

### Postes reconnus et mapping automatique

| Poste | Équipe assignée |
|-------|-----------------|
| Operateur De Tri Cddi, Operatrice De Tri Cddi | **tri** |
| Encadrante Technique, Salarie Polyvalent Cddi | **tri** |
| Operateur De Presse / Manutentionnaire Cddi | **tri** |
| Conducteur De Presse / Manutentionnaire Cddi | **tri** |
| Operatrice De Production | **tri** |
| Chauffeur / Suiveur / Manutentionnaire Cddi | **collecte** |
| Chauffeur Suiveur Polyvalent | **collecte** |
| Chauffeur / Suiveur Cddi | **collecte** |
| Responsable Logistique | **logistique** |
| Cariste Manutentionnaire | **logistique** |
| Assistant technique, Assistant Technique | **administration** |
| Directeur des Opérations | **administration** |
| Assistante Administrative | **administration** |
| Conseillère En Insertion Principale / Référente | **administration** |
| Apprenti CIP | **administration** |
| *Autres postes non reconnus* | **administration** (défaut) |

### Types de contrat supportés

- **CDI** → CDI
- **CDD** → CDD
- **Apprentissage** → Apprentissage

## Exemple de CSV

```csv
malibou_id,Prénom,Nom,Poste,Type de contrat
00482,Maria José,EROUART,Encadrante Technique,CDI
00634,Aline,ROIX,Conseillère En Insertion Principale / Référente,CDI
00732,Sophie,COLLEY,Operateur De Tri Cddi,CDD
00783,Alexandra,ARTIGUES,Chauffeur / Suiveur / Manutentionnaire Cddi,CDD
00843,Antoine,Delestre,Directeur des Opérations,CDI
```

## Procédure d'import

### Option 1 : Via l'interface web

1. Accéder à la page d'import (`/admin-collaborators-import`)
2. Préparer votre CSV en respectant le format requis
3. Coller le contenu du CSV dans le champ texte
4. Cliquer sur **Importer**
5. L'interface vous demandera confirmation pour :
   - Supprimer tous les employés existants
   - Importer les nouveaux collaborateurs
6. Examiner les résultats (succès/erreurs)

### Option 2 : Via l'API directement (curl)

```bash
curl -X POST http://localhost:3001/api/employees/import/csv \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collaborators": [
      {
        "first_name": "Maria José",
        "last_name": "EROUART",
        "position": "Encadrante Technique",
        "contract_type": "CDI"
      },
      {
        "first_name": "Sophie",
        "last_name": "COLLEY",
        "position": "Operateur De Tri Cddi",
        "contract_type": "CDD"
      }
    ]
  }'
```

## Données fournies (45 collaborateurs)

Les 45 collaborateurs suivants sont prêts à être importés :

### Administration & Encadrement (8)
- Maria José EROUART (Encadrante Technique, CDI)
- Aline ROIX (Conseillère En Insertion Principale, CDI)
- Antonio DE JESUS NUNES (Assistant technique, CDI)
- Astrid DE VIAL (Responsable Logistique, CDI)
- Mercedes DUJARDIN (Assistant Technique, CDI)
- Aurelie SELLES (Assistante Administrative, CDI)
- Antoine Delestre (Directeur des Opérations, CDI)
- Nolwenn Aroaro (Apprenti CIP, Apprentissage)

### Chauffeurs & Suiveurs Collecte (11)
- Sébastien MORIN (Chauffeur / Suiveur / Manutentionnaire, CDD)
- Hakim BEJAOUI (Chauffeur / Suiveur / Manutentionnaire, CDD)
- Walter FONTAINE (Chauffeur / Suiveur / Manutentionnaire, CDD)
- Mathieu PARIS (Chauffeur / Suiveur / Manutentionnaire, CDD)
- Haitham BAKKAR (Chauffeur / Suiveur / Manutentionnaire, CDD)
- Maxwell EKOMAN (Chauffeur / Suiveur / Manutentionnaire, CDD)
- Meddy MERCIEN (Chauffeur / Suiveur, CDD)
- Elsa LAURENT (Chauffeur / Suiveur, CDD)
- Pascal Oberli (Chauffeur Suiveur Polyvalent, CDD)
- Alexandre QUENEL (Cariste Manutentionnaire, CDD)

### Opérateurs De Tri (23)
- Veronique LEMIEUX (Salarie Polyvalent, CDD)
- Sophie COLLEY (Operateur De Tri, CDD)
- Aziza EL YAMLAHY (Operateur De Tri, CDD)
- Ophélie CARNEIRO (Salarie Polyvalent, CDD)
- Isabelle DESILE (Operateur De Tri, CDD)
- Marie-Lindsay GERVAIS (Operatrice De Tri, CDD)
- Fatou CISSE (Operatrice De Tri, CDD)
- Nolan LE QUEMENT (Operateur De Presse / Manutentionnaire, CDD)
- Steven PARIS (Operateur De Presse / Manutentionnaire, CDD)
- Esperance MANZITA KIBELA (Operatrice De Tri, CDD)
- Jules François NGALEU TCHEUGOUAH (Operateur De Presse / Manutentionnaire, CDD)
- Maryse MAURICE (Operatrice De Tri, CDD)
- Cindy MUNIER (Operatrice De Tri, CDD)
- Dany PEAN (Operatrice De Tri, CDD)
- Katy TELLIER (Operatrice De Production, CDD)
- Thibault PETIT (Conducteur De Presse / Manutentionnaire, CDD)
- Fanta DIABY (Operatrice De Tri, CDD)
- Fatou DIARRA (Operatrice De Tri, CDD)
- Dalila KATI (Operatrice De Tri, CDD)
- Estelle MAKOSSO (Operatrice De Tri, CDD)
- Saliha N'IMA (Operatrice De Tri, CDD)
- Amelie PERHERIN (Operatrice De Tri, CDD)
- Ghislain PREVOST (Conducteur De Presse / Manutentionnaire, CDD)
- Philippe ANQUETIL (Operateur De Presse / Manutentionnaire, CDD)

## Points importants

⚠️ **Attention** : 
- L'import supprime **tous les employés existants** avant d'importer les nouveaux
- Cette action est irreversible sans backup préalable
- Confirmez bien votre choix dans la boîte de dialogue de confirmation

✅ **Avantages** :
- Assignation automatique aux équipes (tri, collecte, logistique, administration)
- Types de contrat correctement mappés
- Préparation rapide de la base de données
- Gestion des erreurs avec messages détaillés

## Dépannage

### Erreur : "Tableau de collaborateurs requis"
Assurez-vous que le CSV contient au moins une ligne valide avec `first_name` et `last_name`.

### Erreur : "Aucun collaborateur valide trouvé"
Vérifiez :
- Les en-têtes de colonne (malibou_id, prénom/first_name, nom/last_name, etc.)
- Qu'aucune ligne n'est vide
- L'encodage du fichier (UTF-8 recommandé)

### Les collaborateurs n'apparaissent pas après import
Vérifiez que vous êtes connecté avec un compte **ADMIN** et que vous consultez la page `/employees` ou `/hub-equipe`.

## API Endpoints

### POST /api/employees/import/csv
Import des collaborateurs depuis un tableau JSON.

**Params:**
```json
{
  "collaborators": [
    {
      "first_name": "string",
      "last_name": "string",
      "position": "string",
      "contract_type": "CDI|CDD|Apprentissage"
    }
  ]
}
```

**Réponse:**
```json
{
  "message": "X collaborateurs importés",
  "created": [ {...} ],
  "errors": [ {...} ],
  "total": number
}
```

### DELETE /api/employees/clear
Supprime tous les employés, contrats, et données associées.

**Réponse:**
```json
{
  "message": "Tous les employés ont été supprimés"
}
```

---

**Branche de développement:** `claude/import-collaborators-solidata-m8ajS`
**Dernière mise à jour:** 2026-05-01

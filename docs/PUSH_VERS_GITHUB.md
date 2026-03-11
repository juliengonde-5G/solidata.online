# Pousser les mises à jour vers GitHub

## Méthode rapide (Windows)

Depuis la **racine du projet**, en invite de commandes ou PowerShell :

```batch
push.bat "Charte graphique, tests déploiement, scripts deploy et run-tests"
```

Ou avec un message plus court :

```batch
push.bat "Mise à jour UX, tests et scripts de déploiement"
```

Le script `push.bat` fait automatiquement :
1. `git add -A` (ajoute tous les fichiers modifiés et nouveaux)
2. `git commit -m "votre message"`
3. `git push origin main`

---

## Méthode manuelle

```batch
cd "c:\Users\julie\Solidarité emploi par le textiles en Normandie\SP_Soltex76 - Documents\Solidarité\Production\Suivi De Production\Solidata Web\solidata.online"

git add -A
git status
git commit -m "Charte graphique bleu pétrole, tests déploiement, scripts deploy et run-tests"
git push origin main
```

---

## Si le push demande une authentification

GitHub n’accepte plus le mot de passe sur `git push` pour les dépôts HTTPS. Deux options :

### Option 1 : Token personnel (HTTPS)

1. Sur GitHub : **Settings** → **Developer settings** → **Personal access tokens** → **Generate new token**.
2. Cochez au minimum **repo**.
3. Copiez le token.
4. Lors du `git push`, quand Git demande le mot de passe, **collez le token** (et non votre mot de passe GitHub).

Pour ne pas le ressaisir à chaque fois (Windows) :

- **Gestionnaire d’identifiants Windows** : Panneau de configuration → Gestionnaire d’identifiants → Identifiants Windows → Modifier l’entrée `git:https://github.com` et mettre le token en mot de passe.

### Option 2 : SSH

1. Générer une clé SSH si besoin : `ssh-keygen -t ed25519 -C "votre@email.com"`.
2. Ajouter la clé publique à GitHub : **Settings** → **SSH and GPG keys** → **New SSH key**.
3. Changer l’URL du remote en SSH :
   ```batch
   git remote set-url origin git@github.com:juliengonde-5G/solidata.online.git
   ```
4. Ensuite : `git push origin main` (sans mot de passe si la clé est utilisée).

---

## Vérifier après le push

- Sur GitHub : https://github.com/juliengonde-5G/solidata.online — les derniers commits et fichiers doivent apparaître.

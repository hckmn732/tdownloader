# Gestionnaire de Téléchargements Torrent

Application web moderne pour gérer vos téléchargements torrent avec **aria2**. Cette application permet d'ajouter des torrents (magnets ou fichiers `.torrent`), de suivre leur progression en temps réel, et de s'assurer qu'ils ne seedent **jamais** après complétion.

## 🎯 Fonctionnalités

- ✅ Ajout de torrents via liens magnets ou fichiers `.torrent`
- ✅ Suivi en temps réel de la progression des téléchargements
- ✅ Gestion complète : pause, reprise, annulation, suppression
- ✅ **Mode download-only** : aucun seed/upload après complétion
- ✅ Interface web moderne avec Next.js et React
- ✅ Base de données SQLite avec Prisma
- ✅ Support Windows et Linux

## 📋 Prérequis

- **Node.js** 18+ et npm
- **aria2** installé et disponible dans le PATH (voir section Installation aria2)
- Git (optionnel)

## 🚀 Installation

### 1. Cloner le projet

```bash
git clone <votre-repo>
cd Downloader
```

### 2. Installer aria2

#### Windows

**Option A : Utiliser la version incluse (recommandé)**

Le projet inclut déjà une version précompilée d'aria2 dans le dossier `aria2-bin/`. Aucune installation supplémentaire n'est nécessaire.

**Option B : Installation manuelle**

1. Télécharger aria2 depuis [GitHub Releases](https://github.com/aria2/aria2/releases)
2. Extraire l'archive dans un dossier (par exemple `C:\aria2`)
3. Ajouter le dossier au PATH système :
   - Ouvrir "Variables d'environnement" dans Windows
   - Ajouter le chemin vers `aria2c.exe` au PATH
4. Vérifier l'installation :
   ```powershell
   aria2c --version
   ```

**Option C : Utiliser un gestionnaire de paquets**

```powershell
# Avec Chocolatey
choco install aria2

# Avec Scoop
scoop install aria2

# Avec winget
winget install aria2.aria2
```

#### Linux

**Debian / Ubuntu**

```bash
sudo apt-get update
sudo apt-get install aria2
```

**RHEL / CentOS / Fedora**

```bash
# Fedora
sudo dnf install aria2

# RHEL/CentOS
sudo yum install aria2
```

**Arch Linux**

```bash
sudo pacman -S aria2
```

**Vérifier l'installation :**

```bash
aria2c --version
```

### 3. Installer les dépendances Node.js

```bash
cd web
npm install
```

### 4. Configurer la base de données

```bash
cd web
npx prisma migrate dev
npx prisma generate
```

### 5. Configuration de l'environnement

Créer un fichier `.env` dans le dossier `web/` :

```env
# Port du serveur Next.js
PORT=3000

# Dossier de téléchargement (relatif à la racine du projet)
DOWNLOADS_BASE_DIR=../downloads

# URL de l'API RPC d'aria2
ARIA2_RPC_URL=http://127.0.0.1:6800/jsonrpc

# Secret RPC pour aria2 (changez-le pour la production !)
ARIA2_RPC_SECRET=changeme

# Configuration IA (optionnel)
AI_ENDPOINT_URL=http://localhost:11434/v1/complete
AI_API_KEY=changeme

# Nombre maximum de téléchargements parallèles
MAX_PARALLEL_DOWNLOADS=3

# Environnement
NODE_ENV=development
```

**Important :** Changez la valeur de `ARIA2_RPC_SECRET` pour la production !

## 🎮 Utilisation

### Démarrer aria2

Avant de lancer l'application web, vous devez démarrer aria2.

#### Windows

```powershell
# Depuis la racine du projet
.\start-aria2.ps1
```

Ce script :
- Vérifie que aria2 est disponible
- Crée le dossier `downloads/` s'il n'existe pas
- Lance aria2 avec les paramètres optimaux (no-seed)
- Ouvre aria2 dans une nouvelle fenêtre PowerShell

#### Linux

```bash
# Depuis la racine du projet
chmod +x start-aria2.sh  # Rendre le script exécutable (première fois seulement)
./start-aria2.sh
```

Ce script :
- Vérifie que aria2 est installé
- Crée le dossier `downloads/` s'il n'existe pas
- Lance aria2 en arrière-plan (daemon)
- Configure les variables d'environnement nécessaires

### Vérifier que aria2 fonctionne

#### Windows

```powershell
.\check-aria2.ps1
```

#### Linux

```bash
./check-aria2.sh
```

### Démarrer l'application web

Dans un nouveau terminal :

```bash
cd web
npm run dev
```

L'application sera accessible à l'adresse : **http://localhost:3000**

### Arrêter aria2

#### Windows

Fermer la fenêtre PowerShell où aria2 est lancé, ou utiliser le Gestionnaire des tâches :

```powershell
# Tuer tous les processus aria2c
Get-Process aria2c | Stop-Process
```

#### Linux

```bash
# Trouver le PID
pgrep aria2c

# Arrêter aria2
pkill aria2c

# Ou de manière plus sélective
killall aria2c
```

## 📁 Structure du projet Managers

```
Downloader/
├── aria2-bin/                    # Binaires aria2 pour Windows
│   └── aria2-1.37.0-win-64bit-build1/
│       └── aria2c.exe
├── downloads/                    # Dossier de téléchargement (créé automatiquement)
├── web/                          # Application Next.js
│   ├── app/                      # Routes Next.js App Router
│   ├── src/                      # Code source
│   │   ├── lib/                  # Bibliothèques utilitaires
│   │   │   ├── aria2/            # Client et service aria2
│   │   │   └── prisma.ts         # Client Prisma
│   │   └── app/                  # Composants React
│   ├── prisma/                   # Schéma et migrations Prisma
│   │   ├── schema.prisma         # Schéma de base de données
│   │   └── migrations/           # Migrations de base de données
│   └── package.json
├── start-aria2.ps1               # Script de démarrage (Windows)
├── start-aria2.sh                # Script de démarrage (Linux)
├── check-aria2.ps1               # Script de vérification (Windows)
├── check-aria2.sh                # Script de vérification (Linux)
├── SPEC.md                       # Spécifications techniques détaillées
└── README.md                     # Ce fichier
```

## 🔧 Configuration avancée

### Modifier le secret RPC

Pour plus de sécurité, changez le secret RPC :

1. Modifier la variable `ARIA2_RPC_SECRET` dans le fichier `.env` du dossier `web/`
2. Utiliser la même valeur lors du lancement d'aria2 :

**Windows :**
```powershell
$env:ARIA2_RPC_SECRET = "votre-secret-personnalise"
.\start-aria2.ps1
```

**Linux :**
```bash
export ARIA2_RPC_SECRET="votre-secret-personnalise"
./start-aria2.sh
```

### Changer le dossier de téléchargement

1. Modifier `DOWNLOADS_BASE_DIR` dans `.env`
2. Modifier les scripts `start-aria2.ps1` ou `start-aria2.sh` pour pointer vers le nouveau dossier

### Paramètres aria2 personnalisés

Les paramètres par défaut d'aria2 sont optimisés pour le mode download-only :

- `--seed-time=0` : Pas de seed après complétion
- `--seed-ratio=0` : Ratio de seed à 0
- `--max-upload-limit=1K` : Limite d'upload minimale
- `--bt-max-peers=50` : Nombre maximum de pairs

Vous pouvez modifier ces paramètres dans les scripts `start-aria2.ps1` ou `start-aria2.sh`.

## 🛠️ Commandes utiles

### Base de données Prisma

```bash
cd web

# Créer une nouvelle migration
npx prisma migrate dev --name nom_de_la_migration

# Réinitialiser la base de données
npx prisma migrate reset

# Ouvrir Prisma Studio (interface graphique)
npx prisma studio

# Générer le client Prisma
npx prisma generate
```

### Application Next.js

```bash
cd web

# Mode développement
npm run dev

# Build de production
npm run build

# Démarrer en production
npm start

# Linter
npm run lint
```

## 🐛 Dépannage

### aria2 ne démarre pas

**Windows :**
- Vérifier que `aria2c.exe` est présent dans `aria2-bin/aria2-1.37.0-win-64bit-build1/`
- Vérifier les permissions d'exécution

**Linux :**
- Vérifier que aria2 est installé : `aria2c --version`
- Vérifier les permissions : `chmod +x start-aria2.sh`

### L'application ne peut pas se connecter à aria2

1. Vérifier que aria2 est en cours d'exécution : `./check-aria2.sh` (Linux) ou `.\check-aria2.ps1` (Windows)
2. Vérifier que le secret RPC correspond dans :
   - Le fichier `.env` de l'application web
   - La variable d'environnement lors du lancement d'aria2
3. Vérifier que le port 6800 n'est pas bloqué par un firewall

### Erreurs de base de données

```bash
cd web
npx prisma migrate reset  # Réinitialise la base de données
npx prisma migrate dev    # Recréer les migrations
```

### Port déjà utilisé

Si le port 3000 est déjà utilisé :

1. Modifier `PORT` dans `.env`
2. Ou changer le port dans la commande : `PORT=3001 npm run dev`

## 🔒 Sécurité

- **Important :** Changez `ARIA2_RPC_SECRET` en production !
- aria2 écoute uniquement en local (`--rpc-listen-all=false`) par défaut
- Assurez-vous que les ports ne sont pas exposés publiquement si vous déployez l'application

## 📝 Notes importantes

- **Mode download-only** : Cette application est configurée pour ne jamais seed/upload après complétion. Les paramètres aria2 sont optimisés pour cela.
- **Conservation des fichiers originaux** : Les noms originaux des fichiers sont conservés dans la base de données même si un renommage est effectué.
- **IA optionnelle** : L'intégration IA pour le renommage automatique est optionnelle et peut être désactivée.

## 📚 Ressources

- [Documentation aria2](https://aria2.github.io/)
- [Documentation Next.js](https://nextjs.org/docs)
- [Documentation Prisma](https://www.prisma.io/docs)
- [Spécifications techniques du projet](./SPEC.md)

## 📄 Licence

Voir le fichier LICENSE pour plus de détails.

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou une pull request.

---

**Bon téléchargement ! 🚀**


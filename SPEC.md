## Projet: Gestionnaire de Téléchargements Torrent (Download-only)

### Résumé exécutable
- But: Application légère pour ajouter des torrents (magnet ou `.torrent`), télécharger côté serveur, suivre en temps réel, et ne jamais seed/upload après complétion. IA facultative pour classifier, choisir le dossier, et nettoyer les noms tout en conservant les originaux.
 - Stack: Backend NestJS + Prisma/SQLite, Frontend React (Vite), temps réel via WebSocket. Moteur BitTorrent: aria2 (stricte no-seed).
- Non-microservices: 1 API + 1 SPA + 1 processus aria2.

---

## 1. Portée Fonctionnelle

### 1.1 Ajout de torrents
- Entrées supportées: liens magnets et fichiers `.torrent` (upload), en unitaire ou multiple (drag & drop ou champ texte multi-lignes).
- Démarrage automatique du téléchargement à l’ajout.

### 1.2 Téléchargement sans seed
- Objectif: upload effectif nul après complétion.
- Politique:
  - Moteur: aria2 avec `--seed-time=0` et `--seed-ratio=0`, `--max-upload-limit=1K` (valeur quasi nulle) pour limiter l’upload pendant le download.
  - À la complétion, arrêt du GID (retire les connexions).

### 1.3 Suivi & gestion
- Statuts: queued, downloading, paused, completed, failed, cancelled.
- Mesures: progression %, vitesse download, vitesse upload, ETA, taille totale, téléchargée, nombre de pairs, erreurs.
- Actions: pause, reprise, annulation, suppression (avec/ sans suppression des fichiers), re-scan au redémarrage.

### 1.4 IA de nommage et organisation
- Déclenchement: à l’obtention des métadonnées (nom du torrent et liste des fichiers si disponible).
- Entrée IA: `originalName`, `magnetUri?`, `fileList[{path,size}]`.
- Sortie IA: `targetDir`, `cleanedName?`, `filesRenameMap[{from,to}]`.
- Application: renommage/nettoyage et placement en dossier cible après complétion du téléchargement; conservation des originaux en base.

### 1.5 UI/UX
- SPA moderne, mode clair/sombre.
- Tableau de bord: liste des torrents, filtres, recherche, progression en direct.
- Détail: progression par fichier, logs en direct, carte IA (suggestion, appliquer/relancer).
- Paramètres: dossier par défaut, IA activée, limite d’upload (affichée à 0), téléchargements simultanés max.

### 1.6 Hors-portée
- Pas de seed ni de partage après complétion; pas de transcodage multimédia; pas d’indexation/metadata enrichie avancée; pas de multi-tenant.

---

## 2. Architecture & Composants

### 2.1 Frontend
- React + Vite
- UI: shadcn/ui (Radix) + Tailwind, basé sur un template d'admin dashboard
- Données: `@tanstack/react-query`
- WebSocket: `socket.io-client`
- Upload: `react-dropzone`

### 2.2 Backend
- NestJS (REST + WebSocket Gateway `socket.io`)
- Prisma + SQLite
- Moteur torrent: aria2 via JSON-RPC (unique)

### 2.3 Processus aria2 (recommandé)
- Lancement par l’API au démarrage (process enfant) ou supervisé séparément.
- Paramètres clés:
```bash
aria2c \
  --enable-rpc \
  --rpc-listen-all=false \
  --rpc-secret="$ARIA2_RPC_SECRET" \
  --check-integrity=true \
  --continue=true \
  --seed-time=0 \
  --seed-ratio=0 \
  --max-upload-limit=1K \
  --bt-max-peers=50 \
  --dir="$DOWNLOADS_BASE_DIR"
```

---

## 3. Modèle de Données (Prisma)

```prisma
// prisma/schema.prisma (extrait)
datasource db {
  provider = "sqlite"
  url      = "file:./db.sqlite"
}

generator client {
  provider = "prisma-client-js"
}

enum TorrentStatus {
  queued
  downloading
  paused
  completed
  failed
  cancelled
}

model Torrent {
  id                 String        @id @default(cuid())
  type               String        // magnet | torrent
  magnetUri          String?       @db.Text
  torrentFilePath    String?       @db.Text
  originalName       String
  cleanedName        String?
  originalToCleanMap Json?
  suggestedDir       String?
  finalDir           String?
  status             TorrentStatus @default(queued)
  progress           Float         @default(0)
  bytesTotal         BigInt        @default(0)
  bytesDone          BigInt        @default(0)
  downloadSpeed      BigInt        @default(0)
  etaSec             Int?          
  aria2Gid           String?       @unique
  errorMessage       String?
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt
  files              TorrentFile[]
  events             EventLog[]
}

model TorrentFile {
  id            String  @id @default(cuid())
  torrentId     String
  torrent       Torrent @relation(fields: [torrentId], references: [id], onDelete: Cascade)
  originalPath  String
  cleanedPath   String?
  bytesTotal    BigInt  @default(0)
  bytesDone     BigInt  @default(0)
  priority      Int     @default(0)
}

model EventLog {
  id        String   @id @default(cuid())
  torrentId String
  torrent   Torrent  @relation(fields: [torrentId], references: [id], onDelete: Cascade)
  level     String   // info | warn | error
  message   String   @db.Text
  createdAt DateTime @default(now())
}

model Setting {
  key   String @id
  value Json
}
```

---

## 4. API (REST) & Événements (WebSocket)

### 4.1 REST
- POST `/torrents`
  - Body:
  ```json
  {
    "magnets": ["magnet:?xt=urn:btih:..."],
    "applyAi": true
  }
  ```
  - Ou multipart form: `files[]` pour `.torrent` + champ `applyAi`.
  - Réponse: tableau des `Torrent` créés.

- GET `/torrents?status=&q=&orderBy=createdAt&order=desc&limit=50&offset=0`
- GET `/torrents/:id`
- POST `/torrents/:id/pause`
- POST `/torrents/:id/resume`
- POST `/torrents/:id/cancel`
- DELETE `/torrents/:id?deleteData=false`
- GET `/torrents/:id/logs?limit=200`
- GET `/settings`
- PUT `/settings` (payload JSON libre)
- POST `/torrents/:id/apply-ai` (relance IA sur un torrent)

### 4.2 WebSocket (`socket.io`)
- Canaux/événements:
  - `torrent.added` → `{ id, name, status }`
  - `torrent.updated` → `{ id, status, progress, downloadSpeed, uploadSpeed, bytesDone, bytesTotal, etaSec, numPeers }`
  - `torrent.completed` → `{ id, finalDir }`
  - `torrent.error` → `{ id, errorMessage }`
  - `torrent.removed` → `{ id }`
  - `torrent.log` → `{ id, level, message, createdAt }`

Schéma de payload stable, versionnable via champ `v` si besoin.

---

## 5. Flux Métier

### 5.1 Ajout → Téléchargement → Complétion
1. Requête POST `/torrents` (magnets ou `.torrent`).
2. Backend crée en DB `Torrent` (status `queued`).
3. Ajout au moteur (aria2: `addUri`/`addTorrent`).
4. Status passe à `downloading`; émission `torrent.added`.
5. Polling/événements: mise à jour DB, émission `torrent.updated` toutes ~1s.
6. À 100%:
   - Aria2: arrêt du GID; status `completed`.
   - Application IA (si active): renommage et déplacement atomique.
   - Mise à jour DB (`cleanedName`, `finalDir`, mapping); émission `torrent.completed`.

### 5.2 IA
1. Déclenchement à la disponibilité des métadonnées (nom + fichiers).
2. Appel IA:
```json
{
  "originalName": "Ubuntu.ISO.22.04.x64",
  "magnetUri": "magnet:?...",
  "fileList": [{ "path": "Ubuntu.iso", "size": 3808428032 }]
}
```
3. Réponse attendue:
```json
{
  "targetDir": "linux/ubuntu/22.04",
  "cleanedName": "Ubuntu 22.04 x64",
  "filesRenameMap": [{ "from": "Ubuntu.iso", "to": "Ubuntu-22.04-x64.iso" }]
}
```
4. Validation: pas de `..`, pas de chemins absolus, charset sûr, longueur bornée.
5. Application après complétion: renommage disque, mise à jour DB.

### 5.3 Robustesse au redémarrage
- Au boot: reconnecter aux téléchargements actifs (aria2: `tellActive`, `tellWaiting`), resynchroniser DB/états et réémettre une photo initiale aux clients connectés.

---

## 6. Sécurité & Conformité
- API protégée par token Bearer simple (configurable); CORS restrictif aux origines UI.
- RPC aria2 protégé par `--rpc-secret` et bind local uniquement (`--rpc-listen-all=false`).
- Sécurité des chemins: normalisation stricte, sandbox du `DOWNLOADS_BASE_DIR`.
- Légalité: bannière d’usage légal; blocage de seed.

---

## 7. Configuration & Environnement

### 7.1 Variables d’environnement
```env
PORT=3000
DOWNLOADS_BASE_DIR=./downloads
AI_ENDPOINT_URL=http://localhost:11434/v1/complete
AI_API_KEY=changeme
ARIA2_RPC_SECRET=changeme
MAX_PARALLEL_DOWNLOADS=3
NODE_ENV=development
```

### 7.2 Scripts utiles
```bash
# Lancer aria2 localement (dev)
aria2c \
  --enable-rpc --rpc-listen-all=false --rpc-secret=$ARIA2_RPC_SECRET \
  --check-integrity=true --continue=true \
  --seed-time=0 --seed-ratio=0 --max-upload-limit=1K \
  --bt-max-peers=50 --dir=$DOWNLOADS_BASE_DIR
```

---

## 8. UI: Écrans & Composants

### 8.1 Tableau de bord
- Actions: bouton "Ajouter torrents" (dialog + dropzone), champ magnets multi-lignes.
- Table colonnes: Nom (original + badge "clean" si différent), Statut, ProgressBar, Vitesse DL, ETA, Taille, Créé le, Actions (pause, reprise, annuler, supprimer).
- Filtres: statut; recherche texte.

### 8.2 Détail torrent
- En-tête: nom original / nom nettoyé, statut, progression.
- Liste fichiers: progression par fichier, tailles, renommage proposé/appliqué.
- Logs en direct.
- Carte IA: suggestion, "Appliquer" / "Relancer".

### 8.3 Paramètres
- Dossier par défaut, IA par défaut, limite d’upload (0), téléchargements simultanés max.

### 8.4 Template d'admin dashboard (frontend)
- Base visuelle et composants issus d’un template admin pour accélérer :
  - Layout complet (Sidebar, Header, Footer, Page content)
  - Navigation, Breadcrumbs, Thèmes clair/sombre, Tables, Dialogs, Badges, Progress
- Intégration prévue avec shadcn/ui + Tailwind pour personnalisation facile.

---

## 9. Spécification Implémentation (étapes automatisables)

### 9.1 Initialisation projet
```bash
# Backend
npm create nest@latest backend --yes
cd backend && npm i @nestjs/config @nestjs/websockets @nestjs/platform-socket.io \
  socket.io socket.io-client \
  @prisma/client prisma axios class-transformer class-validator && cd ..

# Frontend
npm create vite@latest frontend -- --template react-ts
cd frontend && npm i @tanstack/react-query socket.io-client \
  tailwindcss postcss autoprefixer class-variance-authority \
  tailwind-merge lucide-react && npx tailwindcss init -p && cd ..

# Prisma
cd backend && npx prisma init && cd ..
```

### 9.2 Schéma Prisma & migration
```bash
cd backend
# Écrire prisma/schema.prisma (voir section 3), puis:
npx prisma migrate dev --name init
```

### 9.3 Module aria2 (service + client RPC)
- Client JSON-RPC (HTTP) minimal: méthodes `addUri`, `addTorrent`, `tellStatus`, `getFiles`, `tellActive`, `tellWaiting`, `remove`, `forceRemove`.
- Service `Aria2Service` encapsulant les appels et la conversion en DTO internes.

### 9.4 Module torrents
- `TorrentsService`: orchestration DB + aria2 + IA + file ops.
- `TorrentsController`: endpoints REST (section 4.1).
- `TorrentsGateway`: WebSocket, émission des événements (section 4.2).

### 9.5 Module IA
- `AiService`: appel HTTP à `AI_ENDPOINT_URL` avec `AI_API_KEY`.
- Validation stricte de la réponse (sanitization chemins, longueurs).

### 9.6 Gestion fichiers & renommage
- Renommer/déplacer après complétion uniquement; opérations atomiques; rollback si échec; mise à jour DB cohérente.

### 9.7 Frontend
- Option A (recommandé): Template Admin shadcn/ui
  - Installer shadcn/ui et composants admin essentiels
  ```bash
  cd frontend
  npm i clsx tailwind-merge @radix-ui/react-slot @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tabs
  npx shadcn@latest init -d
  # Ajouter composants de base (typography, button, input, dialog, dropdown-menu, table, badge, progress, toast, card, tabs)
  npx shadcn@latest add button input dialog dropdown-menu table badge progress toast card tabs separator skeleton label switch avatar tooltip breadcrumb navigation-menu sheet
  ```
  - Générer le layout Admin: `Sidebar` fixe + `Header` avec actions; pages: Dashboard, TorrentDetail, Settings.
  - Brancher `QueryClientProvider` et `socket.io-client` dans `main.tsx` et `App.tsx`.

- Option B: React Admin (Material UI)
  - Fournit layout admin prêt, routing, tables, filtres.
  ```bash
  cd frontend
  npm i react-admin ra-data-simple-rest @mui/material @emotion/react @emotion/styled @mui/icons-material
  ```
  - Adapter un dataProvider REST vers l’API Nest (`/torrents`, `/settings`).

- Dans les deux cas
  - Pages: Dashboard, TorrentDetail, Settings.
  - Composants: Table, Dialog (ajout), Progress, Badge, Toast, Tabs, Card.

### 9.8 Démarrage & intégration aria2
- Lancer aria2 au boot (process enfant) ou exiger qu’il soit lancé (dev: script). Stocker `ARIA2_RPC_SECRET` en env.
- Vérifier connexion RPC au démarrage API; remonter les GIDs actifs en DB et émettre l’état initial aux clients.

---

## 10. Contrats de Données (DTO)

```ts
// POST /torrents (JSON)
type CreateTorrentsDto = {
  magnets?: string[];
  applyAi?: boolean;
};

// GET /torrents (réponse item)
type TorrentItem = {
  id: string;
  name: string; // originalName
  cleanedName?: string;
  status: 'queued'|'downloading'|'paused'|'completed'|'failed'|'cancelled';
  progress: number; // 0..100
  bytesDone: number;
  bytesTotal: number;
  downloadSpeed: number;
  etaSec?: number;
  createdAt: string;
};

// WS torrent.updated
type TorrentUpdateEvent = {
  id: string;
  status: TorrentItem['status'];
  progress: number;
  bytesDone: number;
  bytesTotal: number;
  downloadSpeed: number;
  uploadSpeed: number;
  etaSec?: number;
  numPeers?: number;
};
```

---

## 11. Critères d’Acceptation
- Ajout de 3 magnets via `/torrents` crée 3 enregistrements; la UI affiche 3 lignes avec progression temps réel (< 1s de latence perçue).
- À 100%, le téléchargement s’arrête et aucun seed n’est observé (aria2: GID stoppé; ratio non incrémenté après fin).
- IA renvoie un dossier et un nom nettoyé; après application, les fichiers sont renommés/déplacés correctement; les noms originaux restent en DB.
- Redémarrage de l’API: les téléchargements en cours sont retrouvés et affichés, sans duplication.

---

## 12. Observabilité & Logs
- Backend log JSON (niveau, message, contexte torrentId/GID).
- `EventLog` persiste les événements importants (erreurs, transitions, IA appliquée).
- Rotation des logs (niveau infra).

---

## 13. Plans d’Exécution (phases)
1. Base API + aria2 + DB + ajout magnet/`.torrent` + liste/suivi basique.
2. UI dashboard + WebSocket + actions pause/reprise/annule.
3. IA + renommage/dossier + écran détail + logs.
4. Paramètres, sécurité (token), polissage UI, tests e2e essentiels.

---

 

## 15. Arborescence Projet
```
.
├─ backend/
│  ├─ src/
│  │  ├─ app.module.ts
│  │  ├─ torrents/
│  │  │  ├─ torrents.controller.ts
│  │  │  ├─ torrents.service.ts
│  │  │  ├─ torrents.gateway.ts
│  │  ├─ aria2/
│  │  │  ├─ aria2.service.ts
│  │  │  ├─ aria2.client.ts
│  │  ├─ ai/
│  │  │  ├─ ai.service.ts
│  │  ├─ settings/
│  │  │  ├─ settings.controller.ts
│  │  │  ├─ settings.service.ts
│  ├─ prisma/
│  │  └─ schema.prisma
│  ├─ .env
├─ frontend/
│  ├─ src/
│  │  ├─ pages/
│  │  │  ├─ Dashboard.tsx
│  │  │  ├─ TorrentDetail.tsx
│  │  │  ├─ Settings.tsx
│  │  ├─ components/
│  │  │  ├─ TorrentTable.tsx
│  │  │  ├─ AddTorrentDialog.tsx
│  │  │  ├─ Progress.tsx
│  │  │  ├─ Logs.tsx
│  ├─ index.html
├─ downloads/ (créé au runtime)
├─ SPEC.md
```

---

## 16. Notes d’Automatisation pour Agent IA
- Toutes les commandes d’initialisation sont listées (sections 7.2, 9.1, 9.2).
- Les schémas (Prisma, DTO, événements) sont spécifiés pour génération de code.
- Les endpoints REST et événements WS sont définis avec payloads stables.
- Les validations de sécurité (chemins, CORS, auth token) sont explicitées.
- Les critères d’acceptation servent de tests d’achèvement.

---

## 17. Plan de Tâches Orchestrées par Agent IA (Option A — shadcn/ui)

Objectif: L’agent propose les commandes, l’utilisateur confirme avant exécution. L’agent vérifie les résultats, corrige si nécessaire, et continue jusqu’à complétion. Les commandes sont adaptées à Windows PowerShell (shell courant).

### 17.1 Règles d’interaction
- **Proposition → Confirmation → Exécution**: l’agent propose un bloc de commandes; l’utilisateur approuve avant exécution.
- **Non-interactif**: utiliser des flags `--yes`/équivalents quand disponibles.
- **Contexte**: l’agent rappelle le dossier courant et les prérequis avant chaque lot de commandes.
- **Validation**: après chaque étape, l’agent vérifie la présence de fichiers, versions, ou sortie attendue.
- **Journal**: l’agent résume brièvement réussites/erreurs et propose remédiations.

### 17.2 Préparation du workspace
Tâches:
- Créer la structure `backend/`, `frontend/`, `prisma/` si absente.
- Initialiser Git si souhaité.

Commandes proposées (à exécuter depuis la racine du projet):
```powershell
# Facultatif: initialiser git
git init
git add .
git commit -m "chore: init workspace with SPEC.md"
```

Checkpoints:
- Un repo Git initialisé (facultatif).

### 17.3 Backend NestJS
Tâches:
- Créer l’app NestJS.
- Installer dépendances: config, websockets/socket.io, Prisma client, axios, class-validator/transformer.

Commandes proposées:
```powershell
npm create nest@latest backend --yes
cd backend
npm i @nestjs/config @nestjs/websockets @nestjs/platform-socket.io socket.io socket.io-client
npm i @prisma/client prisma axios class-transformer class-validator
```

Checkpoints:
- Dossier `backend/` avec squelette Nest.
- `package.json` contient les dépendances listées.

### 17.4 Prisma + SQLite
Tâches:
- Initialiser Prisma, écrire `prisma/schema.prisma` (cf. section 3), migrer.

Commandes proposées:
```powershell
cd backend
npx prisma init
# L’agent écrit prisma/schema.prisma depuis la spec
npx prisma migrate dev --name init
```

Checkpoints:
- Fichier `backend/prisma/schema.prisma` conforme.
- Fichier `backend/prisma/dev.db` ou `backend/db.sqlite` créé selon config.

### 17.5 Module aria2
Tâches:
- Créer `aria2.client.ts` (JSON-RPC), `aria2.service.ts` (façade Nest).
- Exposer méthodes: `addUri`, `addTorrent`, `tellStatus`, `getFiles`, `tellActive`, `tellWaiting`, `remove`, `forceRemove`.

Actions agent:
- Générer fichiers TypeScript dans `backend/src/aria2/` selon contrats section 4 et 9.

### 17.6 Module torrents
Tâches:
- Créer `torrents.controller.ts`, `torrents.service.ts`, `torrents.gateway.ts`.
- Implémenter endpoints REST (section 4.1) et événements WS (4.2).
- Intégrer Prisma pour persistance et Aria2Service pour moteur.

Actions agent:
- Générer DTOs, services, contrôleurs, gateway.
- Brancher validation via class-validator.

### 17.7 Module IA
Tâches:
- Créer `ai.service.ts` (appel HTTP vers `AI_ENDPOINT_URL`).
- Valider la réponse, sécuriser chemins et longueurs, appliquer après complétion.

### 17.8 Configuration & Env
Tâches:
- Ajouter `@nestjs/config`, charger variables env (section 7.1).
- Créer `.env` (dev) avec valeurs par défaut.

Commandes proposées:
```powershell
cd backend
Copy-Item -Path .env.example -Destination .env -ErrorAction SilentlyContinue
```

Actions agent:
- S’il n’existe pas, créer `.env` avec variables section 7.1.

### 17.9 Lancement aria2 (local)
Tâches:
- Démarrer `aria2c` protégé par secret RPC, lié en local.

Commandes proposées (nouvelle fenêtre PowerShell):
```powershell
$env:ARIA2_RPC_SECRET = "changeme"
$env:DOWNLOADS_BASE_DIR = "./downloads"
aria2c --enable-rpc --rpc-listen-all=false --rpc-secret=$env:ARIA2_RPC_SECRET `
  --check-integrity=true --continue=true --seed-time=0 --seed-ratio=0 --max-upload-limit=1K `
  --bt-max-peers=50 --dir=$env:DOWNLOADS_BASE_DIR
```

Checkpoints:
- Aria2 écoute en RPC et télécharge dans `downloads/`.

### 17.10 Frontend — Template Admin (shadcn/ui)
Tâches:
- Créer app Vite React TS.
- Installer `react-query`, `socket.io-client`, Tailwind, shadcn/ui et composants admin.
- Générer layout admin (Sidebar/Header), pages (Dashboard, TorrentDetail, Settings).

Commandes proposées:
```powershell
cd ..
npm create vite@latest frontend -- --template react-ts
cd frontend
npm i @tanstack/react-query socket.io-client tailwindcss postcss autoprefixer class-variance-authority tailwind-merge lucide-react clsx
npx tailwindcss init -p
npx shadcn@latest init -d
npx shadcn@latest add button input dialog dropdown-menu table badge progress toast card tabs separator skeleton label switch avatar tooltip breadcrumb navigation-menu sheet
```

Actions agent:
- Configurer Tailwind (`tailwind.config.js`, `index.css`).
- Ajouter `QueryClientProvider`, client Socket dans `main.tsx`.
- Implémenter pages et composants basés sur la section 8.

Checkpoints:
- UI de base accessible, table présente, dialog d’ajout fonctionnel (sans backend au début).

### 17.11 Intégration Front ↔ Back
Tâches:
- Configurer baseURL API et WS.
- Appeler POST `/torrents` depuis le dialog.
- Souscrire `torrent.updated` via socket et mettre à jour le store React Query.

### 17.12 Tests manuels et critères d’acceptation
Tâches:
- Ajouter 3 magnets, vérifier progression et absence de seed.
- Appliquer suggestion IA après complétion, vérifier renommage et DB.
- Redémarrer l’API et vérifier resynchronisation des téléchargements actifs.

### 17.13 Scripts NPM
Tâches:
- Ajouter scripts pratiques.

Exemples à proposer:
```json
{
  "scripts": {
    "dev:api": "nest start --watch",
    "dev:web": "vite",
    "dev": "concurrently \"npm:dev:api\" \"npm:dev:web\"",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio"
  }
}
```

### 17.14 Sécurisation minimale
Tâches:
- Ajouter auth Bearer simple sur endpoints sensibles.
- CORS restreint à l’origin du frontend.

### 17.15 Livraison
Tâches:
- Préparer `.env.example` et README minimal.
- Option: générer `docker-compose.yml` (api + aria2 + frontend) pour dev.

### 17.16 Stratégie de reprise/erreurs pour l’agent
- En cas d’échec de commande, afficher la sortie, proposer une alternative ou correction, puis reproposer la commande.
- Toujours re-vérifier les checkpoints avant de poursuivre.



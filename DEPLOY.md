# Déploiement sur Scaleway

Guide pour la première installation sur un serveur Ubuntu Scaleway, et pour les mises à jour
suivantes. Tout tourne via Docker Compose (voir `docker-compose.yml`) : PostgreSQL, l'API, et le
frontend servi par Nginx.

## 1. Première installation

Connecte-toi en SSH à ton serveur :

```bash
ssh root@163.172.9.251
```

### Installer Docker

```bash
curl -fsSL https://get.docker.com | sh
```

Vérifie :
```bash
docker --version
docker compose version
```

### Récupérer le code

Le dépôt GitHub est **privé** — il faut un accès. Le plus simple : un token d'accès personnel
GitHub (Settings → Developer settings → Personal access tokens → Fine-grained, lecture seule sur
`hmalherbe/spelc-carriere`).

```bash
cd /opt
git clone https://<ton-token>@github.com/hmalherbe/spelc-carriere.git
cd spelc-carriere
```

⚠️ Le token reste alors dans `.git/config` en clair sur le serveur — acceptable pour un accès en
lecture seule sur un serveur que tu contrôles, mais ne le partage pas.

### Configurer les secrets

```bash
cp .env.example .env
nano .env    # remplis POSTGRES_PASSWORD, JWT_SECRET, ADMIN_EMAIL/ADMIN_PASSWORD au minimum
```

Génère des valeurs fortes plutôt que de les inventer :
```bash
openssl rand -base64 24   # pour POSTGRES_PASSWORD
openssl rand -base64 48   # pour JWT_SECRET
```

`ADMIN_EMAIL`/`ADMIN_PASSWORD` créent le premier compte admin utilisable — choisis un mot de passe
fort, ce n'est pas un compte de démo. Laisse les blocs Brevo/ADEL vides pour l'instant si tu veux
les activer plus tard (voir `README.md`).

### Lancer

```bash
docker compose up -d --build
```

La première fois, ça prend plusieurs minutes (build de l'image API avec Chromium pour le scraper
ADEL). Suis les logs :
```bash
docker compose logs -f
```

Une fois stabilisé, l'appli est accessible sur `http://163.172.9.251`.

### Vérifier

```bash
docker compose ps          # les 3 services doivent être "Up"
curl http://localhost/api/health
```

## 2. Mettre à jour après un nouveau commit

```bash
cd /opt/spelc-carriere
git pull
docker compose up -d --build
```

Les migrations de base de données s'appliquent automatiquement au démarrage du conteneur `api`
(`prisma migrate deploy`) — pas d'étape manuelle.

## 3. Pare-feu Scaleway

Dans la console Scaleway, le "Security Group" de l'instance doit autoriser le port **80** (HTTP)
en entrée, en plus du port 22 (SSH) déjà nécessaire pour s'y connecter.

## 4. Prochaines étapes (pas encore faites)

- **HTTPS** : nécessite un nom de domaine pointant vers `163.172.9.251` (le certificat Let's
  Encrypt ne peut pas se délivrer pour une IP nue). Une fois un domaine en place, on ajoute
  `certbot` + un nouveau `server` block Nginx pour le port 443.
- **Sauvegardes** : la base vit dans le volume Docker `spelc-carriere_db_data` — à sauvegarder
  régulièrement (`docker compose exec db pg_dump -U spelc spelc > backup.sql`), rien d'automatisé
  pour l'instant.
- **Déploiement automatique** : aujourd'hui c'est `git pull` + `docker compose up -d --build` à la
  main sur le serveur ; une Action GitHub pourrait le faire automatiquement à chaque push sur
  `main`, si utile.

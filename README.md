# AlfyChat — Service Amis

Microservice de gestion des relations sociales pour AlfyChat.

![Go](https://img.shields.io/badge/Go-1.26-00ADD8?logo=go)
![License](https://img.shields.io/badge/License-Source_Available-blue)

## Rôle

Ce service gère les demandes d'amis, les listes d'amis, le blocage d'utilisateurs et la vérification du statut de relation entre utilisateurs.

## Stack technique

| Catégorie | Technologies |
|-----------|-------------|
| Langage | Go 1.26 |
| API | net/http (stdlib) |
| Auth | JWT HS256 (golang-jwt) |
| Base de données | MySQL 8 |

## Architecture globale

```
Frontend (:4000)  →  Gateway (:3000)  →  Microservices
                                          ├── users    (:3001)
                                          ├── messages  (:3002)
                                          ├── friends   (:3003)  ← ce service
                                          ├── calls     (:3004)
                                          ├── servers   (:3005)
                                          ├── bots      (:3006)
                                          └── media     (:3007)
```

## Démarrage

### Prérequis

- [Go](https://go.dev/) ≥ 1.26
- MySQL 8

### Variables d'environnement

```env
PORT=3003
DB_HOST=localhost
DB_PORT=3306
DB_USER=alfychat
DB_PASSWORD=
DB_NAME=alfychat
JWT_SECRET=
INTERNAL_SECRET=
GATEWAY_URL=http://localhost:3000
SERVICE_KEY=
SERVICE_ENDPOINT=http://localhost:3003
```

### Développement

```bash
go run .
```

### Build production

```bash
go build -o bin/friends .
./bin/friends
```

### Tests

```bash
go test ./...
```

### Docker

```bash
docker compose up friends
```

## Structure du projet

```
main.go                  # Point d'entrée
internal/
├── friends/             # Routes amis, demandes, blocage, amis en commun
└── platform/            # Socle commun aux services Go : HTTP (CORS, helmet,
                         # erreurs négociées), auth, MySQL, enregistrement
                         # auprès du gateway, remontée d'erreurs
public/                  # Pages HTML d'accueil et d'erreur
```

## Contribution

Voir [CONTRIBUTING.md](./CONTRIBUTING.md).

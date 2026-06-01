#  Melody Server

REST API backend for the Melody music streaming application, built with **Node.js**, **Express**, and **PostgreSQL**.

## Tech Stack

- **Framework:** Express.js
- **Database:** PostgreSQL (pg)
- **Authentication:** JWT + bcryptjs
- **File Storage:** Backblaze B2 (via AWS SDK)
- **File Uploads:** Multer

## Project Structure

```
server/
├── src/
│   ├── config/         # Database connection & schema
│   ├── controllers/    # Route handlers
│   │   ├── authController.js
│   │   ├── tracksController.js
│   │   ├── artistsController.js
│   │   ├── albumsController.js
│   │   ├── playlistsController.js
│   │   ├── likesController.js
│   │   └── historyController.js
│   ├── middleware/      # Auth middleware
│   ├── routes/          # API route definitions
│   ├── utils/           # Storage utilities (B2)
│   └── index.js         # Server entry point
├── uploads/             # Temporary file uploads
├── .env.example         # Environment variable template
└── package.json
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (≥ 18)
- [PostgreSQL](https://www.postgresql.org/download/) (≥ 14)
- A [Backblaze B2](https://www.backblaze.com/b2/cloud-storage.html) bucket for media storage

### Setup

```bash
# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your credentials

# Start development server (with hot-reload)
npm run dev

# Or start production server
npm start
```

The API will be available at `http://localhost:3000`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Register a new user |
| `POST` | `/api/auth/login` | Login & receive JWT |
| `GET` | `/api/tracks` | List tracks |
| `GET` | `/api/artists` | List artists |
| `GET` | `/api/albums` | List albums |
| `GET` | `/api/playlists` | Get user playlists |
| `POST` | `/api/playlists` | Create a playlist |
| `GET` | `/api/likes` | Get liked songs |
| `POST` | `/api/likes` | Like a song |
| `GET` | `/api/history` | Get listening history |
| `POST` | `/api/history` | Log a play |

## Environment Variables

See [`.env.example`](.env.example) for all required variables:

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `DB_HOST` | PostgreSQL host |
| `DB_PORT` | PostgreSQL port |
| `DB_NAME` | Database name |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |
| `JWT_SECRET` | Secret key for JWT signing |
| `B2_ACCOUNT_ID` | Backblaze B2 account ID |
| `B2_APPLICATION_KEY` | Backblaze B2 app key |
| `B2_BUCKET_NAME` | B2 bucket name |
| `B2_BUCKET_ID` | B2 bucket ID |

## License

This project is private and not licensed for redistribution.

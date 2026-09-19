# WordMine

WordMine is a real-time multiplayer word game. Everyone receives the same base word and has two minutes to find as many valid derivative words as possible. Shared words cancel out; words found by only one player score one point.

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in two or more browser windows, choose a different username in each, choose 1, 3, 5, 7, or 10 rounds, and start the game. All state is held in server memory and disappears when the server stops.

For development with automatic server restarts:

```bash
npm run dev
```

## Deploy with Firebase and Cloud Run

Socket.io needs a long-running Node.js process, so the multiplayer server runs on Cloud Run. Firebase Hosting serves the browser files and proxies Socket.io requests to the Cloud Run service.

Install and authenticate the CLIs once:

```bash
npm install -g firebase-tools
gcloud auth login
firebase login
```

Create or select a Firebase project, then configure the Google Cloud project:

```bash
firebase use --add
gcloud config set project YOUR_FIREBASE_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

Deploy the Socket.io server. The service name and region must match `firebase.json`:

```bash
gcloud run deploy wordmine \
	--source . \
	--region us-central1 \
	--allow-unauthenticated
```

Deploy the frontend and Hosting rewrite:

```bash
firebase deploy --only hosting
```

Firebase will print the public Hosting URL, usually `https://YOUR_FIREBASE_PROJECT_ID.web.app`. Open that URL and test with two browser windows.

If the Hosting rewrite is unavailable in your Firebase setup, copy the Cloud Run URL from the `gcloud run deploy` output into `public/config.js`, then deploy Hosting again:

```js
window.WORDMINE_SOCKET_URL = 'https://YOUR_CLOUD_RUN_URL';
```

For a separate Hosting domain, configure Cloud Run to allow that browser origin:

```bash
gcloud run services update wordmine \
	--region us-central1 \
	--update-env-vars CLIENT_ORIGIN=https://YOUR_FIREBASE_PROJECT_ID.web.app
```

The game state remains in Cloud Run memory. Restarting or scaling the service to a new instance clears the lobby and active game, so this deployment is appropriate for a lightweight single-room game rather than durable production matchmaking.

## Deploy on Render

Render can run the Node.js server and serve the frontend from the same URL, which keeps Socket.io on the same origin.

1. Push this project to a GitHub or GitLab repository.
2. Open [render.com](https://render.com), sign in, and choose **New +** then **Blueprint**.
3. Select the repository containing this project. Render will detect `render.yaml`.
4. Choose the free plan and create the web service.

The Blueprint uses:

- Build command: `npm ci`
- Start command: `npm start`
- Health check: `/`
- Service type: Node.js web service

Render will provide a URL similar to `https://wordmine.onrender.com`. Open that URL in two browser windows to test multiplayer play.

You can also create a Render **Web Service** manually with the same build and start commands. No database or environment variables are required. The free plan may sleep after inactivity, and because game state is in memory, a restart clears the lobby and active game.

## Project structure

- `server.js` owns the lobby, round timer, dictionary validation, submissions, scoring, and Socket.io events.
- `public/index.html` contains the game screens.
- `public/styles.css` contains the responsive visual design.
- `public/app.js` renders server events and sends join/start/submit actions.

The server uses the local `word-list` package. A submitted word must be at least three letters, exist in that dictionary, not equal the base word, and fit within the base word's letter frequencies.
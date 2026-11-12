# Heroku Backend Node.js

Backend Express for **Adedonha / STOP**, schedules, expenses and GitHub SVG summaries. This is the API application; the web frontend is maintained in `heroku-frontend-nodejs`.

## Requirements

- [Node.js 24](https://nodejs.org/en/download)
- [Git](https://git-scm.com/downloads)
- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) for deployment
- [Firebase CLI](https://firebase.google.com/docs/cli) for optional Firebase operations

## Desktop Command Hub (Windows)

Extract the patch into the backend repository and run once:

```cmd
apply-command-hub.cmd
```

Open the graphical control panel:

```cmd
npm run hub
```

Or double-click `open-command-hub.cmd`. The window provides **Start**, **Development**, **Stop**, install, tests, build, Git status, Heroku/Firebase login, health checks and a guided GitHub + Heroku deployment. Commands display output on the right and steps at the bottom. **Stop** ends only the server started from this window. The default port is **3002**; the panel warns when it is already occupied.

## Local development

```cmd
npm install
npm run dev
```

- Health: http://localhost:3002/api/v1/adedonha/health
- Rules: http://localhost:3002/api/v1/adedonha/rules
- Categories: http://localhost:3002/api/v1/adedonha/categories?locale=pt
- Letters: http://localhost:3002/api/v1/adedonha/letters?locale=pt

Use `npm start` to run without reload. `PORT` overrides the local port. Run `npm test`, `npm run build` and `npm run lint` to validate. Use `npm run debug` for the Node inspector. The project requires no compilation for deployment; its build runs JavaScript syntax checks.

## Deployment

The existing Heroku application is **`heroku-backend-nodejs`**. The GUI's **Publish all** executes tests, build, Git commit, GitHub push and Heroku push in sequence, stopping on failures. It asks for a commit message and explicit confirmation. From the terminal:

```cmd
npm run heroku:login
npm run heroku:link
npm run deploy -- "chore: update backend"
```

Useful actions: `npm run deploy:github -- "message"`, `npm run deploy:heroku`, `npm run heroku:logs`, `npm run health:prod`, `npm run status`, `npm run help`.

Production health: https://heroku-backend-nodejs.herokuapp.com/api/v1/adedonha/health (or set `BACKEND_PROD_URL` if a custom domain is configured).

## Firebase and configuration

`npm run firebase:login` authenticates Firebase CLI; `npm run firebase:status` lists CLI accounts. **CLI login does not configure Firebase Admin credentials** for the running API. Keep service-account credentials outside Git and set the existing `ADEDONHA_FIREBASE_PROJECT_ID`, `ADEDONHA_FIREBASE_CLIENT_EMAIL`, and `ADEDONHA_FIREBASE_PRIVATE_KEY` via environment variables or Heroku config vars. The Adedonha Firebase project is `adedonha-stop`; other integrations use separate variables and must not be overwritten.

Review [Firebase CLI docs](https://firebase.google.com/docs/cli) and [Heroku config vars](https://devcenter.heroku.com/articles/config-vars). Never commit `.env`, service-account JSON files, tokens or private keys. See `docs/ADEDONHA_BACKEND_HANDOFF_PT.md`, `docs/ADEDONHA_VALIDATION.md` and `firebase/README.md` for the existing API contract and Firebase rules.

## Other services

- Expenses: `/api/v1/expenses`
- Schedules: `/api/v1/schedule`
- GitHub summary: `/api/v1/summary-svg?user=oliota`
- Adedonha multiplayer: `/api/v1/adedonha`

The server uses `Procfile` (`web: node index.js`) and supports the port assigned by Heroku.

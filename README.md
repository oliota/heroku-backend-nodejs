# Heroku Backend Node.js

Simple RESTful API for managing expenses, built with Node.js and Express. It supports full CRUD operations in memory.

---

## 🚀 Run Locally

```bash
npm install
npm run dev
```

Open in browser or tools like Postman:  
[http://localhost:3000/api/v1/expenses](http://localhost:3000/api/v1/expenses)

---

## ☁️ Deploy to Heroku

Make sure you're logged in to the Heroku CLI and the Heroku remote is set:

```bash
heroku login
heroku create heroku-backend-nodejs --stack heroku-22
```

### Deploy to Heroku

```bash
npm run heroku:push
```

### Open the deployed app

```bash
npm run heroku:open
```

---

## 🌐 API Endpoints

| Method | Endpoint               | Description          |
|--------|------------------------|----------------------|
| POST   | /api/v1/expenses       | Create expense       |
| GET    | /api/v1/expenses       | List all expenses    |
| GET    | /api/v1/expenses/:id   | Get expense by ID    |
| PUT    | /api/v1/expenses/:id   | Update expense by ID |
| DELETE | /api/v1/expenses/:id   | Delete expense by ID |
| DELETE | /api/v1/expenses       | Delete all expenses  |

---

## 🛠️ NPM Scripts

| Script               | Description                          |
|----------------------|--------------------------------------|
| `npm run dev`        | Run the API locally on port 3000     |
| `npm run heroku:push`| Push to Heroku remote                |
| `npm run heroku:open`| Open app in browser via Heroku CLI  |

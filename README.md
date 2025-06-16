# Heroku Backend Node.js

Simple RESTful API for managing expenses, built with Node.js and Express. It supports full CRUD operations in memory.

---

## 🚀 Run Locally

```bash
npm install
npm run dev
```

Then open in the browser or an API tool like Postman:  
[http://localhost:3000/api/v1/expenses](http://localhost:3000/api/v1/expenses)

or

[My example deployed](https://heroku-backend-nodejs-fd16668acdd6.herokuapp.com/api/v1/expenses)

---

## ☁️ Deploy to Heroku

Make sure you're logged into the Heroku CLI:

```bash
heroku login
```

Create the Heroku app (only once):

```bash
heroku create heroku-backend-nodejs --stack heroku-22
```

If your local Git branch is not named `main`, you can push using:

```bash
git push heroku master:main
```

Or update the script in `package.json` to:

```json
"heroku:push": "git push heroku master:main"
```


---

## 🌍 Live Deployment

Once deployed, access your backend at:

[https://heroku-backend-nodejs-XXXX.herokuapp.com/api/v1/expenses](https://heroku-backend-nodejs-XXXX.herokuapp.com/api/v1/expenses)

Replace the domain above with your real Heroku-generated URL.

or

[My example deployed](https://heroku-backend-nodejs-fd16668acdd6.herokuapp.com/api/v1/expenses)


or

execute in terminal
```bash

heroku open

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
| `npm run heroku:push`| Push current branch to Heroku's main |
| `npm run heroku:open`| Open the deployed app in browser     |

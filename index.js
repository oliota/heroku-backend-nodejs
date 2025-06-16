import express from 'express'
import { v4 as uuid } from 'uuid'

const app = express()

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  next()
})

app.use(express.json())

let expenses = []

app.post('/api/v1/expenses', (req, res) => {
  console.log('BODY RECEIVED:', req.body)

  const { title, amount } = req.body

  if (typeof title !== 'string' || isNaN(amount)) {
    return res.status(400).json({ error: 'Invalid input: title must be a string and amount must be a number' })
  }

  const parsedAmount = parseFloat(parseFloat(amount).toFixed(2))
  const newExpense = { id: uuid(), title, amount: parsedAmount }

  expenses.push(newExpense)
  res.status(201).json(newExpense)
})


app.get('/api/v1/expenses', (req, res) => {
  res.json(expenses)
})

app.get('/api/v1/expenses/:id', (req, res) => {
  const expense = expenses.find(e => e.id === req.params.id)
  if (!expense) return res.sendStatus(404)
  res.json(expense)
})

app.put('/api/v1/expenses/:id', (req, res) => {
  const { title, amount } = req.body

  if (typeof title !== 'string' || isNaN(amount)) {
    return res.status(400).json({ error: 'Invalid input: title must be a string and amount must be a number' })
  }

  const index = expenses.findIndex(e => e.id === req.params.id)
  if (index === -1) return res.sendStatus(404)

  const updated = {
    ...expenses[index],
    title,
    amount: parseFloat(parseFloat(amount).toFixed(2))
  }

  expenses[index] = updated
  res.json(updated)
})

app.delete('/api/v1/expenses/:id', (req, res) => {
  const exists = expenses.some(e => e.id === req.params.id)
  if (!exists) return res.sendStatus(404)

  expenses = expenses.filter(e => e.id !== req.params.id)
  res.sendStatus(204)
})

app.delete('/api/v1/expenses', (req, res) => {
  expenses = []
  res.sendStatus(204)
})

app.listen(process.env.PORT || 3000)

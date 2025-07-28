import express from 'express'
import { v4 as uuid } from 'uuid'
import fetch from 'node-fetch'
import dotenv from 'dotenv'
dotenv.config()

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


 
 app.use(express.json())
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  next()
})


app.get('/api/v1/summary-svg', async (req, res) => {
  const username = req.query.user
  if (!username) return res.status(400).send('Missing ?user=username')

  const token = process.env.GITHUB_TOKEN
  if (!token) return res.status(500).send('Missing GitHub token')

  const body = {
    query: `{
      user(login: "${username}") {
        name
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
          totalCommitContributions
          restrictedContributionsCount
          totalRepositoriesWithContributedCommits
        }
        pullRequests { totalCount }
        issues { totalCount }
        repositories(first: 100, isFork: false, ownerAffiliations: OWNER) {
          nodes {
            stargazerCount
            primaryLanguage { name }
          }
        }
      }
    }`
  }

  const resp = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!resp.ok) return res.status(502).send('GitHub API failed')
  const data = await resp.json()
  const user = data.data.user
  const name = user.name || username
  const calendar = user.contributionsCollection.contributionCalendar
  const contributions = calendar.totalContributions
  const commits = user.contributionsCollection.totalCommitContributions
  const contributedTo = user.contributionsCollection.totalRepositoriesWithContributedCommits
  const pullRequests = user.pullRequests.totalCount
  const issues = user.issues.totalCount
  const stars = user.repositories.nodes.reduce((acc, r) => acc + r.stargazerCount, 0)

  const days = calendar.weeks.flatMap(week => week.contributionDays.map(day => ({
    date: day.date,
    count: day.contributionCount
  })))

  const { maxStreak, longestStart, longestEnd } = calculateStreakStats(days)
  const { topLangsSvg } = calculateLanguages(user.repositories.nodes)
  const { rank, rankColor, score } = calculateScoreAndRank({
    contributions,
    stars,
    pullRequests,
    issues,
    maxStreak
  })

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="580">
  <rect x="1" y="1" width="1098" height="458" rx="16" ry="16" fill="white" stroke="#ccc" stroke-width="2"/>
  <text x="550" y="40" font-size="20" text-anchor="middle" font-weight="bold" fill="#003366">${name} – GitHub Summary</text>
  <line x1="10" y1="60" x2="1090" y2="60" stroke="#ccc" stroke-width="1"/>

  <g font-size="15" font-weight="bold" fill="#003366">
    <text x="45" y="90">Contributions</text>
    <text x="45" y="140" fill="green">Total:</text>
    <text x="180" y="140" fill="black">${contributions}</text>
    <text x="45" y="170" fill="green">Longest Streak:</text>
    <text x="180" y="170" fill="black">${maxStreak} days</text>
    <line x1="40" y1="190" x2="400" y2="190" stroke="#ccc" stroke-width="1"/>
    <text x="45" y="210">Stats</text>
    <text x="45" y="240" fill="green">Stars:</text>
    <text x="180" y="240" fill="black">${stars}</text>
    <text x="45" y="270" fill="green">Commits in ${new Date().getFullYear()}:</text>
    <text x="180" y="270" fill="black">${commits}</text>
    <text x="45" y="300" fill="green">PRs:</text>
    <text x="180" y="300" fill="black">${pullRequests}</text>
    <text x="45" y="330" fill="green">Issues:</text>
    <text x="180" y="330" fill="black">${issues}</text>
    <text x="45" y="360" fill="green">Contributed to:</text>
    <text x="180" y="360" fill="black">${contributedTo}</text>
  </g>

  <g font-weight="bold" font-size="15" fill="#003366">
    <text x="780" y="90">Top Languages</text>
    ${topLangsSvg}
  </g>

  <circle cx="550" cy="160" r="60" stroke="darkgreen" stroke-width="6" fill="none"/>
  <circle cx="550" cy="95" r="20" fill="white"/>
  <text x="535" y="100" font-size="22">🔥</text>
  <text x="550" y="120" fill="green" text-anchor="middle" font-size="22" font-weight="bold">${maxStreak}</text>
  <text x="550" y="135" fill="#003366" text-anchor="middle" font-size="15" font-weight="bold">Days streak</text>
<text x="550" y="160" fill="black" text-anchor="middle" font-size="15">${formatDateBr(longestStart)}</text>
<text x="550" y="170" fill="black" text-anchor="middle" font-size="15" font-weight="bold">...</text>
<text x="550" y="190" fill="black" text-anchor="middle" font-size="15">${formatDateBr(longestEnd)}</text>


  <circle cx="550" cy="325" r="60" stroke="${rankColor}" stroke-width="6" fill="none"/>
  <circle cx="550" cy="265" r="20" fill="white"/>
  <text x="535" y="270" font-size="22">🔝</text>
  <text x="550" y="320" fill="${rankColor}" text-anchor="middle" font-size="22" font-weight="bold">${rank}</text>
  <text x="550" y="345" fill="#003366" text-anchor="middle" font-size="15" font-weight="bold">Overall Rank</text>
</svg>`

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
  res.send(svg)
})

function calculateStreakStats(days) {
  let maxStreak = 0, currentStreak = 0
  let longestStart = '', longestEnd = '', tempStart = null

  for (let i = 0; i < days.length; i++) {
    const date = new Date(days[i].date)
    const prevDate = i > 0 ? new Date(days[i - 1].date) : null
    const diff = prevDate ? (date - prevDate) / (1000 * 60 * 60 * 24) : null

    if (days[i].count > 0) {
      if (currentStreak === 0 || diff !== 1) tempStart = days[i].date
      currentStreak = (diff === 1 || currentStreak === 0) ? currentStreak + 1 : 1
    } else {
      currentStreak = 0
      continue
    }

    if (currentStreak > maxStreak) {
      maxStreak = currentStreak
      longestStart = tempStart
      longestEnd = days[i].date
    }
  }

  return { maxStreak, longestStart, longestEnd }
}

function calculateLanguages(repositories) {
  const colors = {
    JavaScript: 'gold', Python: 'skyblue', CSS: 'rebeccapurple',
    HTML: 'orangered', Java: 'saddlebrown', SCSS: 'hotpink',
    TypeScript: 'deepskyblue', Shell: 'gray', Go: 'turquoise', Ruby: 'crimson'
  }
  const counts = {}
  for (const r of repositories) {
    const lang = r.primaryLanguage?.name
    if (lang) counts[lang] = (counts[lang] || 0) + 1
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)

  const barX = 880, barY = 120, barH = 10, gap = 25
  const topLangsSvg = sorted.map(([lang, count], i) => {
    const pct = ((count / total) * 100).toFixed(1)
    const width = Math.round((pct / 100) * 100)
    const y = barY + i * gap
    const color = colors[lang] || 'black'
    return `
      <text x="780" y="${y}" fill="${color}">${lang}</text>
      <rect x="${barX}" y="${y - barH}" width="0" height="${barH}" fill="${color}">
        <animate attributeName="width" from="0" to="${width}" dur="1s" fill="freeze" />
      </rect>
      <text x="1000" y="${y - 1}" fill="black">${pct}%</text>
    `
  }).join('\n')

  return { topLangsSvg }
}

function calculateScoreAndRank({ contributions, stars, pullRequests, issues, maxStreak }) {
  const score = contributions * 0.01 + stars * 0.05 + pullRequests * 0.3 + issues * 0.2 + maxStreak * 0.2
  const [rank, rankColor] =
    score > 18 ? ['S', 'gold'] :
    score > 15 ? ['A+', 'limegreen'] :
    score > 12 ? ['A', 'green'] :
    score > 9 ? ['B', 'orange'] :
    score > 5 ? ['C', 'orangered'] : ['D', 'gray']

  return { score, rank, rankColor }
}

function formatDateBr(isoDate) {
  const d = new Date(isoDate)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

  


app.listen(process.env.PORT || 3002, () => {
  console.log('Server is running on port', process.env.PORT || 3002)
})

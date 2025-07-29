import express from "express";
import { v4 as uuid } from "uuid";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.use(express.json());

let expenses = [];

app.post("/api/v1/expenses", (req, res) => {
  console.log("BODY RECEIVED:", req.body);

  const { title, amount } = req.body;

  if (typeof title !== "string" || isNaN(amount)) {
    return res
      .status(400)
      .json({
        error:
          "Invalid input: title must be a string and amount must be a number",
      });
  }

  const parsedAmount = parseFloat(parseFloat(amount).toFixed(2));
  const newExpense = { id: uuid(), title, amount: parsedAmount };

  expenses.push(newExpense);
  res.status(201).json(newExpense);
});

app.get("/api/v1/expenses", (req, res) => {
  res.json(expenses);
});

app.get("/api/v1/expenses/:id", (req, res) => {
  const expense = expenses.find((e) => e.id === req.params.id);
  if (!expense) return res.sendStatus(404);
  res.json(expense);
});

app.put("/api/v1/expenses/:id", (req, res) => {
  const { title, amount } = req.body;

  if (typeof title !== "string" || isNaN(amount)) {
    return res
      .status(400)
      .json({
        error:
          "Invalid input: title must be a string and amount must be a number",
      });
  }

  const index = expenses.findIndex((e) => e.id === req.params.id);
  if (index === -1) return res.sendStatus(404);

  const updated = {
    ...expenses[index],
    title,
    amount: parseFloat(parseFloat(amount).toFixed(2)),
  };

  expenses[index] = updated;
  res.json(updated);
});

app.delete("/api/v1/expenses/:id", (req, res) => {
  const exists = expenses.some((e) => e.id === req.params.id);
  if (!exists) return res.sendStatus(404);

  expenses = expenses.filter((e) => e.id !== req.params.id);
  res.sendStatus(204);
});

app.delete("/api/v1/expenses", (req, res) => {
  expenses = [];
  res.sendStatus(204);
});

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

import {
  calculateStreakStats,
  calculateLanguages,
  calculateScoreAndRank,
  getStreakColor,
  formatDateBr,
} from "./summaryUtils.js";

app.get("/api/v1/summary-svg", async (req, res) => {
  const username = req.query.user;
  if (!username) return res.status(400).send("Missing ?user=username");

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).send("Missing GitHub token");

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
    }`,
  };

  const resp = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) return res.status(502).send("GitHub API failed");
  const data = await resp.json();
  const user = data.data.user;
  const name = user.name || username;
  const calendar = user.contributionsCollection.contributionCalendar;
  const contributions = calendar.totalContributions;
  const commits = user.contributionsCollection.totalCommitContributions;
  const contributedTo =
    user.contributionsCollection.totalRepositoriesWithContributedCommits;
  const pullRequests = user.pullRequests.totalCount;
  const issues = user.issues.totalCount;
  const stars = user.repositories.nodes.reduce(
    (acc, r) => acc + r.stargazerCount,
    0
  );

  const days = calendar.weeks.flatMap((week) =>
    week.contributionDays.map((day) => ({
      date: day.date,
      count: day.contributionCount,
    }))
  );

  const { maxStreak, longestStart, longestEnd } = calculateStreakStats(days);
  const { topLangsSvg } = calculateLanguages(user.repositories.nodes);
  const { rank, rankColor, rankBackgroundColor, rankDashoffset } =
    calculateScoreAndRank({
      contributions,
      stars,
      pullRequests,
      issues,
      maxStreak,
    });
  const { streakColor, streakBackgroundColor, streakDashoffset } =
    getStreakColor(maxStreak);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="580">
  <style>
    .rank-text {
      font: 800 24px 'Segoe UI', Ubuntu, Sans-Serif;
      fill: #273849;
      animation: scaleInAnimation 0.3s ease-in-out forwards;
    }


    .streak-circle {
      stroke-dasharray: 360;
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
      opacity: 0.8;
      transform: rotate(-90deg);
      transform-origin: center;
      animation: streakAnimation 1s forwards ease-in-out;
    }
      
    .streak-circle-rim {
      stroke: ${streakBackgroundColor};
      fill: none;
      stroke-width: 12;
      opacity: 0.2;
    } 
    
    @keyframes streakAnimation {
      from { stroke-dashoffset: 360; }
      to { stroke-dashoffset:  ${streakDashoffset}; }
    }
      



    .rank-circle {
      stroke-dasharray: 360;
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
      opacity: 0.8;
      transform: rotate(-90deg);
      transform-origin: center;
      animation: rankAnimation 1s forwards ease-in-out;
    }
      .rank-circle-rim {
      stroke: ${rankBackgroundColor};
      fill: none;
      stroke-width: 12;
      opacity: 0.2;
    }

    @keyframes rankAnimation {
      from { stroke-dashoffset: 360; }
      to { stroke-dashoffset:  ${rankDashoffset}; }
    }


    @keyframes scaleInAnimation {
      from { transform: scale(0); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
  </style>

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

  <g transform="translate(0, 0)">
    <circle class="streak-circle-rim" cx="550" cy="160" r="60"/>
    <circle class="streak-circle" cx="680" cy="290" r="60" stroke="${streakColor}"/>
    <circle cx="550" cy="95" r="20" fill="white"/>
    <text x="535" y="100" font-size="22">🔥</text>
    <text x="550" y="120" class="rank-text" text-anchor="middle">${maxStreak}</text>
    <text x="550" y="135" fill="#003366" text-anchor="middle" font-size="15" font-weight="bold">Days streak</text>
    <text x="550" y="160" fill="black" text-anchor="middle" font-size="15">${formatDateBr(
      longestStart
    )}</text>
    <text x="550" y="170" fill="black" text-anchor="middle" font-size="15" font-weight="bold">...</text>
    <text x="550" y="190" fill="black" text-anchor="middle" font-size="15">${formatDateBr(
      longestEnd
    )}</text>
  </g>

  <g transform="translate(0, 165)">
    <circle class="rank-circle-rim" cx="550" cy="160" r="60"  />
    <circle class="rank-circle" cx="680" cy="290" r="60" stroke="${rankColor}"/>
    <circle cx="550" cy="95" r="20" fill="white"/>
    <text x="535" y="100" font-size="22">🔝</text>
    <text x="550" y="140" class="rank-text" text-anchor="middle">${rank}</text>
    <text x="550" y="165" fill="#003366" text-anchor="middle" font-size="15" font-weight="bold">Overall Rank</text>
  </g>
</svg>`;

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.send(svg);
});

app.listen(process.env.PORT || 3002, () => {
  console.log("Server is running on port", process.env.PORT || 3002);
});

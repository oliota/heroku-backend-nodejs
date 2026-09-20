import fetch from "node-fetch";
import {
  buildSnakeSvg
} from "../utils/snakeSvgBuilder.js";

export async function snakeSummaryController(req, res) {
  const username = req.query.user;
  if (!username) return res.status(400).send("Missing ?user=username");

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).send("Missing GitHub token");

  const body = {
    query: `{
      user(login: "${username}") {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }`,
  };

  const ghRes = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!ghRes.ok) return res.status(502).send("GitHub API error");
  const json = await ghRes.json();

  const calendar = json.data.user.contributionsCollection.contributionCalendar;
  const days = calendar.weeks.flatMap(week =>
    week.contributionDays.map(day => ({
      date: day.date,
      count: day.contributionCount
    }))
  );

  const svg = buildSnakeSvg(days);

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.send(svg);
}

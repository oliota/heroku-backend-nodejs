export function calculateStreakStats(days) {
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

export function calculateLanguages(repositories) {
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
    return `<text x="780" y="${y}" fill="${color}">${lang}</text>
<rect x="${barX}" y="${y - barH}" width="0" height="${barH}" fill="${color}">
  <animate attributeName="width" from="0" to="${width}" dur="1s" fill="freeze" />
</rect>
<text x="1000" y="${y - 1}" fill="black">${pct}%</text>`
  }).join('\n')

  return { topLangsSvg }
}

export function calculateScoreAndRank({ contributions, stars, pullRequests, issues, maxStreak }) {
  const score =
    contributions * 0.01 +
    stars * 0.05 +
    pullRequests * 0.3 +
    issues * 0.2 +
    maxStreak * 0.2

  const [rank, rankColor, rankBackgroundColor, rankIcon] =
    score > 18 ? ['S',  '#ffd700', '#ffea60', '👑'] :
    score > 15 ? ['A+', '#00b894', '#66e0c1', '🍾'] :
    score > 12 ? ['A',  '#0984e3', '#5faeff', '💎'] :
    score > 9  ? ['B',  '#6c5ce7', '#a99df9', '👾'] :
    score > 5  ? ['C',  '#e84393', '#f58dba', '🧠'] :
                 ['D',  '#636e72', '#aab0b5', '🎰']

  const radius = 60
  const circumference = 2 * Math.PI * radius
  const rankPercent = Math.min(score / 20, 1)
  const rankDashoffset = +(circumference * (1 - rankPercent)).toFixed(2)
  const auraScale = +(1 + rankPercent * 0.8).toFixed(2)

  return {
    score,
    rank,
    rankColor,
    rankBackgroundColor,
    rankDashoffset,
    rankIcon,
    auraScale
  }
}


export function getStreakColor(maxStreak) {
  const dasharray = 360
  const maxReference = 366
  const streakPercent = Math.min(maxStreak / maxReference, 1)
  const streakDashoffset = +(dasharray * (1 - streakPercent)).toFixed(2)

  if (maxStreak > 365) return { streakColor: '#ffd700', streakBackgroundColor: '#ffea60', streakDashoffset }
  if (maxStreak === 365) return { streakColor: '#ffcc00', streakBackgroundColor: '#ffe066', streakDashoffset }
  if (maxStreak >= 270) return { streakColor: '#e67e22', streakBackgroundColor: '#f5a25d', streakDashoffset }
  if (maxStreak >= 180) return { streakColor: '#d63031', streakBackgroundColor: '#ed6b6c', streakDashoffset }
  if (maxStreak >= 31)  return { streakColor: '#6c5ce7', streakBackgroundColor: '#a99df9', streakDashoffset }
  if (maxStreak >= 7)   return { streakColor: '#0984e3', streakBackgroundColor: '#5faeff', streakDashoffset }
  if (maxStreak >= 5)   return { streakColor: '#55efc4', streakBackgroundColor: '#9cffe3', streakDashoffset }
  if (maxStreak >= 1)   return { streakColor: '#b2bec3', streakBackgroundColor: '#d9dee1', streakDashoffset }
  return { streakColor: '#cccccc', streakBackgroundColor: '#e8e8e8', streakDashoffset }
}





export function formatDateBr(isoDate) {
  const d = new Date(isoDate)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

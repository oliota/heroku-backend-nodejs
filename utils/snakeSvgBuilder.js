
import { format } from "date-fns"
import { pt } from "date-fns/locale"

const CELL = 12
const GAP = 4
const RADIUS = 8
const WIDTH = 920
const HEIGHT = 160

function getColor(count) {
  if (count === 0) return "#ebedf0"
  if (count < 3) return "#9be9a8"
  if (count < 6) return "#40c463"
  if (count < 10) return "#30a14e"
  return "#216e39"
}

export function buildSnakeSvg(days) {
  const byDate = new Map(days.map(d => [d.date, d.count]))
  const currentYear = new Date().getFullYear()
  const start = new Date(`${currentYear}-01-01`)
  const end = new Date(`${currentYear}-12-31`)
  const snake = []

  const monthLines = new Set()
  let x = 0
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10)
    const day = d.getDay()
    const week = Math.floor((d - start) / (1000 * 60 * 60 * 24 * 7))

    if (day === 0) x++
    const y = day * (CELL + GAP)
    const count = byDate.get(dateStr) || 0
    const color = getColor(count)

    snake.push(`<rect x="${x * (CELL + GAP)}" y="${y}" width="${CELL}" height="${CELL}" rx="2" ry="2" fill="${color}"/>`)

    if (d.getDate() === 1) {
      monthLines.add(x * (CELL + GAP))
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => {
    const label = format(new Date(currentYear, i, 1), "MMM", { locale: pt })
    const x = i * 60
    return `<text x="${x}" y="10" font-size="10" fill="#666">${label}</text>`
  })

  const verticalLines = Array.from(monthLines).map(x =>
    `<line x1="${x}" y1="0" x2="${x}" y2="110" stroke="#ccc" stroke-width="1"/>`
  )

  return `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <filter id="blurTrail">
      <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur"/>
      <feColorMatrix in="blur" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 8 -3"/>
      <feBlend in="SourceGraphic" in2="blur" mode="normal"/>
    </filter>
    <path id="snakePath" d="M0,0 ${snake.map((_, i) => `L${i * (CELL + GAP)},0`).join(" ")}" fill="none" />
  </defs>

  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff" stroke="#ccc" stroke-width="2"/>
  <g transform="translate(40, 30)">
    ${months.join("")}
    ${verticalLines.join("")}
    ${snake.join("")}
    <circle r="6" fill="#d62828" filter="url(#blurTrail)">
      <animateMotion dur="15s" repeatCount="indefinite">
        <mpath xlink:href="#snakePath" />
      </animateMotion>
    </circle>
  </g>
</svg>`
}

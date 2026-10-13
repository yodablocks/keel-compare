// Writes docs/images/matrix.svg: the five moments against the three tools, coloured by how much
// each tool does for you. Same size as a GitHub social preview (1280x640), so one image serves both.
// Usage: pnpm images. The PNG is rendered by headless Chrome for the GitHub social preview,
// which has to be uploaded by hand in Settings > General > Social preview.
import { writeFileSync } from "node:fs";

// One blue ramp, light to dark, validated as an ordinal ramp on the light surface.
const LEVELS = {
  hand: { label: "Hand-written", fill: "#86b6ef", ink: "#0b0b0b" },
  partly: { label: "Partly built in", fill: "#5598e7", ink: "#0b0b0b" },
  configured: { label: "Configured", fill: "#2a78d6", ink: "#ffffff" },
  built: { label: "Built in", fill: "#184f95", ink: "#ffffff" },
} as const;
type Level = keyof typeof LEVELS;

const TOOLS = ["keel", "LangGraph.js", "Temporal"];
// Must match the Results table in README.md.
const ROWS: [string, Level, Level, Level][] = [
  ["Bad model output: retry with a hint", "built", "hand", "hand"],
  ["Worker killed mid-step", "built", "partly", "built"],
  ["Rate limit: back off, send once", "built", "configured", "built"],
  ["Over budget: pause the run", "built", "hand", "hand"],
  ["A person approves a bigger budget", "built", "built", "built"],
];

const W = 1280, H = 640, M = 64;
const labelW = 400, gap = 10, cellH = 56, rowStep = cellH + gap, gridTop = 214;
const cellW = (W - M * 2 - labelW - gap * 2) / 3;
const font = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const parts: string[] = [];
const text = (x: number, y: number, s: string, attrs: string) => parts.push(`<text x="${x}" y="${y}" ${attrs}>${esc(s)}</text>`);

parts.push(`<rect width="${W}" height="${H}" fill="#fcfcfb"/>`);
text(M, 92, "keel-compare", `font-size="40" font-weight="700" fill="#0b0b0b"`);
text(M, 132, "One AI agent, five failures, three engines: what each one handles for you", `font-size="21" fill="#52514e"`);

TOOLS.forEach((tool, c) => {
  text(M + labelW + c * (cellW + gap) + cellW / 2, gridTop - 18, tool, `font-size="20" font-weight="600" fill="#0b0b0b" text-anchor="middle"`);
});

ROWS.forEach(([moment, ...levels], r) => {
  const y = gridTop + r * rowStep;
  text(M, y + cellH / 2 + 7, `${r + 1}. ${moment}`, `font-size="19" fill="#0b0b0b"`);
  levels.forEach((level, c) => {
    const x = M + labelW + c * (cellW + gap);
    const { label, fill, ink } = LEVELS[level];
    parts.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="4" fill="${fill}"/>`);
    text(x + cellW / 2, y + cellH / 2 + 6, label, `font-size="17" font-weight="600" fill="${ink}" text-anchor="middle"`);
  });
});

// Legend, darkest first so it reads in the same order as "how much is done for you".
let lx = M;
const ly = gridTop + ROWS.length * rowStep + 36;
for (const key of ["built", "configured", "partly", "hand"] as Level[]) {
  const { label, fill } = LEVELS[key];
  parts.push(`<rect x="${lx}" y="${ly - 13}" width="16" height="16" rx="3" fill="${fill}"/>`);
  text(lx + 24, ly, label, `font-size="16" fill="#52514e"`);
  lx += 24 + label.length * 8 + 32;
}
text(W - M, ly, "keel was built for exactly these five cases, by the author of this comparison.", `font-size="15" fill="#52514e" text-anchor="end" font-style="italic"`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${font} role="img" aria-label="Matrix of five failure moments against keel, LangGraph.js and Temporal">\n${parts.join("\n")}\n</svg>\n`;
writeFileSync(new URL("../docs/images/matrix.svg", import.meta.url), svg);
console.log("wrote docs/images/matrix.svg");

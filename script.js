/* ============================================================
   Knight & Towers
   Board data reconstructed from the source puzzle image:
   8x8 grid, tiled into 13 regions (12 pentominoes + one 2x2
   tetromino). regionGrid[row][col] gives the region id (1-13)
   for each square. row 0 = top row, col 0 = left column.
   ============================================================ */

const N = 8;

const regionGrid = [
  [1, 1, 1, 1, 1, 2, 2, 2],
  [3, 3, 3, 4, 4, 5, 5, 2],
  [3, 6, 3, 4, 4, 4, 5, 2],
  [7, 6, 6, 8, 8, 9, 5, 5],
  [7, 7, 6, 8, 8, 9, 9, 10],
  [7, 11, 6, 12, 9, 9, 13, 10],
  [7, 11, 12, 12, 12, 13, 13, 10],
  [11, 11, 11, 12, 13, 13, 10, 10],
];

// clue numbers shown printed on the original board
const clueNumbers = {
  "0,5": 37,
  "0,7": 1100,
  "2,3": 23,
  "2,5": 138,
  "3,0": 528,
  "4,1": 449,
  "4,4": 16,
  "5,5": 272,
  "5,6": 1,
  "5,1": 750,
  "5,3": 88,
  "7,0": 0,
};

const START = { r: 7, c: 0 };

const REGION_IDS = [...Array(13)].map((_, i) => i + 1);

const REGION_COLORS = {
  1: "#f6d9d3", 2: "#d8e8f7", 3: "#dcefd6", 4: "#f8ecc4",
  5: "#e5d9f2", 6: "#fbdcee", 7: "#cdeee7", 8: "#f2e0c9",
  9: "#d6e3fb", 10: "#e9f0c9", 11: "#f0d3e6", 12: "#d0ecec",
  13: "#f4dede",
};

// ------------------------------------------------------------
// State
// ------------------------------------------------------------

let phase = "play"; // 'play' | 'end' -- the game is live from the start
let placingTowers = true; // click mode: true = place/move towers, false = move knight
let towers = {};      // regionId -> "r,c"
let towerCellSet = new Set(); // "r,c" set, derived from towers

let currentPos = { ...START };
let moveNum = 1;
let score = 0n;
let visited = new Map(); // "r,c" -> { move, score (string) }
visited.set(key(START.r, START.c), { move: 0, score: "0" });
let visitedTowerCount = 0;
let history = []; // for undo: { from, to, prevScore, prevMoveNum, wasTower }

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function key(r, c) { return r + "," + c; }
function regionAt(r, c) { return regionGrid[r][c]; }
function inBounds(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }

function altitude(r, c) {
  return towerCellSet.has(key(r, c)) ? 1 : 0;
}

function isPermOf(a, b, x, y) {
  return (a === x && b === y) || (a === y && b === x);
}

// Returns { valid, type } for a candidate move, ignoring the
// "already visited" / divisibility checks (those are handled
// by the caller since they need score/visited context).
function classifyShape(fromR, fromC, toR, toC) {
  const dr = Math.abs(toR - fromR);
  const dc = Math.abs(toC - fromC);
  const fromAlt = altitude(fromR, fromC);
  const toAlt = altitude(toR, toC);

  if (isPermOf(dr, dc, 1, 2)) {
    if (fromAlt === toAlt) return { valid: true, type: "flat" };
    return { valid: false };
  }
  if (isPermOf(dr, dc, 0, 2)) {
    if (toAlt - fromAlt === 1) return { valid: true, type: "up" };
    if (toAlt - fromAlt === -1) return { valid: true, type: "down" };
    return { valid: false };
  }
  return { valid: false };
}

// Full validity check including visited + divisibility, for a
// hypothetical move number `mNum` (BigInt) from currentPos.
function evaluateMove(toR, toC) {
  if (!inBounds(toR, toC)) return null;
  if (visited.has(key(toR, toC))) return null;
  const shape = classifyShape(currentPos.r, currentPos.c, toR, toC);
  if (!shape.valid) return null;

  const n = BigInt(moveNum);
  let newScore;
  if (shape.type === "flat") {
    newScore = score + n;
  } else if (shape.type === "up") {
    newScore = score * n;
  } else { // down
    if (n === 0n) return null;
    if (score % n !== 0n) return null;
    newScore = score / n;
  }
  return { type: shape.type, n: moveNum, newScore };
}

function allValidDestinations() {
  const out = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const res = evaluateMove(r, c);
      if (res) out.push({ r, c, ...res });
    }
  }
  return out;
}

// ------------------------------------------------------------
// DOM build
// ------------------------------------------------------------

const boardEl = document.getElementById("board");
const cells = []; // cells[r][c] -> element

function buildBoard() {
  boardEl.innerHTML = "";
  for (let r = 0; r < N; r++) {
    const rowArr = [];
    for (let c = 0; c < N; c++) {
      const div = document.createElement("div");
      div.className = "cell";
      if (r === 0) div.classList.add("edge-top");
      if (c === 0) div.classList.add("edge-left");
      if (c === N - 1 || regionAt(r, c) !== regionAt(r, c + 1)) div.classList.add("edge-right");
      if (r === N - 1 || regionAt(r, c) !== regionAt(r + 1, c)) div.classList.add("edge-bottom");

      div.dataset.r = r;
      div.dataset.c = c;

      const clueVal = clueNumbers[key(r, c)];
      if (clueVal !== undefined) {
        const clueEl = document.createElement("span");
        clueEl.className = "clue";
        clueEl.textContent = clueVal;
        div.appendChild(clueEl);
      }

      div.addEventListener("click", onCellClick);
      boardEl.appendChild(div);
      rowArr.push(div);
    }
    cells.push(rowArr);
  }
}

// ------------------------------------------------------------
// Rendering
// ------------------------------------------------------------

function render() {
  renderBoard();
  renderStats();
  renderRegionTable();
  renderControls();
  renderBanner();
  renderNextMoves();
}

function renderBoard() {
  const validMoves = !placingTowers ? allValidDestinations() : [];
  const validSet = new Map(validMoves.map(m => [key(m.r, m.c), m]));

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const el = cells[r][c];
      const k = key(r, c);

      // reset dynamic bits
      el.style.background = "";
      el.classList.remove("setup-mode", "visited", "current", "valid-move", "start-cell", "unvisited-start");
      const oldMarker = el.querySelector(".tower-marker");
      if (oldMarker) oldMarker.remove();
      const oldVisit = el.querySelector(".visit-info");
      if (oldVisit) oldVisit.remove();

      if (placingTowers) {
        el.classList.add("setup-mode");
        el.style.background = REGION_COLORS[regionAt(r, c)];
      }

      if (towerCellSet.has(k)) {
        const marker = document.createElement("span");
        marker.className = "tower-marker";
        if (visited.has(k)) marker.classList.add("visited-tower");
        el.appendChild(marker);
      }

      if (r === START.r && c === START.c && !visited.has(k)) {
        el.classList.add("start-cell", "unvisited-start");
      }

      if (visited.has(k)) {
        el.classList.add("visited");
        const info = visited.get(k);
        const wrap = document.createElement("div");
        wrap.className = "visit-info";
        const mv = document.createElement("div");
        mv.className = "visit-move";
        mv.textContent = "#" + info.move;
        const sc = document.createElement("div");
        sc.className = "visit-score";
        sc.textContent = info.score;
        sc.title = info.score;
        wrap.appendChild(mv);
        wrap.appendChild(sc);
        el.appendChild(wrap);
      }

      if (r === currentPos.r && c === currentPos.c) {
        el.classList.add("current");
      }

      if (!placingTowers && phase === "play" && validSet.has(k)) {
        el.classList.add("valid-move");
      }
    }
  }
}

function renderStats() {
  document.getElementById("moveVal").textContent = moveNum;
  document.getElementById("scoreVal").textContent = score.toString();
}

function renderRegionTable() {
  const body = document.getElementById("regionTableBody");
  body.innerHTML = "";
  REGION_IDS.forEach(id => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.className = "region-name";
    const sw = document.createElement("span");
    sw.className = "region-swatch";
    sw.style.background = REGION_COLORS[id];
    nameTd.appendChild(sw);
    nameTd.appendChild(document.createTextNode("Region " + id));
    tr.appendChild(nameTd);

    const clueTd = document.createElement("td");
    const clues = Object.entries(clueNumbers)
      .filter(([k, v]) => regionAt(...k.split(",").map(Number)) === id)
      .map(([, v]) => v);
    clueTd.textContent = clues.length ? clues.join(", ") : "\u2014";
    tr.appendChild(clueTd);

    const towerTd = document.createElement("td");
    const towerKey = towers[id];
    if (towerKey) {
      const [r, c] = towerKey.split(",").map(Number);
      towerTd.textContent = `(${r + 1}, ${c + 1})` + (visited.has(towerKey) ? " \u2713" : "");
      if (visited.has(towerKey)) tr.classList.add("complete");
    } else {
      towerTd.textContent = "not placed";
    }
    tr.appendChild(towerTd);

    body.appendChild(tr);
  });
}

function renderControls() {
  const modeBtn = document.getElementById("modeBtn");
  const undoBtn = document.getElementById("undoBtn");
  const clearBtn = document.getElementById("resetTowersBtn");

  modeBtn.textContent = placingTowers ? "Switch to: Move Knight" : "Switch to: Place Towers";
  undoBtn.disabled = history.length === 0;
  clearBtn.disabled = Object.keys(towers).length === 0;
}

function renderBanner() {
  const el = document.getElementById("phaseBanner");
  el.className = "phase-banner";
  const placed = Object.keys(towers).length;

  if (phase === "end") {
    el.textContent = `\uD83C\uDFC6 All towers visited! Final score ${score.toString()} in ${moveNum-1} moves.`;
    el.classList.add("win");
    return;
  }

  const remaining = 13 - visitedTowerCount;
  el.textContent = `${placed} / 13 towers placed \u2014 ${remaining} left to visit. `;
  el.textContent += placingTowers
    ? "Click a square to place/move a tower for its region."
    : "Click a highlighted square to move the knight.";

  if (!placingTowers && allValidDestinations().length === 0 && remaining > 0) {
    el.textContent += "  No legal moves remain \u2014 try Undo, place more towers, or start a New Game.";
    el.classList.add("stuck");
  }
}

// ------------------------------------------------------------
// Interaction
// ------------------------------------------------------------

function onCellClick(e) {
  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);

  if (placingTowers) {
    handleTowerClick(r, c);
  } else {
    handlePlayClick(r, c);
  }
}

function handleTowerClick(r, c) {
  const k = key(r, c);
  const isStartBeforeAnyMove = k === key(START.r, START.c) && moveNum === 1;

  // Can't place/move a tower onto a square the knight has already
  // stood on -- except the start square, before the first move.
  if (visited.has(k) && !isStartBeforeAnyMove) return;

  const id = regionAt(r, c);
  const existingForRegion = towers[id];

  // Can't move/remove a tower that's already been visited.
  if (existingForRegion && visited.has(existingForRegion)) return;

  if (existingForRegion === k) {
    delete towers[id]; // toggle off
  } else {
    towers[id] = k;
  }
  rebuildTowerSet();
  recomputeVisitedTowerCount();
  render();
}

function rebuildTowerSet() {
  towerCellSet = new Set(Object.values(towers));
}

function recomputeVisitedTowerCount() {
  visitedTowerCount = Object.values(towers).filter(k => visited.has(k)).length;
  if (Object.keys(towers).length === 13 && visitedTowerCount === 13) {
    phase = "end";
  } else if (phase === "end") {
    phase = "play";
  }
}

function handlePlayClick(r, c) {
  const result = evaluateMove(r, c);
  if (!result) return;

  history.push({
    from: { ...currentPos },
    to: { r, c },
    prevScore: score,
    prevMoveNum: moveNum,
  });

  moveNum += 1;
  score = result.newScore;
  currentPos = { r, c };
  visited.set(key(r, c), { move: moveNum - 1, score: score.toString() });

  recomputeVisitedTowerCount();
  render();
}

function undoMove() {
  if (history.length === 0) return;
  const last = history.pop();
  visited.delete(key(last.to.r, last.to.c));
  score = last.prevScore;
  moveNum = last.prevMoveNum;
  currentPos = { ...last.from };
  recomputeVisitedTowerCount();
  render();
}

function clearTowers() {
  // Only clear towers that haven't been visited yet.
  Object.keys(towers).forEach(id => {
    if (!visited.has(towers[id])) delete towers[id];
  });
  rebuildTowerSet();
  recomputeVisitedTowerCount();
  render();
}

function newGame() {
  phase = "play";
  towers = {};
  towerCellSet = new Set();
  currentPos = { ...START };
  moveNum = 1;
  score = 0n;
  visited = new Map();
  visited.set(key(START.r, START.c), { move: 0, score: "0" });
  visitedTowerCount = 0;
  history = [];
  render();
}

function toggleMode() {
  placingTowers = !placingTowers;
  render();
}

// ------------------------------------------------------------
// "Possible Scores Ahead" — pure arithmetic look-ahead.
// Ignores board reachability/tower placement entirely: at each
// future move N, the score can go to score+N, score*N, and (if
// divisible) score/N. This lists every distinct value reachable
// after 1, 2, and 3 such moves from the current score.
// ------------------------------------------------------------

function stepScores(scoreSet, n) {
  const nBig = BigInt(n);
  const out = new Set();
  for (const s of scoreSet) {
    out.add(s + nBig);
    out.add(s * nBig);
    if (s % nBig === 0n) out.add(s / nBig);
  }
  return out;
}

function renderNextMoves() {
  const n1 = moveNum, n2 = moveNum + 1, n3 = moveNum + 2;
  const set1 = stepScores(new Set([score]), n1);
  const set2 = stepScores(set1, n2);
  const set3 = stepScores(set2, n3);

  [[n1, set1, "nmHead1", "nmList1"],
   [n2, set2, "nmHead2", "nmList2"],
   [n3, set3, "nmHead3", "nmList3"]].forEach(([n, set, headId, listId]) => {
    document.getElementById(headId).textContent = `After move ${n}`;
    const ul = document.getElementById(listId);
    ul.innerHTML = "";
    Array.from(set)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .forEach(v => {
        const li = document.createElement("li");
        li.textContent = v.toString();
        ul.appendChild(li);
      });
  });
}

// ------------------------------------------------------------
// Wire up
// ------------------------------------------------------------

document.getElementById("modeBtn").addEventListener("click", toggleMode);
document.getElementById("undoBtn").addEventListener("click", undoMove);
document.getElementById("resetTowersBtn").addEventListener("click", clearTowers);
document.getElementById("resetAllBtn").addEventListener("click", newGame);

buildBoard();
initScoreTable();
visited.set(key(START.r, START.c), { move: 0, score: "0" });
render();

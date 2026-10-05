// Animated graph-paper background
(function () {
  const canvas = document.getElementById('grid-background');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rootStyle = getComputedStyle(document.documentElement);
  const lineColor =
    rootStyle.getPropertyValue('--grid-line-color').trim() ||
    'rgba(68, 75, 84, 0.04)';
  const hatchColor =
    rootStyle.getPropertyValue('--grid-hatch-color').trim() ||
    'rgba(68, 75, 84, 0.17)';
  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  const backgroundConfig = {
    cellSize: 22,
    stepDuration: 900,
    stepInterval: 1400,
    defaultRegionPaddingCells: 0.65,
    protectedRegions: [{ selector: '.paper-links' }],
    decorationRegions: [{ selector: '.site-header' }],
    targetAreaRatio: 0.062,
    targetAreaMin: 14,
    targetAreaMax: 78,
    headerSeedTopOffsetCells: 0.5,
    headerSeedHeightRatio: 0.56,
    headerSeedHeightMaxCells: 11,
    headerSideColumnRatio: 0.42,
    headerOutsideMinColumns: 4,
    headerOutsideMoveBias: 0.55,
    headerSeedAttempts: 140,
    headerClusterMinArea: 8,
    headerClusterAreaRange: 5,
    clusterAttachChance: 0.58,
    clusterGapChance: 0.32,
    clusterScatterMinRadius: 2,
    clusterScatterRadiusRange: 4,
    clusterGrowAttemptMultiplier: 24,
    hatchSpacing: 3.2,
    moveStayScore: 0.08,
    moveBaseScore: 0.42,
    moveNeighborScore: 0.36,
    moveOpenSpaceBias: 0.3,
    moveIsolationPenalty: -0.7,
    moveRandomScore: 0.95,
  };
  const cellSize = backgroundConfig.cellSize;
  const stepDuration = backgroundConfig.stepDuration;
  const stepInterval = backgroundConfig.stepInterval;
  const directions = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  let width = 0;
  let height = 0;
  let docHeight = 0;
  let cols = 0;
  let rows = 0;
  let availableColumns = [];
  let protectedCells = new Set();
  let decorationCells = new Set();
  let blocks = [];
  let headerSeededCells = 0;
  let stepStart = 0;
  let rafId = null;
  let resizeFrameId = null;

  function key(x, y) {
    return x + ',' + y;
  }

  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  function seededNoise(seed, value) {
    const noise = Math.sin(seed * 12.9898 + value * 78.233) * 43758.5453;
    return noise - Math.floor(noise);
  }

  function pickBlockShape() {
    const shapes = [
      { w: 1, h: 1 },
      { w: 1, h: 1 },
      { w: 1, h: 1 },
      { w: 1, h: 1 },
      { w: 1, h: 1 },
      { w: 2, h: 1 },
      { w: 2, h: 1 },
      { w: 1, h: 2 },
      { w: 1, h: 2 },
      { w: 3, h: 1 },
      { w: 1, h: 3 },
      { w: 2, h: 2 },
    ];
    return shapes[Math.floor(Math.random() * shapes.length)];
  }

  function blockCells(x, y, w, h) {
    const cells = [];
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        cells.push({ x: x + dx, y: y + dy });
      }
    }
    return cells;
  }

  function blockCellKeys(block, x, y) {
    return blockCells(x, y, block.w, block.h).map((cell) =>
      key(cell.x, cell.y)
    );
  }

  function addBlockCells(target, block, x, y) {
    blockCellKeys(block, x, y).forEach((cellKey) => target.add(cellKey));
  }

  function countNeighbors(block, x, y, occupied) {
    const ownKeys = new Set(blockCellKeys(block, block.x, block.y));
    const targetKeys = new Set(blockCellKeys(block, x, y));
    const neighbors = new Set();

    targetKeys.forEach((cellKey) => {
      const parts = cellKey.split(',');
      const cellX = Number(parts[0]);
      const cellY = Number(parts[1]);

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighborKey = key(cellX + dx, cellY + dy);
          if (
            !targetKeys.has(neighborKey) &&
            !ownKeys.has(neighborKey) &&
            occupied.has(neighborKey)
          ) {
            neighbors.add(neighborKey);
          }
        }
      }
    });

    return neighbors.size;
  }

  function updateAvailableRegions() {
    availableColumns = [];
    for (let x = 1; x < cols - 1; x += 1) {
      availableColumns.push(x);
    }
  }

  function regionPadding(region) {
    const paddingCells =
      region.paddingCells ?? backgroundConfig.defaultRegionPaddingCells;
    return paddingCells * cellSize;
  }

  function cellsForRegions(regions) {
    const cells = new Set();
    regions.forEach((region) => {
      const padding = regionPadding(region);
      document.querySelectorAll(region.selector).forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const left = Math.max(0, rect.left - padding);
        const right = Math.min(width, rect.right + padding);
        const top = Math.max(0, rect.top + window.scrollY - padding);
        const bottom = Math.min(
          docHeight,
          rect.bottom + window.scrollY + padding
        );
        const startX = Math.max(1, Math.floor(left / cellSize));
        const endX = Math.min(cols - 2, Math.floor(right / cellSize));
        const startY = Math.max(1, Math.floor(top / cellSize));
        const endY = Math.min(rows - 2, Math.floor(bottom / cellSize));

        for (let y = startY; y <= endY; y += 1) {
          for (let x = startX; x <= endX; x += 1) {
            cells.add(key(x, y));
          }
        }
      });
    });
    return cells;
  }

  function updateProtectedCells() {
    protectedCells = cellsForRegions(backgroundConfig.protectedRegions);
  }

  function countAllowedCells() {
    let count = 0;
    decorationCells.forEach((cellKey) => {
      if (!protectedCells.has(cellKey)) {
        count += 1;
      }
    });
    return count;
  }

  function updateDecorationCells() {
    decorationCells = cellsForRegions(backgroundConfig.decorationRegions);
  }

  function isBlockCellAllowed(x, y) {
    return (
      x >= 1 &&
      y >= 1 &&
      x < cols - 1 &&
      y < rows - 1 &&
      decorationCells.has(key(x, y)) &&
      !protectedCells.has(key(x, y))
    );
  }

  function isBlockAllowed(x, y, w, h) {
    return blockCells(x, y, w, h).every((cell) =>
      isBlockCellAllowed(cell.x, cell.y)
    );
  }

  function headerOutsideColumns(side) {
    const hero = document.querySelector('.hero');
    if (!hero) return [];

    const rect = hero.getBoundingClientRect();
    const columns = availableColumns.filter((column) => {
      const centerX = (column + 0.5) * cellSize;
      return side === 'left' ? centerX < rect.left : centerX > rect.right;
    });

    return columns.length >= backgroundConfig.headerOutsideMinColumns
      ? columns
      : [];
  }

  function headerOutsideScore(x, w) {
    const hero = document.querySelector('.hero');
    if (!hero) return 0;

    const rect = hero.getBoundingClientRect();
    const centerX = (x + w * 0.5) * cellSize;
    if (centerX < rect.left || centerX > rect.right) {
      return backgroundConfig.headerOutsideMoveBias;
    }

    return 0;
  }

  function generateBlocks() {
    const occupied = new Set();
    const allowedCellCount = countAllowedCells();

    if (allowedCellCount === 0) {
      blocks = [];
      return;
    }

    const preferredArea = Math.min(
      backgroundConfig.targetAreaMax,
      Math.round(allowedCellCount * backgroundConfig.targetAreaRatio)
    );
    const targetArea = Math.min(
      allowedCellCount,
      Math.max(backgroundConfig.targetAreaMin, preferredArea)
    );
    blocks = [];

    function addBlock(x, y, shape, cluster) {
      if (!isBlockAllowed(x, y, shape.w, shape.h)) return null;

      const cellKeys = blockCells(x, y, shape.w, shape.h).map((cell) =>
        key(cell.x, cell.y)
      );
      if (cellKeys.some((cellKey) => occupied.has(cellKey))) return null;

      const block = {
        x,
        y,
        w: shape.w,
        h: shape.h,
        startX: x,
        startY: y,
        targetX: x,
        targetY: y,
        seed: Math.random() * 10000,
      };
      cellKeys.forEach((cellKey) => occupied.add(cellKey));
      blocks.push(block);
      cluster.push(block);
      return block;
    }

    function randomInt(min, max) {
      return min + Math.floor(Math.random() * (max - min + 1));
    }

    function clusterBounds(cluster) {
      return cluster.reduce(
        (bounds, block) => ({
          minX: Math.min(bounds.minX, block.x),
          minY: Math.min(bounds.minY, block.y),
          maxX: Math.max(bounds.maxX, block.x + block.w - 1),
          maxY: Math.max(bounds.maxY, block.y + block.h - 1),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      );
    }

    function placeNearCluster(cluster, shape) {
      if (Math.random() < backgroundConfig.clusterAttachChance) {
        const base = cluster[Math.floor(Math.random() * cluster.length)];
        const gap = Math.random() < backgroundConfig.clusterGapChance ? 1 : 0;
        const side = Math.floor(Math.random() * 4);

        if (side === 0) {
          return {
            x: base.x + base.w + gap,
            y: randomInt(base.y - shape.h + 1, base.y + base.h - 1),
          };
        }

        if (side === 1) {
          return {
            x: base.x - shape.w - gap,
            y: randomInt(base.y - shape.h + 1, base.y + base.h - 1),
          };
        }

        if (side === 2) {
          return {
            x: randomInt(base.x - shape.w + 1, base.x + base.w - 1),
            y: base.y + base.h + gap,
          };
        }

        return {
          x: randomInt(base.x - shape.w + 1, base.x + base.w - 1),
          y: base.y - shape.h - gap,
        };
      }

      const bounds = clusterBounds(cluster);
      const radius =
        backgroundConfig.clusterScatterMinRadius +
        Math.floor(Math.random() * backgroundConfig.clusterScatterRadiusRange);
      return {
        x: randomInt(bounds.minX - radius, bounds.maxX + radius),
        y: randomInt(bounds.minY - radius, bounds.maxY + radius),
      };
    }

    function growCluster(cluster, clusterAreaTarget) {
      let attempts = 0;
      let clusterArea = cluster.reduce(
        (area, block) => area + block.w * block.h,
        0
      );

      while (
        clusterArea < clusterAreaTarget &&
        occupied.size < targetArea &&
        attempts < clusterAreaTarget * backgroundConfig.clusterGrowAttemptMultiplier
      ) {
        attempts += 1;
        const shape = pickBlockShape();
        const next = placeNearCluster(cluster, shape);
        const block = addBlock(next.x, next.y, shape, cluster);
        if (block) {
          clusterArea += block.w * block.h;
        }
      }
    }

    function seedHeaderCluster(side) {
      const header = document.querySelector('.site-header');
      if (!header) return;

      const rect = header.getBoundingClientRect();
      const headerTop = Math.max(0, rect.top + window.scrollY);
      const seedTop = Math.max(
        0,
        headerTop + cellSize * backgroundConfig.headerSeedTopOffsetCells
      );
      const seedBottom = Math.min(
        docHeight,
        headerTop +
          Math.min(
            rect.height * backgroundConfig.headerSeedHeightRatio,
            cellSize * backgroundConfig.headerSeedHeightMaxCells
          )
      );
      const startY = Math.max(1, Math.floor(seedTop / cellSize));
      const endY = Math.max(
        startY,
        Math.min(rows - 2, Math.floor(seedBottom / cellSize))
      );
      const sideLimit = Math.max(
        4,
        Math.floor(cols * backgroundConfig.headerSideColumnRatio)
      );
      const sideColumns = availableColumns.filter(
        (column) =>
          side === 'left'
            ? column <= sideLimit
            : column >= cols - 1 - sideLimit
      );
      const outsideColumns = headerOutsideColumns(side);
      const cluster = [];
      let seed = null;
      let seedAttempts = 0;

      while (!seed && seedAttempts < backgroundConfig.headerSeedAttempts) {
        seedAttempts += 1;
        const shape = pickBlockShape();
        const columns = outsideColumns.length
          ? outsideColumns
          : sideColumns.length
          ? sideColumns
          : availableColumns;
        const seedX = columns[Math.floor(Math.random() * columns.length)];
        const seedY = randomInt(startY, endY);
        seed = addBlock(seedX, seedY, shape, cluster);
      }

      if (seed) {
        growCluster(
          cluster,
          backgroundConfig.headerClusterMinArea +
            Math.floor(Math.random() * backgroundConfig.headerClusterAreaRange)
        );
        headerSeededCells += cluster.reduce(
          (area, block) => area + block.w * block.h,
          0
        );
      }
    }

    seedHeaderCluster('left');
    seedHeaderCluster('right');
  }

  function updateCanvasStats() {
    const shapes = new Set(blocks.map((block) => block.w + 'x' + block.h));
    const area = blocks.reduce(
      (total, block) => total + block.w * block.h,
      0
    );

    canvas.dataset.blockCount = String(blocks.length);
    canvas.dataset.blockArea = String(area);
    canvas.dataset.blockShapes = Array.from(shapes).sort().join(',');
    canvas.dataset.protectedCells = String(protectedCells.size);
    canvas.dataset.decorationCells = String(decorationCells.size);
    canvas.dataset.headerSeededCells = String(headerSeededCells);
  }

  function chooseTargets(now) {
    const occupied = new Set();
    const reserved = new Set();
    blocks.forEach((block) => addBlockCells(occupied, block, block.x, block.y));

    shuffle(blocks.slice()).forEach((block) => {
      const ownKeys = new Set(blockCellKeys(block, block.x, block.y));
      const options = [];

      shuffle(directions.slice()).forEach((dir) => {
        const nextX = block.x + dir[0];
        const nextY = block.y + dir[1];
        const targetKeys = blockCellKeys(block, nextX, nextY);

        if (!isBlockAllowed(nextX, nextY, block.w, block.h)) return;

        if (
          targetKeys.some(
            (targetKey) =>
              reserved.has(targetKey) ||
              (occupied.has(targetKey) && !ownKeys.has(targetKey))
          )
        ) {
          return;
        }

        const neighbors = countNeighbors(block, nextX, nextY, occupied);
        const isStay = dir[0] === 0 && dir[1] === 0;
        const stayScore = isStay ? backgroundConfig.moveStayScore : 0;
        const moveScore = isStay
          ? 0
          : backgroundConfig.moveBaseScore +
            Math.min(neighbors, 3) * backgroundConfig.moveNeighborScore;
        const openSpaceBias =
          !isStay && neighbors <= 1 ? backgroundConfig.moveOpenSpaceBias : 0;
        const isolationPenalty =
          !isStay && neighbors === 0
            ? backgroundConfig.moveIsolationPenalty
            : 0;
        const outsideBias = headerOutsideScore(nextX, block.w);
        options.push({
          x: nextX,
          y: nextY,
          keys: targetKeys,
          score:
            stayScore +
            moveScore +
            openSpaceBias +
            outsideBias +
            isolationPenalty +
            Math.random() * backgroundConfig.moveRandomScore,
        });
      });

      const best = options.reduce(
        (winner, option) => (option.score > winner.score ? option : winner),
        {
          x: block.x,
          y: block.y,
          keys: blockCellKeys(block, block.x, block.y),
          score: -Infinity,
        }
      );

      block.startX = block.x;
      block.startY = block.y;
      block.targetX = best.x;
      block.targetY = best.y;
      best.keys.forEach((cellKey) => reserved.add(cellKey));
    });

    stepStart = now;
  }

  function commitTargets() {
    blocks.forEach((block) => {
      block.x = block.targetX;
      block.y = block.targetY;
      block.startX = block.x;
      block.startY = block.y;
    });
  }

  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function drawGrid() {
    const scrollY = window.scrollY || 0;
    const yOffset = -((scrollY % cellSize) + cellSize) % cellSize;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = 0; x <= width + cellSize; x += cellSize) {
      const px = Math.round(x) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
    }

    for (let y = yOffset; y <= height + cellSize; y += cellSize) {
      const py = Math.round(y) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
    }

    ctx.stroke();
  }

  function drawHatchedCell(seed, px, py) {
    const size = cellSize - 1;
    const hatchSpacing = backgroundConfig.hatchSpacing;
    const phase = (seededNoise(seed, 0) - 0.5) * hatchSpacing;
    const inset = 1;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, size, size);
    ctx.clip();
    ctx.strokeStyle = hatchColor;
    ctx.lineWidth = 1.05;
    ctx.lineCap = 'round';

    for (
      let offset = -cellSize + phase;
      offset < cellSize * 2 + phase;
      offset += hatchSpacing
    ) {
      const lineIndex = Math.round((offset + cellSize) / hatchSpacing);
      if (seededNoise(seed, lineIndex * 7 + 5) < 0.025) continue;

      const diagonal = offset + size;
      let startLocalX = clamp(diagonal - size, inset, size - inset);
      let endLocalX = clamp(diagonal, inset, size - inset);
      const availableLength = endLocalX - startLocalX;
      if (availableLength < 3) continue;

      const maxTrim = Math.min(2.2, availableLength * 0.14);
      const trimStart = seededNoise(seed, lineIndex * 7 + 1) * maxTrim;
      const trimEnd = seededNoise(seed, lineIndex * 7 + 2) * maxTrim;
      startLocalX += trimStart;
      endLocalX -= trimEnd;
      if (endLocalX - startLocalX < 2.5) continue;

      const wobbleA = (seededNoise(seed, lineIndex * 4) - 0.5) * 0.45;
      const wobbleB = (seededNoise(seed, lineIndex * 4 + 1) - 0.5) * 0.55;
      const startX = px + clamp(startLocalX + wobbleA, inset, size - inset);
      const startY =
        py + clamp(diagonal - startLocalX + wobbleB, inset, size - inset);
      const endX = px + clamp(endLocalX + wobbleB, inset, size - inset);
      const endY =
        py + clamp(diagonal - endLocalX + wobbleA, inset, size - inset);

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawHatchedBlock(block, px, py) {
    blockCells(0, 0, block.w, block.h).forEach((cell) => {
      const cellSeed =
        block.seed + (cell.x + 1) * 17.131 + (cell.y + 1) * 31.719;
      drawHatchedCell(
        cellSeed,
        px + cell.x * cellSize,
        py + cell.y * cellSize
      );
    });
  }

  function drawBlocks(progress) {
    const eased = ease(progress);
    const scrollY = window.scrollY || 0;

    blocks.forEach((block) => {
      const x = block.startX + (block.targetX - block.startX) * eased;
      const y = block.startY + (block.targetY - block.startY) * eased;
      const screenY = y * cellSize - scrollY;

      if (screenY < -block.h * cellSize || screenY > height + cellSize) {
        return;
      }

      drawHatchedBlock(
        block,
        Math.round(x * cellSize) + 1,
        Math.round(screenY) + 1
      );
    });
  }

  function draw(progress) {
    ctx.clearRect(0, 0, width, height);
    drawGrid();
    drawBlocks(progress);
  }

  function tick(now) {
    if (now - stepStart >= stepInterval) {
      commitTargets();
      chooseTargets(now);
    }

    const progress = reduceMotion.matches
      ? 1
      : Math.min((now - stepStart) / stepDuration, 1);
    draw(progress);

    if (!reduceMotion.matches) {
      rafId = window.requestAnimationFrame(tick);
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const doc = document.documentElement;
    const body = document.body;
    width = window.innerWidth;
    height = window.innerHeight;
    docHeight = Math.max(
      window.innerHeight,
      doc.scrollHeight,
      doc.offsetHeight,
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0
    );
    cols = Math.ceil(width / cellSize) + 1;
    rows = Math.ceil(docHeight / cellSize) + 1;
    headerSeededCells = 0;
    updateAvailableRegions();
    updateProtectedCells();
    updateDecorationCells();

    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    generateBlocks();
    updateCanvasStats();
    chooseTargets(performance.now());
    draw(reduceMotion.matches ? 1 : 0);
  }

  function scheduleResize() {
    if (resizeFrameId) return;
    resizeFrameId = window.requestAnimationFrame(() => {
      resizeFrameId = null;
      resize();
    });
  }

  window.addEventListener('resize', scheduleResize);

  window.addEventListener('scroll', () => {
    draw(reduceMotion.matches ? 1 : Math.min(
      (performance.now() - stepStart) / stepDuration,
      1
    ));
  }, { passive: true });

  window.addEventListener('load', resize);

  if (window.ResizeObserver) {
    const pageObserver = new ResizeObserver(() => {
      scheduleResize();
    });
    pageObserver.observe(document.body);
  }

  resize();

  if (!reduceMotion.matches) {
    rafId = window.requestAnimationFrame(tick);
  }

  if (reduceMotion.addEventListener) {
    reduceMotion.addEventListener('change', () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      resize();
      if (!reduceMotion.matches) {
        rafId = window.requestAnimationFrame(tick);
      }
    });
  }
})();

// BibTeX copy button
(function () {
  const button = document.querySelector('.copy-bibtex');
  const code = document.querySelector('.bibtex code');
  if (!button || !code) return;

  const defaultLabel = button.getAttribute('data-copy-label') || 'Copy';
  const copiedLabel = button.getAttribute('data-copied-label') || 'Copied';
  let resetTimer = null;

  function setCopiedState() {
    button.classList.add('is-copied');
    button.setAttribute('aria-label', copiedLabel + ' BibTeX citation');
    button.title = copiedLabel;
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      button.classList.remove('is-copied');
      button.setAttribute('aria-label', defaultLabel + ' BibTeX citation');
      button.title = defaultLabel;
    }, 1600);
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_) {
        // Fall through to the legacy path when browser permissions block it.
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const didCopy = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!didCopy) {
      throw new Error('Copy command failed');
    }
  }

  button.title = defaultLabel;
  button.addEventListener('click', async () => {
    try {
      await copyText(code.textContent || '');
      setCopiedState();
    } catch (_) {
      button.setAttribute('aria-label', 'Copy failed');
    }
  });
})();

// Lightbox gallery
(function () {
  // Detect WebP support once
  function browserSupportsWebp() {
    try {
      const elem = document.createElement('canvas');
      if (!!(elem.getContext && elem.getContext('2d'))) {
        return elem.toDataURL('image/webp').indexOf('data:image/webp') === 0;
      }
      return false;
    } catch (_) {
      return false;
    }
  }
  const hasWebp = browserSupportsWebp();

  // If no WebP support, swap any .webp sources/imgs to .jpg fallbacks
  if (!hasWebp) {
    // Swap <img src> inside the page (thumbnails, teaser fallback already handled by <picture>)
    document.querySelectorAll('img').forEach(function (img) {
      if (img.src && img.src.endsWith('.webp')) {
        img.src = img.src.replace(/\.webp($|\?)/, '.jpg$1');
      }
      // Ensure any future error tries jpg
      img.addEventListener('error', function onError() {
        if (img.src && img.src.endsWith('.webp')) {
          img.src = img.src.replace(/\.webp($|\?)/, '.jpg$1');
        }
        img.removeEventListener('error', onError);
      });
    });

    // Also adjust gallery anchors' data-full attributes for lightbox
    document.querySelectorAll('.gallery-item').forEach(function (a) {
      var full = a.getAttribute('data-full');
      if (full && /\.webp(\?|$)/.test(full)) {
        a.setAttribute('data-full', full.replace(/\.webp($|\?)/, '.jpg$1'));
      }
    });
  } else {
    // Even with WebP, be resilient: on load error, try jpg
    document.querySelectorAll('img').forEach(function (img) {
      img.addEventListener('error', function onError() {
        if (/\.webp(\?|$)/.test(img.src)) {
          img.src = img.src.replace(/\.webp($|\?)/, '.jpg$1');
        }
        img.removeEventListener('error', onError);
      });
    });
  }

  const gallery = document.getElementById('gallery');
  if (!gallery) return;

  const items = Array.from(gallery.querySelectorAll('.gallery-item'));
  const lightbox = document.getElementById('lightbox');
  const imgEl = document.getElementById('lightbox-image');
  const captionEl = document.getElementById('lightbox-caption');
  const prevBtn = document.getElementById('lightbox-prev');
  const nextBtn = document.getElementById('lightbox-next');
  const closeBtn = document.getElementById('lightbox-close');

  let currentIndex = 0;

  function open(index) {
    currentIndex = index;
    const item = items[currentIndex];
    let full = item.getAttribute('data-full') || item.querySelector('img')?.src;
    // If image fails or no webp support, prefer jpg
    if (full && !hasWebp && /\.webp(\?|$)/.test(full)) {
      full = full.replace(/\.webp($|\?)/, '.jpg$1');
    }
    const alt = item.querySelector('img')?.alt || '';
    if (imgEl) imgEl.src = full || '';
    if (imgEl) imgEl.alt = alt;
    if (captionEl) captionEl.textContent = alt;
    if (lightbox) {
      lightbox.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
  }

  function close() {
    if (lightbox) lightbox.setAttribute('aria-hidden', 'true');
    if (imgEl) imgEl.src = '';
    document.body.style.overflow = '';
  }

  function showNext(delta) {
    const len = items.length;
    currentIndex = (currentIndex + delta + len) % len;
    open(currentIndex);
  }

  items.forEach((a, i) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      open(i);
    });
    a.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(i);
      }
    });
    a.setAttribute('role', 'button');
    a.setAttribute('tabindex', '0');
  });

  if (prevBtn) prevBtn.addEventListener('click', () => showNext(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => showNext(1));
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (lightbox) lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) close();
  });

  // Lightbox image error fallback
  if (imgEl) {
    imgEl.addEventListener('error', function onLightboxError() {
      if (imgEl.src && /\.webp(\?|$)/.test(imgEl.src)) {
        imgEl.src = imgEl.src.replace(/\.webp($|\?)/, '.jpg$1');
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (lightbox && lightbox.getAttribute('aria-hidden') === 'false') {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') showNext(1);
      if (e.key === 'ArrowLeft') showNext(-1);
    }
  });
})();

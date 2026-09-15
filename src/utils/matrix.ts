import type {
  BoardPreset,
  DiodeDirection,
  HalfId,
  MatrixAnalysis,
  MatrixConfig,
  MatrixIssue,
  MatrixKey,
  PinAssignment,
  PinAssignResult,
  RelaxationSuggestion,
} from '@/types';

/* ------------------------------------------------------------------ */
/* 开发板能力预设：引脚固定顺序 + 禁用引脚                               */
/* ------------------------------------------------------------------ */

export const BOARD_PRESETS: BoardPreset[] = [
  {
    id: 'rp2040-zero-split',
    label: 'RP2040-Zero（分体，每半一片）',
    split: true,
    pinOrder: ['GP0', 'GP1', 'GP2', 'GP3', 'GP4', 'GP5', 'GP6', 'GP7', 'GP8', 'GP9',
      'GP10', 'GP11', 'GP12', 'GP13', 'GP14', 'GP15', 'GP16', 'GP17', 'GP18', 'GP19',
      'GP20', 'GP21', 'GP22', 'GP23', 'GP24', 'GP25', 'GP26', 'GP27', 'GP28', 'GP29'],
    disabledPins: ['GP23', 'GP24', 'GP25', 'GP29'],
    note: '每半一片 RP2040-Zero；GP23/GP24/GP25/GP29 为板载状态灯/电源/检测脚，禁用作矩阵线，共 26 个可用 IO。',
  },
  {
    id: 'promicro-atmega32u4-split',
    label: 'Pro Micro ATmega32U4（分体，每半一片，5V/16MHz）',
    split: true,
    pinOrder: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D14',
      'D15', 'D16', 'D18', 'D19', 'D20', 'D21'],
    disabledPins: ['D0', 'D1'],
    note: '每半一片 Pro Micro；D0/D1 为硬件串口，分体通信常用，默认禁用，共 16 个可用 IO。D14~D16、D18~D21 为模拟口。',
  },
  {
    id: 'promicro-atmega32u4',
    label: 'Pro Micro ATmega32U4（一体整片，5V/16MHz）',
    split: false,
    pinOrder: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D14',
      'D15', 'D16', 'D18', 'D19', 'D20', 'D21'],
    disabledPins: ['D0', 'D1'],
    note: '单片驱动整块键盘；D0/D1 为硬件串口默认禁用，共 16 个可用 IO。',
  },
  {
    id: 'blackpill-stm32f401',
    label: 'BlackPill STM32F401（一体整片）',
    split: false,
    pinOrder: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11',
      'A12', 'A13', 'A14', 'A15', 'B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8',
      'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'C13', 'C14', 'C15'],
    disabledPins: ['A11', 'A12', 'A13', 'A14', 'A15', 'B11'],
    note: 'A11/A12 为 USB D-/D+；A13/A14 为 SWD 调试；A15 常作 JTAG；B11 常见板载占用，共 29 个可用 IO。',
  },
];

export function getBoardPreset(id: string): BoardPreset | undefined {
  return BOARD_PRESETS.find((b) => b.id === id);
}

/* ------------------------------------------------------------------ */
/* 常量与工具                                                           */
/* ------------------------------------------------------------------ */

export const MATRIX_DIMS_MIN = 1;
export const MATRIX_DIMS_MAX = 20;
export const GHOST_REPORT_LIMIT = 24;
export const MISSING_REPORT_LIMIT = 20;

const HALVES: HalfId[] = ['L', 'R'];

export function halfLabel(h: HalfId): string {
  return h === 'L' ? '左半区' : '右半区';
}

export function coordLabel(row: number, col: number): string {
  return `(行${row + 1},列${col + 1})`;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** 固定顺序内可用引脚（剔除禁用脚） */
function usablePins(preset: BoardPreset): string[] {
  const disabled = new Set(preset.disabledPins);
  return preset.pinOrder.filter((p) => !disabled.has(p));
}

/**
 * 构造「无解时的最少放宽建议」。
 * feasible=true：放开 unblockPins（恰为 shortage 个）即可补齐缺口；
 * feasible=false：即使放开全部现有禁用脚仍缺脚，unblockPins 列出全部禁用脚，
 *                 消息明确要求减线或换板，不再给出数量对不上的建议。
 */
function buildRelaxationSuggestion(
  preset: BoardPreset,
  half: HalfId,
  rows: number,
  cols: number,
  available: number,
): RelaxationSuggestion {
  const required = rows + cols;
  const shortage = required - available;
  const boardName = preset.label.split('（')[0];
  const candidates = preset.disabledPins.filter((p) => preset.pinOrder.includes(p));
  const feasible = candidates.length >= shortage;
  const unblockPins = feasible ? candidates.slice(0, shortage) : [...candidates];
  const head = `${halfLabel(half)}无解：需要 ${required} 个独立引脚（${rows} 行 + ${cols} 列），`
    + `${boardName} 只有 ${available} 个非禁用脚。`;

  const message = feasible
    ? head
      + `最少放宽：按固定顺序再放开 ${shortage} 个禁用脚（${unblockPins.join('、')}）即可满足；`
      + '或将行列线总数减到当前可用脚以内，或更换开发板。'
    : head
      + `即使放开全部 ${candidates.length} 个禁用脚（${candidates.join('、') || '无'}）也仍缺 `
      + `${shortage - candidates.length} 个引脚，单组放宽无法解决。`
      + `请至少把行列线减少 ${shortage - candidates.length} 条（总数降至 ${available + candidates.length} 条以内），或更换引脚更多的开发板。`;

  return { half, available, required, shortage, feasible, unblockPins, message };
}

/* ------------------------------------------------------------------ */
/* 默认配置 / 兼容读取                                                   */
/* ------------------------------------------------------------------ */

export function createDefaultMatrixConfig(): MatrixConfig {
  const boardId = BOARD_PRESETS[0].id;
  const preset = BOARD_PRESETS[0];
  const rows = 4;
  const cols = 12;
  return {
    version: 1,
    boardId,
    rows,
    cols,
    expectedKeyCount: 0,
    split: preset.split,
    diodeMode: 'per-key',
    diodeDirection: 'col2row',
    keys: [],
    pins: preset.split
      ? [
        { half: 'L', rowPins: [], colPins: [] },
        { half: 'R', rowPins: [], colPins: [] },
      ]
      : [{ half: 'L', rowPins: [], colPins: [] }],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 宽松解析持久化/导入的矩阵数据。结构损坏返回 null；
 * 非法的单个键/引脚条目会被剔除而不是整体失败，避免老数据拖垮界面。
 */
export function normalizeMatrixConfig(input: unknown): MatrixConfig | null {
  if (typeof input !== 'object' || input === null) return null;
  const o = input as Record<string, unknown>;

  const boardId = typeof o.boardId === 'string' ? o.boardId : BOARD_PRESETS[0].id;
  const preset = getBoardPreset(boardId);
  const rows = isInt(o.rows) ? o.rows : 0;
  const cols = isInt(o.cols) ? o.cols : 0;
  const split = typeof o.split === 'boolean' ? o.split : preset?.split ?? false;
  const diodeMode = o.diodeMode === 'none' ? 'none' : 'per-key';
  const diodeDirection: DiodeDirection =
    o.diodeDirection === 'row2col' ? 'row2col' : 'col2row';
  const expectedKeyCount = isInt(o.expectedKeyCount) && o.expectedKeyCount >= 0
    ? o.expectedKeyCount
    : 0;

  const keys: MatrixKey[] = [];
  if (Array.isArray(o.keys)) {
    for (const raw of o.keys) {
      if (typeof raw !== 'object' || raw === null) continue;
      const k = raw as Record<string, unknown>;
      if (typeof k.name !== 'string' || k.name.trim() === '') continue;
      if (k.half !== 'L' && k.half !== 'R') continue;
      if (!isInt(k.row) || !isInt(k.col)) continue;
      const key: MatrixKey = {
        name: k.name.trim(),
        half: k.half,
        row: k.row,
        col: k.col,
      };
      if (k.diodeDirection === 'col2row' || k.diodeDirection === 'row2col') {
        key.diodeDirection = k.diodeDirection;
      }
      keys.push(key);
    }
  }

  const expectedHalves: HalfId[] = split ? HALVES : ['L'];
  let pins: PinAssignment[] = [];
  if (Array.isArray(o.pins)) {
    for (const half of expectedHalves) {
      const raw = (o.pins as unknown[]).find(
        (p) => typeof p === 'object' && p !== null && (p as { half?: unknown }).half === half,
      ) as Record<string, unknown> | undefined;
      const clean = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      pins.push({
        half,
        rowPins: clean(raw?.rowPins),
        colPins: clean(raw?.colPins),
      });
    }
  } else {
    pins = expectedHalves.map((half) => ({ half, rowPins: [], colPins: [] }));
  }

  const updatedAt = typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString();

  return {
    version: 1,
    boardId,
    rows,
    cols,
    expectedKeyCount,
    split,
    diodeMode,
    diodeDirection,
    keys,
    pins,
    updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* 引脚自动分配（固定顺序：R0..Rn → C0..Cn；每个半区独立）               */
/* ------------------------------------------------------------------ */

/**
 * 按开发板能力给每个在用半区分配不重复且非禁用的引脚。
 * 可用脚不足时该半区数组截断，并在 suggestions 中给出最少放宽建议。
 */
export function autoAssignPins(
  rows: number,
  cols: number,
  split: boolean,
  boardId: string,
): PinAssignResult {
  const preset = getBoardPreset(boardId);
  const halves: HalfId[] = split ? HALVES : ['L'];
  const pins: PinAssignment[] = [];
  const suggestions: RelaxationSuggestion[] = [];

  for (const half of halves) {
    const rowPins: string[] = [];
    const colPins: string[] = [];
    if (preset) {
      const pool = usablePins(preset);
      const needed = Math.max(rows, 0) + Math.max(cols, 0);
      const picked = pool.slice(0, needed);
      rowPins.push(...picked.slice(0, Math.max(rows, 0)));
      colPins.push(...picked.slice(Math.max(rows, 0), needed));

      if (picked.length < needed) {
        suggestions.push(buildRelaxationSuggestion(preset, half, rows, cols, pool.length));
      }
    }
    pins.push({ half, rowPins, colPins });
  }

  return { pins, suggestions };
}

/** 用固定顺序重新分配结果替换配置中的引脚（调整后重算） */
export function withAutoAssignedPins(config: MatrixConfig): MatrixConfig {
  const { pins } = autoAssignPins(config.rows, config.cols, config.split, config.boardId);
  return { ...config, pins };
}

/* ------------------------------------------------------------------ */
/* 矩阵分析                                                             */
/* ------------------------------------------------------------------ */

interface PlacedKey extends MatrixKey {
  inBounds: boolean;
}

export function analyzeMatrix(config: MatrixConfig): MatrixAnalysis {
  const issues: MatrixIssue[] = [];
  const suggestions: RelaxationSuggestion[] = [];
  const preset = getBoardPreset(config.boardId);

  const dimsValid =
    isInt(config.rows) &&
    isInt(config.cols) &&
    config.rows >= MATRIX_DIMS_MIN &&
    config.rows <= MATRIX_DIMS_MAX &&
    config.cols >= MATRIX_DIMS_MIN &&
    config.cols <= MATRIX_DIMS_MAX;

  if (!dimsValid) {
    issues.push({
      level: 'error',
      code: 'dimension-invalid',
      message: `行列数必须为 ${MATRIX_DIMS_MIN}~${MATRIX_DIMS_MAX} 的整数（当前 ${config.rows} 行 × ${config.cols} 列），请先修正配列尺寸。`,
    });
  }

  const activeHalves: HalfId[] = config.split ? HALVES : ['L'];

  /* ---- 按键校验：结构非法 / 越界 / 重复坐标 / 重名 ---- */
  const validKeys: PlacedKey[] = [];
  const seenPositions = new Set<string>();
  const nameOwners = new Map<string, PlacedKey>();

  for (const key of config.keys) {
    if (
      key.name.trim() === '' ||
      (key.half !== 'L' && key.half !== 'R') ||
      !isInt(key.row) ||
      !isInt(key.col)
    ) {
      issues.push({
        level: 'error',
        code: 'key-invalid',
        half: key.half === 'L' || key.half === 'R' ? key.half : undefined,
        message: `键「${key.name || '(无名)'}」登记信息非法：半区、行、列必须完整且为整数。`,
      });
      continue;
    }
    if (!config.split && key.half === 'R') {
      issues.push({
        level: 'error',
        code: 'key-out-of-bounds',
        half: 'R',
        row: key.row,
        col: key.col,
        keys: [key.name],
        message: `键「${key.name}」登记在右半区 ${coordLabel(key.row, key.col)}，但当前开发板为一体（非分体）配列，没有右半区。`,
      });
      continue;
    }

    const inBounds = dimsValid && key.row >= 0 && key.row < config.rows && key.col >= 0 && key.col < config.cols;
    const placed: PlacedKey = { ...key, name: key.name.trim(), inBounds };

    if (!inBounds) {
      issues.push({
        level: 'error',
        code: 'key-out-of-bounds',
        half: key.half,
        row: key.row,
        col: key.col,
        keys: [key.name],
        message: `键「${key.name}」坐标 ${halfLabel(key.half)} ${coordLabel(key.row, key.col)} 越界，`
          + `允许范围为 行1~${config.rows}、列1~${config.cols}。`,
      });
    } else {
      const posKey = `${key.half}:${key.row}:${key.col}`;
      if (seenPositions.has(posKey)) {
        issues.push({
          level: 'error',
          code: 'key-duplicate-position',
          half: key.half,
          row: key.row,
          col: key.col,
          keys: [key.name],
          message: `键「${key.name}」与另一键重复占用 ${halfLabel(key.half)} ${coordLabel(key.row, key.col)}，同一格只能登记一个键。`,
        });
      }
      seenPositions.add(posKey);
    }

    const owner = nameOwners.get(key.name);
    if (owner) {
      issues.push({
        level: 'error',
        code: 'key-duplicate-name',
        half: key.half,
        row: key.row,
        col: key.col,
        keys: [key.name],
        message: `键位名「${key.name}」重复：${halfLabel(owner.half)} ${coordLabel(owner.row, owner.col)}`
          + ` 与 ${halfLabel(key.half)} ${coordLabel(key.row, key.col)}，键位名必须唯一。`,
      });
    } else {
      nameOwners.set(key.name, placed);
    }

    validKeys.push(placed);
  }

  /* ---- 占用矩阵（只统计合法、在界、坐标唯一的键） ---- */
  const occupancy: Record<HalfId, boolean[][]> = {
    L: buildEmptyGrid(config.rows, config.cols),
    R: buildEmptyGrid(config.rows, config.cols),
  };
  const cellNames: Record<HalfId, (string | null)[][]> = {
    L: buildNameGrid(config.rows, config.cols),
    R: buildNameGrid(config.rows, config.cols),
  };
  const placedSet = new Set<string>();
  for (const k of validKeys) {
    if (!k.inBounds) continue;
    const posKey = `${k.half}:${k.row}:${k.col}`;
    if (placedSet.has(posKey)) continue;
    placedSet.add(posKey);
    occupancy[k.half][k.row][k.col] = true;
    cellNames[k.half][k.row][k.col] = k.name;
  }

  /* ---- 空行空列 / 空半区 / 漏键 ---- */
  if (dimsValid) {
    for (const half of activeHalves) {
      const halfKeys = validKeys.filter((k) => k.inBounds && k.half === half);
      if (halfKeys.length === 0) {
        issues.push({
          level: 'error',
          code: 'empty-half',
          half,
          message: `${halfLabel(half)}没有登记任何按键，请补全该半区配列，或改用一体（非分体）开发板。`,
        });
        continue;
      }

      const rowUsed = new Set(halfKeys.map((k) => k.row));
      const colUsed = new Set(halfKeys.map((k) => k.col));
      for (let r = 0; r < config.rows; r++) {
        if (!rowUsed.has(r)) {
          issues.push({
            level: 'error',
            code: 'empty-row',
            half,
            row: r,
            message: `${halfLabel(half)}第 ${r + 1} 行为空行：整行没有任何按键，请删除该行或补齐键位。`,
          });
        }
      }
      for (let c = 0; c < config.cols; c++) {
        if (!colUsed.has(c)) {
          issues.push({
            level: 'error',
            code: 'empty-col',
            half,
            col: c,
            message: `${halfLabel(half)}第 ${c + 1} 列为空列：整列没有任何按键，请删除该列或补齐键位。`,
          });
        }
      }

      /* 漏键：行列范围内的内部空格（所在行、列都还有别的键） */
      const holes: Array<{ row: number; col: number }> = [];
      for (let r = 0; r < config.rows; r++) {
        for (let c = 0; c < config.cols; c++) {
          if (occupancy[half][r][c]) continue;
          if (rowUsed.has(r) && colUsed.has(c)) holes.push({ row: r, col: c });
        }
      }
      if (holes.length > 0) {
        const shown = holes.slice(0, MISSING_REPORT_LIMIT);
        issues.push({
          level: 'error',
          code: 'missing-key',
          half,
          keys: shown.map((h) => coordLabel(h.row, h.col)),
          message: `${halfLabel(half)}疑似漏键 ${holes.length} 处（行、列均有其他键的空格）：`
            + `${shown.map((h) => coordLabel(h.row, h.col)).join('、')}`
            + `${holes.length > shown.length ? ` 等，共 ${holes.length} 处` : ''}。`,
        });
      }
    }

    /* 与登记期望键数核对 */
    if (isInt(config.expectedKeyCount) && config.expectedKeyCount > 0) {
      const placedCount = activeHalves
        .flatMap((h) => occupancy[h])
        .flat()
        .filter(Boolean).length;
      if (placedCount !== config.expectedKeyCount) {
        issues.push({
          level: 'error',
          code: 'missing-key',
          message: `实际布键 ${placedCount} 个，与登记的期望键数 ${config.expectedKeyCount} 不符`
            + `（${placedCount < config.expectedKeyCount ? '少' : '多'} ${Math.abs(config.expectedKeyCount - placedCount)} 个）。`,
        });
      }
    }
  }

  /* ---- 二极管 / 串扰 ---- */
  if (config.diodeMode === 'none') {
    if (dimsValid) {
      for (const half of activeHalves) {
        const triplets = findGhostTriplets(occupancy[half], cellNames[half]);
        triplets.slice(0, GHOST_REPORT_LIMIT).forEach((t) => {
          issues.push({
            level: 'warning',
            code: 'ghost-triplet',
            half,
            keys: t.names,
            message: `${halfLabel(half)}无二极管：${t.names.map((n) => `「${n}」`).join('、')} 三键同时按下会经寄生通路串扰，`
              + `产生幽灵键 ${coordLabel(t.ghost.row, t.ghost.col)}（该位置实际未按）。共 ${triplets.length} 组串扰。`,
          });
        });
      }
    }
  } else {
    /* per-key：统计每键的实际方向（未单独标注则继承整体方向），标出少数派 */
    const dirs = validKeys.filter((k) => k.inBounds).map((k) => ({
      key: k,
      dir: k.diodeDirection ?? config.diodeDirection,
    }));
    if (dirs.length > 0) {
      const countCol2Row = dirs.filter((d) => d.dir === 'col2row').length;
      const countRow2Col = dirs.length - countCol2Row;
      if (countCol2Row > 0 && countRow2Col > 0) {
        let refDir: DiodeDirection;
        if (countCol2Row === countRow2Col) refDir = config.diodeDirection;
        else refDir = countCol2Row > countRow2Col ? 'col2row' : 'row2col';
        const minority = dirs.filter((d) => d.dir !== refDir);
        const reverseRisk = minority.length === 1;
        const dirText = (d: DiodeDirection) => (d === 'col2row' ? '列→行（COL2ROW）' : '行→列（ROW2COL）');
        for (const m of minority) {
          issues.push({
            level: 'warning',
            code: reverseRisk ? 'diode-reverse-risk' : 'diode-direction-mismatch',
            half: m.key.half,
            row: m.key.row,
            col: m.key.col,
            keys: [m.key.name],
            message: reverseRisk
              ? `键「${m.key.name}」(${halfLabel(m.key.half)} ${coordLabel(m.key.row, m.key.col)}) 二极管方向为 ${dirText(m.dir)}，`
                + `与其余所有键（${dirText(refDir)}）相反——疑似该键二极管反接，请核对丝印极性。`
              : `键「${m.key.name}」(${halfLabel(m.key.half)} ${coordLabel(m.key.row, m.key.col)}) 二极管方向为 ${dirText(m.dir)}，`
                + `与多数键的 ${dirText(refDir)} 不一致，扫描方向将无法统一。`,
          });
        }
      }
    }
  }

  /* ---- 引脚 ---- */
  if (preset && dimsValid) {
    const disabled = new Set(preset.disabledPins);
    const validPinSet = new Set(preset.pinOrder);

    for (const half of activeHalves) {
      const assignment = config.pins.find((p) => p.half === half);
      const rowPins = assignment?.rowPins ?? [];
      const colPins = assignment?.colPins ?? [];

      const seen = new Map<string, string>();

      const checkLine = (pin: string | undefined, lineLabel: string, index: number) => {
        const p = (pin ?? '').trim();
        if (!p) {
          issues.push({
            level: 'error',
            code: 'pin-missing',
            half,
            message: `${halfLabel(half)} ${lineLabel} ${index} 未分配引脚，请重新执行自动分配或手动指定。`,
          });
          return;
        }
        if (!validPinSet.has(p)) {
          issues.push({
            level: 'error',
            code: 'pin-illegal',
            half,
            pin: p,
            message: `${halfLabel(half)} ${lineLabel} ${index} 指定的「${p}」不在 ${preset.label.split('（')[0]} 的引脚清单内（非法引脚）。`,
          });
          return;
        }
        if (disabled.has(p)) {
          issues.push({
            level: 'error',
            code: 'pin-disabled',
            half,
            pin: p,
            message: `${halfLabel(half)} ${lineLabel} ${index} 使用了禁用脚「${p}」：${preset.note}`,
          });
        }
        const prevLine = seen.get(p);
        if (prevLine) {
          issues.push({
            level: 'error',
            code: 'pin-duplicate',
            half,
            pin: p,
            message: `${halfLabel(half)} 引脚「${p}」被重复分配：${prevLine} 与 ${lineLabel} ${index}，同一半区内行列线必须各占一个独立引脚。`,
          });
        } else {
          seen.set(p, `${lineLabel} ${index}`);
        }
      };

      for (let i = 0; i < config.rows; i++) checkLine(rowPins[i], '行线 R', i);
      for (let i = 0; i < config.cols; i++) checkLine(colPins[i], '列线 C', i);

      /* 容量 / 无解判断 */
      const pool = usablePins(preset);
      const needed = config.rows + config.cols;
      if (pool.length < needed) {
        const suggestion = buildRelaxationSuggestion(
          preset, half, config.rows, config.cols, pool.length,
        );
        suggestions.push(suggestion);
        issues.push({
          level: 'error',
          code: 'no-solution',
          half,
          message: suggestion.message,
        });
      }
    }
  } else if (!preset) {
    issues.push({
      level: 'warning',
      code: 'pin-illegal',
      pin: config.boardId,
      message: `未知开发板型号「${config.boardId}」，无法校验引脚合法性，请重新选择开发板。`,
    });
  }

  const keyCount = placedSet.size;
  const valid = !issues.some((i) => i.level === 'error');

  return { config, preset, issues, valid, keyCount, occupancy, suggestions };
}

function buildEmptyGrid(rows: number, cols: number): boolean[][] {
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) return [];
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
}

function buildNameGrid(rows: number, cols: number): (string | null)[][] {
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) return [];
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

interface GhostTriplet {
  names: string[];
  ghost: { row: number; col: number };
}

/**
 * 无二极管矩阵的三键串扰（ghosting）：
 * 任意两行两列交叉的 4 格中恰好按下 3 个，第 4 格会被误判按下。
 */
function findGhostTriplets(
  grid: boolean[][],
  names: (string | null)[][],
): GhostTriplet[] {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  const results: GhostTriplet[] = [];
  const seen = new Set<string>();

  for (let r1 = 0; r1 < rows; r1++) {
    for (let r2 = r1 + 1; r2 < rows; r2++) {
      for (let c1 = 0; c1 < cols; c1++) {
        for (let c2 = c1 + 1; c2 < cols; c2++) {
          const corners = [
            { row: r1, col: c1, on: grid[r1][c1] },
            { row: r1, col: c2, on: grid[r1][c2] },
            { row: r2, col: c1, on: grid[r2][c1] },
            { row: r2, col: c2, on: grid[r2][c2] },
          ];
          const onCorners = corners.filter((c) => c.on);
          if (onCorners.length !== 3) continue;
          const ghost = corners.find((c) => !c.on)!;
          const dedupKey = onCorners.map((c) => `${c.row}:${c.col}`).sort().join('|');
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          results.push({
            names: onCorners.map((c) => names[c.row][c.col] ?? coordLabel(c.row, c.col)),
            ghost: { row: ghost.row, col: ghost.col },
          });
        }
      }
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* 配置编辑辅助                                                          */
/* ------------------------------------------------------------------ */

/** 开发板/分体/行列尺寸变化时，把引脚槽位与半区裁剪到合法形状（不自动填值） */
export function reshapePins(config: MatrixConfig): MatrixConfig {
  const halves: HalfId[] = config.split ? HALVES : ['L'];
  const pins: PinAssignment[] = halves.map((half) => {
    const old = config.pins.find((p) => p.half === half);
    return {
      half,
      rowPins: (old?.rowPins ?? []).slice(0, config.rows),
      colPins: (old?.colPins ?? []).slice(0, config.cols),
    };
  });
  const keys = config.split
    ? config.keys
    : config.keys.filter((k) => k.half !== 'R');
  return { ...config, pins, keys };
}

export function countIssues(analysis: MatrixAnalysis): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const i of analysis.issues) {
    if (i.level === 'error') errors++;
    else warnings++;
  }
  return { errors, warnings };
}

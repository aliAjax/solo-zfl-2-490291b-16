#!/usr/bin/env node
/**
 * 配列矩阵 & 引脚检查台 —— 纯逻辑验证脚本。
 * 覆盖：重复键位（坐标/名称）、越界、空行、空列、空半区、漏键、
 *      三键串扰、二极管方向不一致、反接风险、
 *      非法/禁用/重复/缺失引脚、无解与最少放宽、
 *      固定顺序自动分配、旧数据兼容。
 *
 * 运行：npm run test:matrix
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'matrix-test-'));

async function bundle(entry, outfile) {
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
    alias: { '@': join(process.cwd(), 'src') },
  });
  return pathToFileURL(outfile).href;
}

const mx = await import(await bundle('src/utils/matrix.ts', join(tmp, 'matrix.mjs')));
const ie = await import(await bundle('src/utils/importExport.ts', join(tmp, 'importExport.mjs')));

const {
  analyzeMatrix, autoAssignPins, normalizeMatrixConfig, reshapePins,
  withAutoAssignedPins, createDefaultMatrixConfig, getBoardPreset,
} = mx;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function findIssue(analysis, code, pred) {
  return analysis.issues.find((i) => i.code === code && (pred ? pred(i) : true));
}

function fullKeys(rows, cols, halves = ['L', 'R'], opts = {}) {
  const keys = [];
  for (const half of halves) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = { name: `K_${half}_${r}_${c}`, half, row: r, col: c };
        if (opts.reverse && opts.reverse(half, r, c)) k.diodeDirection = 'row2col';
        keys.push(k);
      }
    }
  }
  return keys;
}

/** 合法基线：RP2040-Zero 分体，3×4，左右铺满，每键二极管 col2row，引脚自动分配 */
function baseConfig(overrides = {}) {
  const rows = overrides.rows ?? 3;
  const cols = overrides.cols ?? 4;
  const split = overrides.split ?? true;
  const boardId = overrides.boardId ?? 'rp2040-zero-split';
  const cfg = {
    ...createDefaultMatrixConfig(),
    rows,
    cols,
    split,
    boardId,
    diodeMode: 'per-key',
    diodeDirection: 'col2row',
    expectedKeyCount: 0,
    keys: overrides.keys ?? fullKeys(rows, cols, split ? ['L', 'R'] : ['L'], overrides),
  };
  const assigned = autoAssignPins(rows, cols, split, boardId);
  cfg.pins = overrides.pins ?? assigned.pins;
  return { ...cfg, ...overrides };
}

function setPin(cfg, half, kind, index, pin) {
  cfg.pins = cfg.pins.map((p) => {
    if (p.half !== half) return p;
    const arr = [...p[kind]];
    arr[index] = pin;
    return { ...p, [kind]: arr };
  });
}

const RP = getBoardPreset('rp2040-zero-split');
const PM = getBoardPreset('promicro-atmega32u4');

/* ------------------------------------------------------------------ */

console.log('\n[1] 合法基线');
check('完整 3×4 分体配列 + 自动引脚：0 问题、valid=true', () => {
  const a = analyzeMatrix(baseConfig());
  assert(a.valid, '基线应当通过：' + a.issues.map((i) => i.message).join(' / '));
  assert(a.issues.length === 0, '不应有任何问题，实际 ' + a.issues.length);
  assert(a.keyCount === 24, `应布 24 键，实际 ${a.keyCount}`);
});

console.log('\n[2] 重复键位');
check('重复坐标被拦下并说明半区与行列位置', () => {
  const cfg = baseConfig();
  cfg.keys.push({ name: 'DUP_POS', half: 'L', row: 0, col: 0 });
  const a = analyzeMatrix(cfg);
  assert(!a.valid, '必须判为无效');
  const iss = findIssue(a, 'key-duplicate-position', (i) => i.half === 'L' && i.row === 0 && i.col === 0);
  assert(iss, '应报 key-duplicate-position@L(1,1)');
  assert(/左半区/.test(iss.message) && /\(行1,列1\)/.test(iss.message), '消息要说明位置：' + iss.message);
});
check('重复键位名（即便坐标不同）被拦下', () => {
  const cfg = baseConfig();
  cfg.keys.push({ name: 'K_L_0_0', half: 'R', row: 0, col: 0 });
  const a = analyzeMatrix(cfg);
  assert(!a.valid, '必须判为无效');
  assert(findIssue(a, 'key-duplicate-name'), '应报 key-duplicate-name');
});

console.log('\n[3] 越界与半区');
check('行坐标越界被拦下并给出允许范围', () => {
  const cfg = baseConfig();
  cfg.keys[0] = { name: 'OUT', half: 'L', row: 9, col: 0 };
  const a = analyzeMatrix(cfg);
  const iss = findIssue(a, 'key-out-of-bounds', (i) => i.keys?.includes('OUT'));
  assert(iss, '应报 key-out-of-bounds');
  assert(/允许范围/.test(iss.message), '消息要含允许范围');
});
check('一体开发板登记右半区键被拦下', () => {
  const cfg = baseConfig({
    boardId: 'promicro-atmega32u4', split: false, rows: 2, cols: 2,
    keys: [...fullKeys(2, 2, ['L']), { name: 'RR', half: 'R', row: 0, col: 0 }],
  });
  const a = analyzeMatrix(cfg);
  assert(findIssue(a, 'key-out-of-bounds', (i) => i.half === 'R'), '应报右半区越界');
});

console.log('\n[4] 空行 / 空列 / 空半区 / 漏键');
check('整行为空 → empty-row 且定位到行号', () => {
  const keys = fullKeys(3, 4).filter((k) => !(k.half === 'L' && k.row === 1));
  const a = analyzeMatrix(baseConfig({ keys }));
  const iss = findIssue(a, 'empty-row', (i) => i.half === 'L' && i.row === 1);
  assert(iss, '应报左半区第 2 行为空');
  assert(!findIssue(a, 'missing-key'), '整行缺失不应同时算内部漏键');
});
check('整列为空 → empty-col 且定位到列号', () => {
  const keys = fullKeys(3, 4).filter((k) => !(k.half === 'L' && k.col === 2));
  const a = analyzeMatrix(baseConfig({ keys }));
  assert(findIssue(a, 'empty-col', (i) => i.half === 'L' && i.col === 2), '应报左半区第 3 列为空');
});
check('行列都还有别的键的单个空格 → missing-key 漏键', () => {
  const keys = fullKeys(3, 4).filter((k) => !(k.half === 'L' && k.row === 1 && k.col === 1));
  const a = analyzeMatrix(baseConfig({ keys }));
  const iss = findIssue(a, 'missing-key', (i) => i.half === 'L');
  assert(iss && /\(行2,列2\)/.test(iss.message), '应定位到 (行2,列2)：' + iss?.message);
});
check('某半区一个键都没有 → empty-half', () => {
  const keys = fullKeys(3, 4, ['L']);
  const a = analyzeMatrix(baseConfig({ keys }));
  assert(findIssue(a, 'empty-half', (i) => i.half === 'R'), '应报右半区为空');
});
check('登记期望键数与实际不符 → missing-key 并说明差几个', () => {
  const cfg = baseConfig({ expectedKeyCount: 25 });
  const a = analyzeMatrix(cfg);
  const iss = findIssue(a, 'missing-key', (i) => /期望键数/.test(i.message));
  assert(iss && /少 1 个/.test(iss.message), '应说明实际 24 比期望 25 少 1：' + iss?.message);
});
check('行列数非法 → dimension-invalid', () => {
  const cfg = baseConfig({ rows: 0, cols: 4 });
  const a = analyzeMatrix(cfg);
  assert(findIssue(a, 'dimension-invalid'), '应报 dimension-invalid');
});

console.log('\n[5] 无二极管：三键串扰（ghosting）');
check('2×2 按下三角三键 → 标出第 4 格幽灵键与三键名称', () => {
  const keys = [
    { name: 'A', half: 'L', row: 0, col: 0 },
    { name: 'B', half: 'L', row: 0, col: 1 },
    { name: 'C', half: 'L', row: 1, col: 0 },
  ];
  const cfg = baseConfig({ rows: 2, cols: 2, keys, diodeMode: 'none' });
  const a = analyzeMatrix(cfg);
  const g = findIssue(a, 'ghost-triplet');
  assert(g, '应报 ghost-triplet');
  assert(g.keys.length === 3 && g.keys.includes('A') && g.keys.includes('B') && g.keys.includes('C'),
    '应列出 3 个键名：' + JSON.stringify(g.keys));
  assert(/幽灵键 \(行2,列2\)/.test(g.message), '应指出幽灵格：' + g.message);
});
check('4 格全按下时不存在该组串扰（警告级别且不阻断保存）', () => {
  const keys = fullKeys(2, 3); // 铺满
  const cfg = baseConfig({ rows: 2, cols: 3, keys, diodeMode: 'none' });
  const a = analyzeMatrix(cfg);
  assert(!findIssue(a, 'ghost-triplet'), '满格不应报串扰');
});

console.log('\n[6] 二极管：方向不一致 / 反接风险');
check('2 个以上反方向键 → diode-direction-mismatch', () => {
  const keys = fullKeys(3, 4, ['L', 'R'], {
    reverse: (h, r, c) => h === 'L' && ((r === 0 && c === 0) || (r === 0 && c === 1)),
  });
  const a = analyzeMatrix(baseConfig({ keys }));
  const ms = a.issues.filter((i) => i.code === 'diode-direction-mismatch');
  assert(ms.length === 2, `应有 2 条不一致，实际 ${ms.length}`);
  assert(ms.every((i) => /行 → 列|行→列|ROW2COL/.test(i.message)), '消息要标出方向');
});
check('唯一 1 个反向键 → diode-reverse-risk 疑似反接', () => {
  const keys = fullKeys(3, 4, ['L', 'R'], {
    reverse: (h, r, c) => h === 'R' && r === 2 && c === 3,
  });
  const a = analyzeMatrix(baseConfig({ keys }));
  const risk = a.issues.filter((i) => i.code === 'diode-reverse-risk');
  assert(risk.length === 1, `应只有 1 条反接风险，实际 ${risk.length}`);
  assert(/疑似该键二极管反接/.test(risk[0].message), '消息要提示反接：' + risk[0].message);
  assert(a.valid, '警告不应阻断保存');
});
check('方向全一致时零警告', () => {
  const a = analyzeMatrix(baseConfig());
  assert(!a.issues.some((i) => i.code.startsWith('diode')), '不应有二极管问题');
});

console.log('\n[7] 引脚：非法 / 禁用 / 重复 / 缺失');
check('不在开发板清单内的引脚 → pin-illegal', () => {
  const cfg = baseConfig();
  setPin(cfg, 'L', 'rowPins', 0, 'GP99');
  const a = analyzeMatrix(cfg);
  assert(findIssue(a, 'pin-illegal', (i) => i.pin === 'GP99'), '应报 GP99 非法');
});
check('禁用脚 → pin-disabled 并附原因', () => {
  const cfg = baseConfig();
  setPin(cfg, 'L', 'colPins', 0, 'GP25');
  const a = analyzeMatrix(cfg);
  const iss = findIssue(a, 'pin-disabled', (i) => i.pin === 'GP25');
  assert(iss, '应报 GP25 被禁用');
  assert(/状态灯|电源|检测/.test(iss.message), '消息要解释禁用原因');
});
check('同一半区行列共用引脚 → pin-duplicate', () => {
  const cfg = baseConfig();
  setPin(cfg, 'L', 'colPins', 0, cfg.pins.find((p) => p.half === 'L').rowPins[0]);
  const a = analyzeMatrix(cfg);
  assert(findIssue(a, 'pin-duplicate'), '应报引脚重复');
});
check('两个半区允许使用相同引脚（各自独立控制器）', () => {
  const a = analyzeMatrix(baseConfig());
  const L = a.config.pins.find((p) => p.half === 'L');
  const R = a.config.pins.find((p) => p.half === 'R');
  assert(JSON.stringify(L.rowPins) === JSON.stringify(R.rowPins), '分体左右引脚应相互独立、可同名');
});
check('未分配的线 → pin-missing 并指出是哪条线', () => {
  const cfg = baseConfig();
  setPin(cfg, 'R', 'colPins', 2, '');
  const a = analyzeMatrix(cfg);
  const iss = findIssue(a, 'pin-missing', (i) => /列线 C 2/.test(i.message) && i.half === 'R');
  assert(iss, '应报右半区列线 C2 缺失：' + a.issues.map((i) => i.message).join(' / '));
});

console.log('\n[8] 自动分配：固定顺序 / 不重复 / 非禁用 / 无解');
check('固定顺序 R0..Rn → C0..Cn，结果确定且不重复非禁用', () => {
  const r1 = autoAssignPins(3, 4, true, RP.id);
  const r2 = autoAssignPins(3, 4, true, RP.id);
  assert(JSON.stringify(r1) === JSON.stringify(r2), '两次分配必须完全一致');
  const L = r1.pins.find((p) => p.half === 'L');
  assert(JSON.stringify(L.rowPins) === JSON.stringify(['GP0', 'GP1', 'GP2']),
    '行线应为 GP0~GP2：' + L.rowPins);
  assert(JSON.stringify(L.colPins) === JSON.stringify(['GP3', 'GP4', 'GP5', 'GP6']),
    '列线应接 GP3~GP6：' + L.colPins);
  const all = [...L.rowPins, ...L.colPins];
  assert(new Set(all).size === all.length, '引脚不得重复');
  assert(all.every((p) => RP.pinOrder.includes(p) && !RP.disabledPins.includes(p)),
    '必须在清单内且非禁用');
  assert(r1.suggestions.length === 0, '充足时不应有放宽建议');
});
check('RP2040 14+14=28 > 26 可用 → 无解并给出最少放开 GP23、GP24', () => {
  const r = autoAssignPins(14, 14, true, RP.id);
  assert(r.pins.length === 2, '分体板两个半区各算一次');
  assert(r.suggestions.length === 2, '左右半区各应有 1 条放宽建议');
  for (const s of r.suggestions) {
    assert(s.available === 26 && s.required === 28, `可用 26 / 需要 28，实际 ${s.available}/${s.required}`);
    assert(JSON.stringify(s.unblockPins) === JSON.stringify(['GP23', 'GP24']),
      '最少放宽应为固定顺序前 2 个禁用脚 GP23、GP24：' + s.unblockPins);
  }
  const cfg = baseConfig({ rows: 14, cols: 14, keys: fullKeys(14, 14), pins: r.pins });
  const a = analyzeMatrix(cfg);
  assert(findIssue(a, 'no-solution'), '分析应报 no-solution');
  assert(/最少放宽/.test(a.issues.find((i) => i.code === 'no-solution').message), '无解消息须说明最少放宽');
});
check('Pro Micro 8+8=16 恰好等于可用脚数，可分配（18 脚中 D0/D1 禁用）', () => {
  const r = autoAssignPins(8, 8, false, PM.id);
  assert(r.suggestions.length === 0, '8+8=16 应恰好可分配');
  const L = r.pins[0];
  assert(L.rowPins.length === 8 && L.colPins.length === 8, '行列线数应齐全');
  assert(![...L.rowPins, ...L.colPins].includes('D0'), '禁用脚 D0 不应被分配');
});
check('超过开发板总引脚数时 unblockPins 只列得出的候选（如实说明无候选）', () => {
  const r = autoAssignPins(20, 20, false, 'blackpill-stm32f401');
  const s = r.suggestions[0];
  assert(s.required === 40 && s.available === 29, `应为 29/40，实际 ${s.available}/${s.required}`);
  assert(s.unblockPins.length === 6, '只有 6 个禁用脚可放开，不能虚构引脚');
});

console.log('\n[9] 调整后重算 / 板型切换裁剪');
check('切换到一体板：引脚槽位收敛为左半区、右半区键被剔除', () => {
  const split = baseConfig(); // 3×4 分体
  const switched = reshapePins({ ...split, boardId: PM.id, split: false });
  assert(switched.pins.length === 1 && switched.pins[0].half === 'L', '只保留左半区引脚');
  assert(switched.keys.every((k) => k.half !== 'R'), '右半区键应被剔除');
});
check('行列缩小时引脚数组同步截断（调整后重算）', () => {
  const cfg = baseConfig();
  const shrunk = withAutoAssignedPins({ ...reshapePins({ ...cfg, rows: 2, cols: 3 }) });
  const L = shrunk.pins.find((p) => p.half === 'L');
  assert(L.rowPins.length === 2 && L.colPins.length === 3, '应重算为 2 行 3 列');
  assert(analyzeMatrix({ ...shrunk, keys: fullKeys(2, 3) }).valid,
    '缩到 2×3 且铺满后应通过');
});

console.log('\n[10] 坏数据兼容（旧功能与原有数据不受影响）');
check('normalizeMatrixConfig：非对象 / 损坏结构返回 null', () => {
  assert(normalizeMatrixConfig(null) === null, 'null → null');
  assert(normalizeMatrixConfig('garbage') === null, '字符串 → null');
  assert(normalizeMatrixConfig(42) === null, '数字 → null');
});
check('normalizeMatrixConfig：剔除坏键、补齐引脚槽位，保留好数据', () => {
  const m = normalizeMatrixConfig({
    boardId: RP.id, rows: 2, cols: 2, split: false, diodeMode: 'per-key',
    diodeDirection: 'row2col',
    keys: [
      { name: '', half: 'L', row: 0, col: 0 },          // 无名 → 剔除
      { name: 'BAD', half: 'X', row: 0, col: 0 },        // 坏半区 → 剔除
      { name: 'OK', half: 'L', row: 0, col: 0 },
    ],
    pins: 'broken',
  });
  assert(m && m.keys.length === 1 && m.keys[0].name === 'OK', '只保留合法键');
  assert(m.pins.length === 1 && Array.isArray(m.pins[0].rowPins), '引脚槽位被补齐');
  assert(m.diodeDirection === 'row2col', '整体方向保留');
});
check('旧记录（无 matrixCheck 字段）导入完全不受影响', () => {
  const legacy = {
    id: 'old-1', name: '老键盘', brand: 'B', model: 'M', purchaseDate: '2024-01-01',
    overallRating: 7, switchName: '红轴', switchType: 'linear', switchLubed: '无',
    keycapMaterial: 'PBT', keycapProfile: 'Cherry', keycapProcess: '二色',
    plateMaterial: '铝', plateThickness: '1.5mm', fillMaterial: 'PORON',
    caseMaterial: '铝合金', soundCharacter: 'deep', soundTags: ['麻将音'],
    reboundRating: 6, tactilityRating: 5, fatigueRating: 4, notes: '',
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  };
  const parsed = ie.parseImportData(JSON.stringify([legacy]), []);
  assert(parsed.totalParsed === 1 && parsed.fileValidLogs.length === 1, '旧记录应正常解析');
  assert(parsed.fileValidLogs[0].matrixCheck === undefined, '旧记录不应被强加矩阵字段');
  assert(parsed.fileValidLogs[0].soundTags[0] === '麻将音', '旧字段原样保留');
});
check('带矩阵配置的导出信封可往返，且坏矩阵被规整而不拖垮记录', () => {
  const matrixConfig = {
    ...baseConfig(),
    updatedAt: '2025-02-02T00:00:00.000Z',
  };
  matrixConfig.keys = fullKeys(3, 4);
  const good = {
    id: 'new-1', name: '新键盘', brand: 'B', model: 'X', purchaseDate: '2025-02-02',
    overallRating: 8, switchName: '磁轴', switchType: 'linear', switchLubed: '薄',
    keycapMaterial: 'PBT', keycapProfile: 'OEM', keycapProcess: '热升华',
    plateMaterial: 'PC/FR4', plateThickness: '1.2mm', fillMaterial: '硅胶',
    caseMaterial: '塑料', soundCharacter: 'neutral', soundTags: [],
    reboundRating: 8, tactilityRating: 3, fatigueRating: 3, notes: '',
    createdAt: '2025-02-02T00:00:00.000Z', updatedAt: '2025-02-02T00:00:00.000Z',
    matrixCheck: matrixConfig,
  };
  const envelope = ie.buildExportEnvelope([good]);
  const back = ie.parseImportData(JSON.stringify(envelope), []);
  assert(back.fileValidLogs.length === 1, '应解析 1 条');
  const m = back.fileValidLogs[0].matrixCheck;
  assert(m && m.rows === 3 && m.cols === 4 && m.keys.length === 24,
    '矩阵数据应完整往返（' + (m ? `${m.rows}x${m.cols}/${m.keys?.length}` : 'missing') + '）');
  assert(m.pins.length === 2 && m.pins[0].rowPins.length === 3, '左右半区引脚应一同往返');
});

console.log('\n[11] 各开发板预设合理性');
check('所有预设：固定顺序无重复、禁用脚都在清单内、可用脚为正', () => {
  for (const p of mx.BOARD_PRESETS) {
    assert(new Set(p.pinOrder).size === p.pinOrder.length, `${p.id} 固定顺序有重复`);
    assert(p.disabledPins.every((d) => p.pinOrder.includes(d)), `${p.id} 禁用脚不在清单：${p.disabledPins}`);
    assert(p.pinOrder.length - p.disabledPins.length > 0, `${p.id} 应有可用脚`);
  }
});

/* ------------------------------------------------------------------ */

rmSync(tmp, { recursive: true, force: true });

console.log(`\n========================================`);
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('全部验证通过 ✅');
}

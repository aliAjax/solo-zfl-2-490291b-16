import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Plus, Trash2, Cpu, Grid3X3, Zap, Save, History, RotateCcw,
  AlertTriangle, ShieldAlert, CheckCircle2, ArrowRightLeft, ChevronDown,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type {
  DiodeDirection, HalfId, IssueLevel, MatrixConfig, MatrixIssue, MatrixKey, PinAssignment,
} from '@/types';
import {
  BOARD_PRESETS, MATRIX_DIMS_MAX, MATRIX_DIMS_MIN,
  analyzeMatrix, autoAssignPins, coordLabel, createDefaultMatrixConfig,
  halfLabel, normalizeMatrixConfig, reshapePins, withAutoAssignedPins,
} from '@/utils/matrix';
import { formatDate } from '@/utils/helpers';

const HALVES: HalfId[] = ['L', 'R'];

const LEVEL_STYLE: Record<IssueLevel, { icon: typeof AlertTriangle; cls: string; label: string }> = {
  error: { icon: ShieldAlert, cls: 'text-wine-400 border-wine-500/25 bg-wine-500/10', label: '错误' },
  warning: { icon: AlertTriangle, cls: 'text-brass-200 border-brass-300/25 bg-brass-300/10', label: '警告' },
};

/** 丢弃键名为空的草稿行；坐标非法但有名字的行保留，交给引擎报错 */
function draftToAnalysisConfig(config: MatrixConfig): MatrixConfig {
  return {
    ...config,
    keys: config.keys.filter(
      (k) => k.name.trim() !== '' && Number.isInteger(k.row) && Number.isInteger(k.col),
    ),
  };
}

export default function MatrixCheckModal() {
  const {
    ui, logs, closeMatrixCheck, saveMatrixCheck, restoreMatrixBackup, matrixBackups,
  } = useAppStore();
  const log = logs.find((l) => l.id === ui.matrixCheckLogId) ?? null;

  const [config, setConfig] = useState<MatrixConfig | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (log) {
      const stored = normalizeMatrixConfig(log.matrixCheck);
      const base = stored
        ? reshapePins(stored)
        : withAutoAssignedPins(createDefaultMatrixConfig());
      setConfig(base);
      setAttempted(false);
    } else {
      setConfig(null);
    }
  }, [log?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && log) closeMatrixCheck();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [log, closeMatrixCheck]);

  const analysis = useMemo(
    () => (config ? analyzeMatrix(draftToAnalysisConfig(config)) : null),
    [config],
  );

  if (!log || !config || !analysis) return null;

  const preset = analysis.preset ?? BOARD_PRESETS[0];
  const activeHalves: HalfId[] = config.split ? HALVES : ['L'];
  const backups = matrixBackups[log.id] ?? [];
  const errors = analysis.issues.filter((i) => i.level === 'error');
  const warnings = analysis.issues.filter((i) => i.level === 'warning');
  const showErrors = attempted && errors.length > 0;

  const patch = (p: Partial<MatrixConfig>) => setConfig((c) => (c ? { ...c, ...p } : c));

  const changeBoard = (boardId: string) => {
    const nextPreset = BOARD_PRESETS.find((b) => b.id === boardId);
    if (!nextPreset) return;
    const reshaped = reshapePins({
      ...config,
      boardId,
      split: nextPreset.split,
    });
    setConfig(withAutoAssignedPins(reshaped));
  };

  const changeDims = (rows: number, cols: number) => {
    const r = Math.min(MATRIX_DIMS_MAX, Math.max(0, Math.floor(rows || 0)));
    const c = Math.min(MATRIX_DIMS_MAX, Math.max(0, Math.floor(cols || 0)));
    const reshaped = reshapePins({ ...config, rows: r, cols: c });
    const { pins } = autoAssignPins(r, c, reshaped.split, reshaped.boardId);
    // 尺寸调整后按固定顺序重算引脚（保留不了的旧值直接由重算覆盖）
    setConfig({ ...reshaped, pins });
  };

  const updateKey = (index: number, p: Partial<MatrixKey>) => {
    setConfig({
      ...config,
      keys: config.keys.map((k, i) => (i === index ? { ...k, ...p } : k)),
    });
  };

  const addKey = () => {
    const half: HalfId = config.split ? 'L' : 'L';
    setConfig({
      ...config,
      keys: [
        ...config.keys,
        { name: `K${String(config.keys.length + 1).padStart(2, '0')}`, half, row: 0, col: 0 },
      ],
    });
  };

  const removeKey = (index: number) => {
    setConfig({ ...config, keys: config.keys.filter((_, i) => i !== index) });
  };

  const updatePin = (half: HalfId, kind: 'rowPins' | 'colPins', index: number, pin: string) => {
    setConfig({
      ...config,
      pins: config.pins.map((p) => {
        if (p.half !== half) return p;
        const arr = [...p[kind]];
        while (arr.length <= index) arr.push('');
        arr[index] = pin;
        return { ...p, [kind]: arr };
      }),
    });
  };

  const handleSave = () => {
    setAttempted(true);
    const result = saveMatrixCheck(log.id, draftToAnalysisConfig(config));
    if (!result.ok) {
      document.getElementById('matrix-issue-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const handleRestore = (index: number) => {
    const result = restoreMatrixBackup(log.id, index);
    if (!result) return;
    if (!result.ok) {
      window.alert('该备份当前校验未通过，无法直接恢复：\n' +
        result.analysis.issues.filter((i) => i.level === 'error').map((i) => '· ' + i.message).join('\n'));
      return;
    }
    setConfig(result.analysis.config);
    setAttempted(false);
  };

  /* 按键表里追加一行空白草稿，方便连续录入 */
  const draftRows = [...config.keys];

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && closeMatrixCheck()}
    >
      <div className="modal-surface scrollbar-thin !max-w-5xl">
        {/* 头部 */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-ink-700/60 bg-gradient-to-b from-ink-800/98 to-ink-800/90 backdrop-blur-sm">
          <div>
            <h2 className="font-mono text-lg font-bold text-gradient-brass flex items-center gap-2">
              <Grid3X3 className="h-5 w-5" />
              配列矩阵 · 引脚检查台
            </h2>
            <p className="text-xs text-ink-500 mt-0.5">
              {log.name} · {log.brand} {log.model}
            </p>
          </div>
          <button
            onClick={closeMatrixCheck}
            className="p-2 rounded-lg text-ink-500 hover:text-ink-200 hover:bg-ink-700/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5 animate-fadeIn">
          {/* 配列设置 */}
          <section className="card-surface p-4 space-y-4">
            <h3 className="font-mono text-sm font-semibold text-brass-200 flex items-center gap-2">
              <span className="w-1 h-4 rounded bg-brass-300" />
              配列设置
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="space-y-1">
                <span className="text-[11px] font-mono uppercase tracking-wider text-ink-500">
                  开发板（每半能力）
                </span>
                <div className="relative">
                  <select
                    className="input-field appearance-none pr-8"
                    value={config.boardId}
                    onChange={(e) => changeBoard(e.target.value)}
                  >
                    {BOARD_PRESETS.map((b) => (
                      <option key={b.id} value={b.id}>{b.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="h-4 w-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
                </div>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-mono uppercase tracking-wider text-ink-500">行数</span>
                <input
                  type="number" min={MATRIX_DIMS_MIN} max={MATRIX_DIMS_MAX}
                  className="input-field"
                  value={config.rows}
                  onChange={(e) => changeDims(Number(e.target.value), config.cols)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-mono uppercase tracking-wider text-ink-500">列数</span>
                <input
                  type="number" min={MATRIX_DIMS_MIN} max={MATRIX_DIMS_MAX}
                  className="input-field"
                  value={config.cols}
                  onChange={(e) => changeDims(config.rows, Number(e.target.value))}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-mono uppercase tracking-wider text-ink-500">
                  期望键数（0=不核对）
                </span>
                <input
                  type="number" min={0} max={400}
                  className="input-field"
                  value={config.expectedKeyCount}
                  onChange={(e) =>
                    patch({ expectedKeyCount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-ink-900/80 border border-ink-700/60">
                <button
                  onClick={() => {
                    const reshaped = reshapePins({ ...config, diodeMode: 'none' });
                    setConfig(reshaped);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    config.diodeMode === 'none'
                      ? 'bg-wine-500/20 text-wine-400 border border-wine-500/30'
                      : 'text-ink-400 hover:text-ink-200'
                  }`}
                >
                  无二极管
                </button>
                <button
                  onClick={() => {
                    const reshaped = reshapePins({ ...config, diodeMode: 'per-key' });
                    setConfig(reshaped);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    config.diodeMode === 'per-key'
                      ? 'bg-moss-500/20 text-moss-400 border border-moss-500/30'
                      : 'text-ink-400 hover:text-ink-200'
                  }`}
                >
                  每键二极管
                </button>
              </div>

              {config.diodeMode === 'per-key' && (
                <label className="flex items-center gap-2 text-xs text-ink-300">
                  <Zap className="h-3.5 w-3.5 text-brass-300" />
                  整体方向
                  <div className="relative">
                    <select
                      className="input-field !py-1.5 !w-44 appearance-none pr-7 text-xs"
                      value={config.diodeDirection}
                      onChange={(e) => patch({ diodeDirection: e.target.value as DiodeDirection })}
                    >
                      <option value="col2row">列 → 行（COL2ROW）</option>
                      <option value="row2col">行 → 列（ROW2COL）</option>
                    </select>
                    <ChevronDown className="h-3.5 w-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
                  </div>
                </label>
              )}

              <span className="text-[11px] text-ink-500 inline-flex items-center gap-1">
                <Cpu className="h-3.5 w-3.5" />
                {config.split ? '分体：左右半区各一片控制器' : '一体：单片控制器（仅左半区）'}
              </span>

              <button
                onClick={() => setConfig(withAutoAssignedPins(config))}
                className="btn-ghost !py-1.5 !px-3 !text-xs ml-auto"
                title="按固定顺序 GP/D 口由低到高：R0..Rn → C0..Cn，每个半区独立"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                固定顺序自动分配引脚
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-ink-500">{preset.note}</p>
          </section>

          {/* 矩阵网格 */}
          <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {activeHalves.map((half) => (
              <MatrixGridCard
                key={half}
                half={half}
                config={config}
                occupancy={analysis.occupancy[half]}
              />
            ))}
          </section>

          {/* 按键登记 */}
          <section className="card-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-sm font-semibold text-brass-200 flex items-center gap-2">
                <span className="w-1 h-4 rounded bg-brass-300" />
                按键坐标登记
                <span className="text-xs font-normal text-ink-500">
                  （已布 {analysis.keyCount} 键{config.expectedKeyCount > 0 ? ` / 期望 ${config.expectedKeyCount}` : ''}）
                </span>
              </h3>
              <button onClick={addKey} className="btn-ghost !py-1.5 !px-3 !text-xs">
                <Plus className="h-3.5 w-3.5" />
                登记按键
              </button>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs min-w-[640px]">
                <thead>
                  <tr className="text-left text-ink-500 font-mono border-b border-ink-700/60">
                    <th className="py-2 pr-2 font-medium w-12">#</th>
                    <th className="py-2 pr-2 font-medium">键位名</th>
                    {config.split && <th className="py-2 pr-2 font-medium w-24">半区</th>}
                    <th className="py-2 pr-2 font-medium w-24">行 (1~{config.rows})</th>
                    <th className="py-2 pr-2 font-medium w-24">列 (1~{config.cols})</th>
                    {config.diodeMode === 'per-key' && (
                      <th className="py-2 pr-2 font-medium w-40">二极管方向</th>
                    )}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {draftRows.map((k, i) => {
                    const posIssue = analysis.issues.find(
                      (iss) =>
                        iss.half === k.half && iss.row === k.row && iss.col === k.col &&
                        iss.keys?.includes(k.name),
                    );
                    return (
                      <tr key={i} className="border-b border-ink-800/60">
                        <td className="py-1.5 pr-2 font-mono text-ink-600">{i + 1}</td>
                        <td className="py-1.5 pr-2">
                          <input
                            className={`input-field !py-1.5 !text-xs ${posIssue ? '!border-wine-500/60' : ''}`}
                            value={k.name}
                            onChange={(e) => updateKey(i, { name: e.target.value })}
                            placeholder="如 KC_A"
                          />
                        </td>
                        {config.split && (
                          <td className="py-1.5 pr-2">
                            <div className="relative">
                              <select
                                className="input-field !py-1.5 !text-xs appearance-none pr-6"
                                value={k.half}
                                onChange={(e) => updateKey(i, { half: e.target.value as HalfId })}
                              >
                                <option value="L">左</option>
                                <option value="R">右</option>
                              </select>
                              <ChevronDown className="h-3 w-3 absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
                            </div>
                          </td>
                        )}
                        <td className="py-1.5 pr-2">
                          <CoordInput
                            value={k.row}
                            max={config.rows}
                            invalid={!!posIssue}
                            onChange={(v) => updateKey(i, { row: v })}
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <CoordInput
                            value={k.col}
                            max={config.cols}
                            invalid={!!posIssue}
                            onChange={(v) => updateKey(i, { col: v })}
                          />
                        </td>
                        {config.diodeMode === 'per-key' && (
                          <td className="py-1.5 pr-2">
                            <div className="relative">
                              <select
                                className="input-field !py-1.5 !text-xs appearance-none pr-6"
                                value={k.diodeDirection ?? ''}
                                onChange={(e) =>
                                  updateKey(i, {
                                    diodeDirection: e.target.value
                                      ? (e.target.value as DiodeDirection)
                                      : undefined,
                                  })}
                              >
                                <option value="">继承整体</option>
                                <option value="col2row">列 → 行</option>
                                <option value="row2col">行 → 列</option>
                              </select>
                              <ChevronDown className="h-3 w-3 absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
                            </div>
                          </td>
                        )}
                        <td>
                          <button
                            onClick={() => removeKey(i)}
                            className="p-1.5 rounded-md text-ink-500 hover:text-wine-400 hover:bg-wine-500/10 transition-colors"
                            title="删除该键"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {draftRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-ink-500 text-xs">
                        还没有登记按键，点击右上角「登记按键」开始
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* 引脚分配 */}
          <section className="space-y-4">
            {activeHalves.map((half) => (
              <PinAssignCard
                key={half}
                half={half}
                config={config}
                assignment={config.pins.find((p) => p.half === half) ?? { half, rowPins: [], colPins: [] }}
                onAssign={updatePin}
                halfIssues={analysis.issues.filter((i) => i.half === half && i.code.startsWith('pin'))}
              />
            ))}
          </section>

          {/* 问题面板 */}
          <section id="matrix-issue-panel" className="card-surface p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-mono text-sm font-semibold text-brass-200 flex items-center gap-2">
                <span className="w-1 h-4 rounded bg-brass-300" />
                检查结果
              </h3>
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className={errors.length ? 'text-wine-400' : 'text-moss-400'}>
                  {errors.length} 个错误
                </span>
                <span className="text-ink-600">·</span>
                <span className={warnings.length ? 'text-brass-200' : 'text-ink-500'}>
                  {warnings.length} 个警告
                </span>
              </div>
            </div>

            {analysis.issues.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-moss-400 bg-moss-500/10 border border-moss-500/25 rounded-lg px-4 py-3">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                全部检查通过：无重复键位、无空行空列、引脚均为非禁用且不重复，
                {config.diodeMode === 'none' ? '当前未发现三键串扰结构。' : '二极管方向一致、无反接风险。'}
              </div>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin pr-1">
                {analysis.issues.map((iss, i) => {
                  const S = LEVEL_STYLE[iss.level];
                  const Icon = S.icon;
                  return (
                    <li
                      key={i}
                      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs leading-relaxed ${S.cls}`}
                    >
                      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        <span className="font-mono font-bold mr-1.5">[{S.label}]</span>
                        {iss.message}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 备份 */}
          {backups.length > 0 && (
            <section className="card-surface p-4 space-y-2">
              <h3 className="font-mono text-sm font-semibold text-brass-200 flex items-center gap-2">
                <History className="h-4 w-4" />
                历史备份（矩阵与引脚一同保存，最多 8 份）
              </h3>
              <ul className="space-y-1.5">
                {backups.map((b, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg bg-ink-900/60 border border-ink-700/60 px-3 py-2 text-xs"
                  >
                    <span className="text-ink-300 font-mono">
                      {formatDate(b.updatedAt)} {new Date(b.updatedAt).toTimeString().slice(0, 8)}
                      <span className="text-ink-500 ml-2">
                        {b.rows}×{b.cols}{b.split ? ' 分体' : ' 一体'} · {b.keys.length} 键 ·{' '}
                        {b.diodeMode === 'none' ? '无二极管' : `二极管 ${b.diodeDirection}`}
                      </span>
                    </span>
                    <button
                      onClick={() => handleRestore(i)}
                      className="inline-flex items-center gap-1 text-brass-200 hover:text-brass-100"
                    >
                      <RotateCcw className="h-3 w-3" />
                      恢复
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 底部操作 */}
          <div className="sticky bottom-0 -mx-5 sm:-mx-6 px-5 sm:px-6 py-3 border-t border-ink-700/60 bg-ink-900/90 backdrop-blur flex items-center justify-between gap-3">
            <div className="text-[11px] text-ink-500">
              {showErrors && errors.length > 0 ? (
                <span className="text-wine-400">
                  存在 {errors.length} 个阻断错误，修正后才能保存（警告不阻断）。
                </span>
              ) : (
                '保存时会先校验；旧配置自动进入该键盘的备份栈，不影响其他记录。'
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={closeMatrixCheck} className="btn-ghost !py-2 !text-xs">取消</button>
              <button
                onClick={handleSave}
                disabled={errors.length > 0}
                className={errors.length > 0 ? 'btn-primary opacity-40 cursor-not-allowed' : 'btn-primary'}
                title={errors.length > 0 ? '仍有错误未修正' : '校验通过后保存矩阵与引脚'}
              >
                <Save className="h-4 w-4" />
                保存检查
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */

function CoordInput({
  value, max, invalid, onChange,
}: {
  value: number;
  max: number;
  invalid: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={1}
      max={max}
      className={`input-field !py-1.5 !text-xs ${invalid ? '!border-wine-500/60' : ''}`}
      value={value + 1}
      onChange={(e) => onChange(Math.floor(Number(e.target.value)) - 1)}
    />
  );
}

function MatrixGridCard({
  half, config, occupancy,
}: {
  half: HalfId;
  config: MatrixConfig;
  occupancy: boolean[][];
}) {
  const halfKeys = config.keys.filter((k) => k.half === half);
  const nameAt = (r: number, c: number) =>
    halfKeys.find((k) => k.row === r && k.col === c)?.name;

  return (
    <div className="card-surface p-4 space-y-3">
      <h3 className="font-mono text-sm font-semibold text-brass-200 flex items-center gap-2">
        <span className={`w-1 h-4 rounded ${half === 'L' ? 'bg-slateblue-400' : 'bg-wine-400'}`} />
        {halfLabel(half)}矩阵
        <span className="text-xs font-normal text-ink-500">
          {config.rows} 行 × {config.cols} 列
        </span>
      </h3>
      <div className="overflow-auto scrollbar-thin">
        <div
          className="inline-grid gap-1 min-w-min"
          style={{ gridTemplateColumns: `28px repeat(${config.cols}, minmax(30px, 1fr))` }}
        >
          <div />
          {Array.from({ length: config.cols }, (_, c) => (
            <div key={`hc${c}`} className="text-center text-[10px] font-mono text-ink-600">{c + 1}</div>
          ))}
          {Array.from({ length: config.rows }, (_, r) =>
            Array.from({ length: config.cols + 1 }, (_, ci) => {
              if (ci === 0) {
                return (
                  <div key={`hr${r}`} className="flex items-center justify-center text-[10px] font-mono text-ink-600">
                    {r + 1}
                  </div>
                );
              }
              const c = ci - 1;
              const on = occupancy[r]?.[c];
              const name = on ? nameAt(r, c) : undefined;
              const isInteriorHole = !on &&
                halfKeys.some((k) => k.row === r) && halfKeys.some((k) => k.col === c);
              return (
                <div
                  key={`${r}-${c}`}
                  title={on ? `${name ?? ''} ${coordLabel(r, c)}` : isInteriorHole ? `疑似漏键 ${coordLabel(r, c)}` : coordLabel(r, c)}
                  className={`h-8 min-w-[30px] rounded-md flex items-center justify-center text-[10px] font-mono border transition-colors ${
                    on
                      ? 'bg-gradient-to-b from-moss-500/40 to-moss-600/30 border-moss-500/50 text-moss-400 font-bold'
                      : isInteriorHole
                        ? 'bg-wine-500/10 border-wine-500/40 border-dashed text-wine-400'
                        : 'bg-ink-900/50 border-ink-700/50 text-ink-700'
                  }`}
                >
                  {on ? (name && name.length <= 4 ? name : '●') : isInteriorHole ? '?' : ''}
                </div>
              );
            }),
          )}
        </div>
      </div>
      <p className="text-[11px] text-ink-500">
        <span className="inline-block w-2.5 h-2.5 rounded bg-moss-500/50 border border-moss-500/50 mr-1 align-middle" />
        已布键
        <span className="inline-block w-2.5 h-2.5 rounded ml-3 mr-1 align-middle border border-dashed border-wine-500/50 bg-wine-500/10" />
        疑似漏键（行列均有其他键的空格）
      </p>
    </div>
  );
}

function PinAssignCard({
  half, config, assignment, onAssign, halfIssues,
}: {
  half: HalfId;
  config: MatrixConfig;
  assignment: PinAssignment;
  onAssign: (half: HalfId, kind: 'rowPins' | 'colPins', index: number, pin: string) => void;
  halfIssues: MatrixIssue[];
}) {
  const preset = BOARD_PRESETS.find((b) => b.id === config.boardId);
  const issueFor = (lineLabel: string, index: number) =>
    halfIssues.find((i) => i.message.includes(`${lineLabel} ${index}`));

  const renderLine = (kind: 'rowPins' | 'colPins', count: number, lineLabel: string) => (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: count }, (_, i) => {
        const value = assignment[kind][i] ?? '';
        const iss = issueFor(lineLabel, i);
        return (
          <label key={i} className="flex flex-col gap-1" title={iss?.message}>
            <span className={`text-[10px] font-mono text-center ${iss ? 'text-wine-400' : 'text-ink-500'}`}>
              {lineLabel}{i}
            </span>
            <div className="relative">
              <select
                className={`input-field !py-1.5 !px-2 !pr-6 !text-[11px] !w-[88px] appearance-none ${
                  iss ? '!border-wine-500/60' : ''
                }`}
                value={value}
                onChange={(e) => onAssign(half, kind, i, e.target.value)}
              >
                <option value="">—</option>
                {preset?.pinOrder.map((p) => {
                  const disabled = preset.disabledPins.includes(p);
                  return (
                    <option key={p} value={p} disabled={disabled}>
                      {p}{disabled ? '（禁用）' : ''}
                    </option>
                  );
                })}
              </select>
              <ChevronDown className="h-3 w-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
            </div>
          </label>
        );
      })}
    </div>
  );

  return (
    <div className="card-surface p-4 space-y-3">
      <h3 className="font-mono text-sm font-semibold text-brass-200 flex items-center gap-2">
        <Cpu className="h-4 w-4" />
        {halfLabel(half)}引脚分配
        <span className="text-xs font-normal text-ink-500">
          固定顺序：R0→R{Math.max(config.rows - 1, 0)}，再 C0→C{Math.max(config.cols - 1, 0)}
        </span>
      </h3>
      <div className="space-y-2.5">
        {renderLine('rowPins', config.rows, '行线 R')}
        {renderLine('colPins', config.cols, '列线 C')}
      </div>
    </div>
  );
}

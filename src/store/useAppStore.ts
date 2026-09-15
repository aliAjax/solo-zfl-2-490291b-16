import { create } from 'zustand';
import type { KeyboardLog, FilterState, UIState, ViewMode, MatrixConfig } from '@/types';
import { sampleData } from '@/data/sampleData';
import type { ImportApplyResult, ValidatedLog } from '@/utils/importExport';
import { applyImport, genNewId } from '@/utils/importExport';
import { analyzeMatrix, normalizeMatrixConfig } from '@/utils/matrix';
import type { MatrixAnalysis } from '@/types';

const STORAGE_KEY = 'keyfeeling-logs-v1';
const MATRIX_BACKUP_KEY = 'keyfeeling-matrix-backups-v1';
const MATRIX_BACKUP_LIMIT = 8;

type BackupMap = Record<string, MatrixConfig[]>;

function loadBackups(): BackupMap {
  try {
    const raw = localStorage.getItem(MATRIX_BACKUP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as BackupMap;
  } catch {
    return {};
  }
}

function persistBackups(backups: BackupMap) {
  try {
    localStorage.setItem(MATRIX_BACKUP_KEY, JSON.stringify(backups));
  } catch {
    // ignore
  }
}

function migrateMatrixField(log: Record<string, unknown>): KeyboardLog {
  const normalized = normalizeMatrixConfig(log.matrixCheck);
  return (normalized ? { ...log, matrixCheck: normalized } : { ...log, matrixCheck: undefined }) as KeyboardLog;
}

function loadFromStorage(): KeyboardLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sampleData));
      return sampleData;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((l) => migrateMatrixField(l as Record<string, unknown>));
    }
    return sampleData;
  } catch {
    return sampleData;
  }
}

function saveToStorage(logs: KeyboardLog[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch {
    // ignore
  }
}

function genId() {
  return genNewId();
}

interface AppState {
  logs: KeyboardLog[];
  filter: FilterState;
  ui: UIState;
  matrixBackups: BackupMap;
  setFilter: (patch: Partial<FilterState>) => void;
  resetFilter: () => void;
  createLog: (data: Omit<KeyboardLog, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateLog: (id: string, data: Partial<KeyboardLog>) => void;
  deleteLog: (id: string) => void;
  importLogs: (
    selectedForImport: string[],
    fileValidLogs: KeyboardLog[],
    duplicateWithExisting: ValidatedLog[],
    strategy: 'skip' | 'overwrite' | 'regenerate',
  ) => ImportApplyResult;
  setViewMode: (mode: ViewMode) => void;
  toggleCompareSelect: (id: string) => void;
  clearCompareSelect: () => void;
  openFormModal: (log?: KeyboardLog | null) => void;
  closeFormModal: () => void;
  openDetail: (log: KeyboardLog) => void;
  closeDetail: () => void;
  openImportExport: () => void;
  closeImportExport: () => void;
  openMatrixCheck: (log: KeyboardLog) => void;
  closeMatrixCheck: () => void;
  /** 校验通过才保存；保存前把旧配置推入该日志的备份栈（最多 8 份） */
  saveMatrixCheck: (logId: string, config: MatrixConfig) => MatrixSaveResult;
  /** 恢复某份历史配置（当前配置先入备份栈），返回恢复后的分析 */
  restoreMatrixBackup: (logId: string, index: number) => MatrixSaveResult | null;
  getMatrixBackups: (logId: string) => MatrixConfig[];
}

export interface MatrixSaveResult {
  ok: boolean;
  analysis: MatrixAnalysis;
}

const defaultFilter: FilterState = {
  switchType: 'all',
  soundCharacter: 'all',
  minRating: 0,
  searchKeyword: '',
};

const defaultUI: UIState = {
  viewMode: 'list',
  selectedForCompare: [],
  formModalOpen: false,
  editingLog: null,
  detailLog: null,
  importExportModalOpen: false,
  matrixCheckLogId: null,
};

export const useAppStore = create<AppState>((set, get) => ({
  logs: loadFromStorage(),
  filter: defaultFilter,
  ui: defaultUI,
  matrixBackups: loadBackups(),

  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  resetFilter: () => set({ filter: defaultFilter }),

  createLog: (data) => {
    const now = new Date().toISOString();
    const newLog: KeyboardLog = {
      ...data,
      id: genId(),
      createdAt: now,
      updatedAt: now,
    };
    const next = [newLog, ...get().logs];
    set({ logs: next, ui: { ...get().ui, formModalOpen: false, editingLog: null } });
    saveToStorage(next);
  },

  updateLog: (id, data) => {
    const next = get().logs.map((l) =>
      l.id === id ? { ...l, ...data, updatedAt: new Date().toISOString() } : l,
    );
    set({ logs: next, ui: { ...get().ui, formModalOpen: false, editingLog: null } });
    saveToStorage(next);
  },

  deleteLog: (id) => {
    const next = get().logs.filter((l) => l.id !== id);
    const selected = get().ui.selectedForCompare.filter((sid) => sid !== id);
    set({
      logs: next,
      ui: {
        ...get().ui,
        selectedForCompare: selected,
        detailLog: null,
        matrixCheckLogId: get().ui.matrixCheckLogId === id ? null : get().ui.matrixCheckLogId,
      },
    });
    saveToStorage(next);
    const backups = get().matrixBackups;
    if (backups[id]) {
      const nextBackups = { ...backups };
      delete nextBackups[id];
      set({ matrixBackups: nextBackups });
      persistBackups(nextBackups);
    }
  },

  importLogs: (selectedForImport, fileValidLogs, duplicateWithExisting, strategy) => {
    const result = applyImport(
      get().logs,
      selectedForImport,
      fileValidLogs,
      duplicateWithExisting,
      strategy,
    );
    set({ logs: result.finalLogs });
    saveToStorage(result.finalLogs);
    return result;
  },

  setViewMode: (mode) => set({ ui: { ...get().ui, viewMode: mode } }),

  toggleCompareSelect: (id) => {
    const cur = get().ui.selectedForCompare;
    let next: string[];
    if (cur.includes(id)) {
      next = cur.filter((x) => x !== id);
    } else if (cur.length >= 2) {
      next = [cur[1], id];
    } else {
      next = [...cur, id];
    }
    set({ ui: { ...get().ui, selectedForCompare: next } });
  },

  clearCompareSelect: () =>
    set({ ui: { ...get().ui, selectedForCompare: [], viewMode: 'list' } }),

  openFormModal: (log) =>
    set({ ui: { ...get().ui, formModalOpen: true, editingLog: log ?? null } }),
  closeFormModal: () => set({ ui: { ...get().ui, formModalOpen: false, editingLog: null } }),

  openDetail: (log) => set({ ui: { ...get().ui, detailLog: log } }),
  closeDetail: () => set({ ui: { ...get().ui, detailLog: null } }),

  openImportExport: () => set({ ui: { ...get().ui, importExportModalOpen: true } }),
  closeImportExport: () => set({ ui: { ...get().ui, importExportModalOpen: false } }),

  openMatrixCheck: (log) => set({ ui: { ...get().ui, matrixCheckLogId: log.id } }),
  closeMatrixCheck: () => set({ ui: { ...get().ui, matrixCheckLogId: null } }),

  saveMatrixCheck: (logId, config) => {
    const analysis = analyzeMatrix(config);
    if (!analysis.valid) return { ok: false, analysis };

    const stamp = new Date().toISOString();
    const finalConfig: MatrixConfig = { ...config, updatedAt: stamp };

    // 备份旧配置（矩阵与引脚一起入栈），新配置首次保存无需备份
    const backups = { ...get().matrixBackups };
    const target = get().logs.find((l) => l.id === logId);
    if (target?.matrixCheck) {
      const stack = [...(backups[logId] ?? [])];
      if (JSON.stringify(stack[0]) !== JSON.stringify(target.matrixCheck)) {
        stack.unshift(target.matrixCheck);
      }
      backups[logId] = stack.slice(0, MATRIX_BACKUP_LIMIT);
    }

    const next = get().logs.map((l) =>
      l.id === logId ? { ...l, matrixCheck: finalConfig, updatedAt: stamp } : l,
    );
    set({
      logs: next,
      matrixBackups: backups,
      ui: { ...get().ui, matrixCheckLogId: null },
    });
    saveToStorage(next);
    persistBackups(backups);
    return { ok: true, analysis: analyzeMatrix(finalConfig) };
  },

  restoreMatrixBackup: (logId, index) => {
    const stack = get().matrixBackups[logId] ?? [];
    const backup = stack[index];
    if (!backup) return null;

    const target = get().logs.find((l) => l.id === logId);
    const analysis = analyzeMatrix(backup);
    if (!analysis.valid) return { ok: false, analysis };

    const stamp = new Date().toISOString();
    const backups = { ...get().matrixBackups };
    const newStack = [...stack];
    if (target?.matrixCheck) {
      newStack.splice(index, 1);
      newStack.unshift(target.matrixCheck);
    } else {
      newStack.splice(index, 1);
    }
    backups[logId] = newStack.slice(0, MATRIX_BACKUP_LIMIT);

    const finalConfig: MatrixConfig = { ...backup, updatedAt: stamp };
    const next = get().logs.map((l) =>
      l.id === logId ? { ...l, matrixCheck: finalConfig, updatedAt: stamp } : l,
    );
    set({ logs: next, matrixBackups: backups });
    saveToStorage(next);
    persistBackups(backups);
    return { ok: true, analysis: analyzeMatrix(finalConfig) };
  },

  getMatrixBackups: (logId) => get().matrixBackups[logId] ?? [],
}));

export function useFilteredLogs(): KeyboardLog[] {
  const { logs, filter } = useAppStore();
  const { switchType, soundCharacter, minRating, searchKeyword } = filter;
  const kw = searchKeyword.trim().toLowerCase();
  return logs.filter((log) => {
    if (switchType !== 'all' && log.switchType !== switchType) return false;
    if (soundCharacter !== 'all' && log.soundCharacter !== soundCharacter) return false;
    if (log.overallRating < minRating) return false;
    if (kw) {
      const haystack = [
        log.name,
        log.brand,
        log.model,
        log.switchName,
        log.notes,
        log.keycapProcess,
        ...log.soundTags,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
}

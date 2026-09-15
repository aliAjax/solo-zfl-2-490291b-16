export type SwitchType = 'linear' | 'tactile' | 'clicky' | 'other';
export type SoundCharacter = 'deep' | 'bright' | 'muffled' | 'neutral';
export type KeycapMaterial = 'ABS' | 'PBT' | 'PC' | '混合' | '其他';
export type KeycapProfile = 'Cherry' | 'SA' | 'DSA' | 'OEM' | 'XDA' | 'KAT' | 'MT3' | '其他';
export type PlateMaterial = '铝' | '铜' | '钢' | 'PC/FR4' | '碳纤维' | '塑料' | '其他';
export type CaseMaterial = '铝合金' | '塑料' | '木头' | '亚克力' | '黄铜' | '不锈钢' | '其他';

export interface KeyboardLog {
  id: string;
  name: string;
  brand: string;
  model: string;
  purchaseDate: string;
  overallRating: number;
  switchName: string;
  switchType: SwitchType;
  switchLubed: string;
  keycapMaterial: KeycapMaterial;
  keycapProfile: KeycapProfile;
  keycapProcess: string;
  plateMaterial: PlateMaterial;
  plateThickness: string;
  fillMaterial: string;
  caseMaterial: CaseMaterial;
  soundCharacter: SoundCharacter;
  soundTags: string[];
  reboundRating: number;
  tactilityRating: number;
  fatigueRating: number;
  notes: string;
  /** 配列矩阵与引脚检查台数据（旧记录可能没有，读取时按无配置处理） */
  matrixCheck?: MatrixConfig;
  createdAt: string;
  updatedAt: string;
}

export interface FilterState {
  switchType: SwitchType | 'all';
  soundCharacter: SoundCharacter | 'all';
  minRating: number;
  searchKeyword: string;
}

export type ViewMode = 'list' | 'compare' | 'stats';

export interface UIState {
  viewMode: ViewMode;
  selectedForCompare: string[];
  formModalOpen: boolean;
  editingLog: KeyboardLog | null;
  detailLog: KeyboardLog | null;
  importExportModalOpen: boolean;
  matrixCheckLogId: string | null;
}

export const SWITCH_TYPE_LABELS: Record<SwitchType, string> = {
  linear: '线性轴',
  tactile: '段落轴',
  clicky: '点击轴',
  other: '其他',
};

export const SOUND_CHARACTER_LABELS: Record<SoundCharacter, string> = {
  deep: '低沉',
  bright: '清脆',
  muffled: '闷响',
  neutral: '中性',
};

export const SWITCH_TYPES: SwitchType[] = ['linear', 'tactile', 'clicky', 'other'];
export const SOUND_CHARACTERS: SoundCharacter[] = ['deep', 'bright', 'muffled', 'neutral'];
export const KEYCAP_MATERIALS: KeycapMaterial[] = ['ABS', 'PBT', 'PC', '混合', '其他'];
export const KEYCAP_PROFILES: KeycapProfile[] = ['Cherry', 'SA', 'DSA', 'OEM', 'XDA', 'KAT', 'MT3', '其他'];
export const PLATE_MATERIALS: PlateMaterial[] = ['铝', '铜', '钢', 'PC/FR4', '碳纤维', '塑料', '其他'];
export const CASE_MATERIALS: CaseMaterial[] = ['铝合金', '塑料', '木头', '亚克力', '黄铜', '不锈钢', '其他'];

export const PRESET_SOUND_TAGS = [
  '沙脆', '麻将音', '雨滴声', '低频闷', '高频亮',
  '回响声', '塑料感', '金属感', '木头声', '软弹',
  '硬朗', '细腻', '厚重', '空灵', '干净',
];

/* ------------------------------------------------------------------ */
/* 配列矩阵 & 控制器引脚检查台                                           */
/* ------------------------------------------------------------------ */

export type HalfId = 'L' | 'R';
/** 二极管方向：col2row = 列→行（列扫描、行读取，二极管阳极在列）；row2col 反之 */
export type DiodeDirection = 'col2row' | 'row2col';
/** none = 无二极管矩阵（直连/无二极管布线，存在三键串扰风险） */
export type DiodeMode = 'none' | 'per-key';

export interface MatrixKey {
  /** 键位名（同一半区内不可重复），如 K01 / KC_A */
  name: string;
  half: HalfId;
  /** 行索引，0 起，不得越界 */
  row: number;
  /** 列索引，0 起，不得越界 */
  col: number;
  /** 仅 per-key 模式下有意义；不填视为采用整体方向 */
  diodeDirection?: DiodeDirection;
}

/** 一个半区控制器的行列引脚分配，固定顺序为 R0..Rn, C0..Cn */
export interface PinAssignment {
  half: HalfId;
  rowPins: string[];
  colPins: string[];
}

export interface BoardPreset {
  id: string;
  label: string;
  split: boolean;
  /** 固定分配顺序（由低到高） */
  pinOrder: string[];
  /** 禁用 / 不可用引脚（下载、电源、晶振或常见串口占用） */
  disabledPins: string[];
  note: string;
}

export interface MatrixConfig {
  version: 1;
  boardId: string;
  rows: number;
  cols: number;
  /** 登记的期望键数，用于漏键判断 */
  expectedKeyCount: number;
  split: boolean;
  diodeMode: DiodeMode;
  diodeDirection: DiodeDirection;
  keys: MatrixKey[];
  pins: PinAssignment[];
  updatedAt: string;
}

export type IssueLevel = 'error' | 'warning';

export type IssueCode =
  | 'dimension-invalid'
  | 'key-invalid'
  | 'key-duplicate-position'
  | 'key-duplicate-name'
  | 'key-out-of-bounds'
  | 'empty-row'
  | 'empty-col'
  | 'empty-half'
  | 'missing-key'
  | 'ghost-triplet'
  | 'diode-direction-mismatch'
  | 'diode-reverse-risk'
  | 'pin-illegal'
  | 'pin-disabled'
  | 'pin-duplicate'
  | 'pin-missing'
  | 'no-solution';

export interface MatrixIssue {
  level: IssueLevel;
  code: IssueCode;
  half?: HalfId;
  row?: number;
  col?: number;
  pin?: string;
  /** 涉及键位名 */
  keys?: string[];
  message: string;
}

export interface RelaxationSuggestion {
  half: HalfId;
  /** 当前非禁用引脚数 */
  available: number;
  /** 需要引脚数 */
  required: number;
  /** 引脚缺口（required - available） */
  shortage: number;
  /**
   * 放开列出的禁用脚后能否单独补齐缺口。
   * true = 放开 unblockPins 即有解；
   * false = 即便放开全部现有禁用脚仍缺脚，必须减线或换板。
   */
  feasible: boolean;
  /** 建议放开的禁用脚（固定顺序）；feasible 时数量等于 shortage，否则为全部禁用脚 */
  unblockPins: string[];
  message: string;
}

export interface PinAssignResult {
  pins: PinAssignment[];
  /** 固定顺序分配后仍无解的半区建议；为空表示全部可分配 */
  suggestions: RelaxationSuggestion[];
}

export interface MatrixAnalysis {
  config: MatrixConfig;
  preset?: BoardPreset;
  issues: MatrixIssue[];
  /** 存在 error 时禁止保存 */
  valid: boolean;
  keyCount: number;
  /** 每个半区的占用网格，便于矩阵着色 */
  occupancy: Record<HalfId, boolean[][]>;
  suggestions: RelaxationSuggestion[];
}

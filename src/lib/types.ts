export type NodeKind =
  | 'root'
  | 'apex'
  | 'trigger'
  | 'flowRuntime'
  | 'flow'
  | 'flowElement'
  | 'validation'
  | 'workflow'
  | 'method'
  | 'dml'
  | 'soql'
  | 'exception'
  | 'email'
  | 'callout'
  | 'debug'
  | 'gap'
  | 'limit'
  | 'async'
  | 'codeUnit';

export type MetricValue = string | number | boolean;

export interface DebugMessage {
  line: number;
  level: string;
  message: string;
  source?: string;
}

export interface ExceptionDetail {
  eventType: string;
  exceptionType: string;
  message: string;
  apexLine?: number;
  raw: string;
  stack?: string[];
}

export interface StoryNode {
  id: string;
  kind: NodeKind;
  label: string;
  subtitle?: string;
  detail?: string;
  parentId?: string;
  childIds: string[];
  startNs: number;
  endNs?: number;
  durationMs?: number;
  lineStart: number;
  lineEnd: number;
  metrics: Record<string, MetricValue>;
  warnings: string[];
  callerChain?: string[];
  debugMessages?: DebugMessage[];
  exception?: ExceptionDetail;
  loopMultiplier?: number;
}

export interface NoiseGroup {
  eventType: string;
  count: number;
}

export interface Hotspot {
  label: string;
  count: number;
}

export interface LogSummary {
  lineCount: number;
  eventCounts: Record<string, number>;
  durationMs: number;
  dmlCount: number;
  soqlCount: number;
  codeUnitCount: number;
  triggerCount: number;
  flowCount: number;
  exceptionCount: number;
  collapsedNoiseCount: number;
  noiseGroups: NoiseGroup[];
  dmlByObject: NoiseGroup[];
  soqlByObject: NoiseGroup[];
  hotspots: Hotspot[];
}

export interface ParseResult {
  nodes: StoryNode[];
  summary: LogSummary;
}

export interface WorkerParseRequest {
  type: 'parse';
  text: string;
}

export interface WorkerParseSuccess {
  type: 'success';
  result: ParseResult;
}

export interface WorkerParseFailure {
  type: 'failure';
  message: string;
}

export type WorkerParseResponse = WorkerParseSuccess | WorkerParseFailure;

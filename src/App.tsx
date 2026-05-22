import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  PanOnScrollMode,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { toPng } from 'html-to-image';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Binary,
  Bolt,
  ChevronRight,
  CircleDot,
  Code2,
  Copy,
  Database,
  Download,
  FileCode2,
  FileUp,
  Gauge,
  GitBranch,
  Globe2,
  Hand,
  Layers3,
  CircleHelp,
  Mail,
  Maximize2,
  MessageSquareText,
  Minimize2,
  MousePointer2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  Waypoints,
  Workflow
} from 'lucide-react';
import type { LogSummary, NodeKind, ParseResult, StoryNode, WorkerParseResponse } from './lib/types';
import { parseSalesforceLog } from './lib/salesforceLogParser';
import appIconUrl from './assets/app-icon.png';

const IMPORTANT_KINDS = new Set<NodeKind>([
  'apex',
  'trigger',
  'flow',
  'flowElement',
  'validation',
  'workflow',
  'method',
  'dml',
  'soql',
  'exception',
  'async',
  'email',
  'callout',
  'gap',
  'codeUnit'
]);

const EXECUTION_TREE_HIDDEN_KINDS = new Set<NodeKind>(['validation', 'workflow']);

type CanvasMode = 'inspect' | 'pan';
type GraphRelation = 'selected' | 'upstream' | 'downstream' | 'unrelated';
type FailureRole = 'none' | 'selected-parent' | 'path' | 'source';
type DmlTone = 'record' | 'automation' | 'platform' | 'logging' | 'system';
type ThemeMode = 'dark' | 'light';
type ThemePreference = ThemeMode | 'system';
type RiskLevel = 'none' | 'watch' | 'danger';
type LeftRailMode = 'story' | 'dml' | 'soql' | 'errors' | 'async' | 'email' | 'callouts';
type TourPlacement = 'top' | 'right' | 'bottom' | 'left' | 'center';
type GraphVisibilityKey = 'trigger' | 'flow' | 'exception' | 'apexAction' | 'async' | 'callout';

const KIND_STYLE: Record<NodeKind, { color: string; bg: string; label: string }> = {
  root: { color: '#d6e4ff', bg: '#1d2736', label: 'Transaction' },
  apex: { color: '#8bd7ff', bg: '#0d3140', label: 'Apex' },
  trigger: { color: '#ffcb7a', bg: '#402a0c', label: 'Trigger' },
  flowRuntime: { color: '#7ee7b1', bg: '#102f24', label: 'Flow runtime' },
  flow: { color: '#8ef0c0', bg: '#123728', label: 'Flow' },
  flowElement: { color: '#a9e8c5', bg: '#172e24', label: 'Flow element' },
  validation: { color: '#f7a6ff', bg: '#35183b', label: 'Validation' },
  workflow: { color: '#f4d35e', bg: '#3c3411', label: 'Workflow' },
  method: { color: '#c9d4e6', bg: '#202936', label: 'Method' },
  dml: { color: '#ff9f7a', bg: '#422016', label: 'DML' },
  soql: { color: '#7cc7ff', bg: '#112d42', label: 'SOQL' },
  exception: { color: '#ff6680', bg: '#431923', label: 'Error' },
  async: { color: '#c7a6ff', bg: '#2c2141', label: 'Async Apex' },
  email: { color: '#67e8f9', bg: '#12333b', label: 'Email' },
  callout: { color: '#60f0d0', bg: '#113633', label: 'Callout' },
  debug: { color: '#e6dd9b', bg: '#383316', label: 'Debug' },
  gap: { color: '#c4a7ff', bg: '#2c2141', label: 'Execution gap' },
  limit: { color: '#b8c3d8', bg: '#252b36', label: 'Limit' },
  codeUnit: { color: '#ccd5e5', bg: '#202936', label: 'Code unit' }
};

const DML_TONE_STYLE: Record<DmlTone, { color: string; bg: string }> = {
  record: { color: '#ff9f7a', bg: '#422016' },
  automation: { color: '#ffcb7a', bg: '#3d2b12' },
  platform: { color: '#c7a6ff', bg: '#2c2141' },
  logging: { color: '#e6dd9b', bg: '#353017' },
  system: { color: '#bac6d5', bg: '#252b36' }
};

const LIGHT_KIND_STYLE: Record<NodeKind, { color: string; bg: string; label: string }> = {
  root: { color: '#1a56db', bg: '#eff6ff', label: 'Transaction' },
  apex: { color: '#0284c7', bg: '#f0f9ff', label: 'Apex' },
  trigger: { color: '#ca8a04', bg: '#fef9c3', label: 'Trigger' },
  flowRuntime: { color: '#047857', bg: '#ecfdf5', label: 'Flow runtime' },
  flow: { color: '#059669', bg: '#ecfdf5', label: 'Flow' },
  flowElement: { color: '#0d9488', bg: '#f0fdfa', label: 'Flow element' },
  validation: { color: '#c026d3', bg: '#fdf4ff', label: 'Validation' },
  workflow: { color: '#ca8a04', bg: '#fefce8', label: 'Workflow' },
  method: { color: '#475569', bg: '#f8fafc', label: 'Method' },
  dml: { color: '#ea580c', bg: '#fff7ed', label: 'DML' },
  soql: { color: '#2563eb', bg: '#eff6ff', label: 'SOQL' },
  exception: { color: '#dc2626', bg: '#fef2f2', label: 'Error' },
  async: { color: '#7c3aed', bg: '#f5f3ff', label: 'Async Apex' },
  email: { color: '#0891b2', bg: '#ecfeff', label: 'Email' },
  callout: { color: '#0f766e', bg: '#f0fdfa', label: 'Callout' },
  debug: { color: '#65a30d', bg: '#f7fee7', label: 'Debug' },
  gap: { color: '#7c3aed', bg: '#f5f3ff', label: 'Execution gap' },
  limit: { color: '#6b7280', bg: '#f3f4f6', label: 'Limit' },
  codeUnit: { color: '#4b5563', bg: '#f3f4f6', label: 'Code unit' }
};

const LIGHT_DML_TONE_STYLE: Record<DmlTone, { color: string; bg: string }> = {
  record: { color: '#ea580c', bg: '#fff7ed' },
  automation: { color: '#ca8a04', bg: '#fef9c3' },
  platform: { color: '#7c3aed', bg: '#f5f3ff' },
  logging: { color: '#65a30d', bg: '#f7fee7' },
  system: { color: '#4b5563', bg: '#f3f4f6' }
};

type GraphNodeData = {
  storyNode: StoryNode;
  selected: boolean;
  expanded: boolean;
  childCount: number;
  executionOrder?: number;
  siblingOrder?: number;
  siblingTotal?: number;
  querySummary?: QuerySummary;
  downstreamQuerySummary?: QuerySummary;
  soqlLensEnabled: boolean;
  relation: GraphRelation;
  failureRole: FailureRole;
  downstreamFailureCount: number;
  isDataOperationHighlighted: boolean;
  gapBeforeMs?: number;
  riskLevel: RiskLevel;
  warnings: string[];
  theme: ThemeMode;
};

interface RevealPlan {
  expansionIds: Set<string>;
  visibleChildIds: string[];
}

interface DmlClassification {
  label: string;
  tone: DmlTone;
  badges: string[];
  isPlatformEvent: boolean;
  isTelemetry: boolean;
}

interface DmlImpact {
  classification: DmlClassification;
  summary: string;
  directAutomation: StoryNode[];
  automationGroups: DmlImpactGroup[];
  failureNodes: StoryNode[];
  previousMeaningful?: StoryNode;
  nextMeaningful?: StoryNode;
  counts: Record<string, number>;
}

interface DmlImpactGroup {
  id: string;
  title: string;
  subtitle: string;
  dmlNode?: StoryNode;
  automation: StoryNode[];
  counts: Record<string, number>;
  failureNodes: StoryNode[];
}

interface FlowContext {
  flowApiName?: string;
  runtimeObject?: string;
  interviewId?: string;
  interviewCount?: number;
  flowDefinitionId?: string;
  flowVersionId?: string;
  elementApiName?: string;
  elementType?: string;
  flowNode?: StoryNode;
  flowInterviews: StoryNode[];
}

interface QuerySummary {
  executionCount: number;
  uniqueQueryCount: number;
  rowCount: number;
  repeatCount: number;
  objectCount: number;
  topObject?: string;
  totalMs: number;
  slowestMs: number;
}

interface QueryGroup {
  objectName: string;
  reads: StoryNode[];
  summary: QuerySummary;
}

interface QueryBranchBreakdown {
  node: StoryNode;
  summary: QuerySummary;
}

interface DataOperationOccurrence {
  node: StoryNode;
  ownerLabel: string;
  ownerKind: NodeKind;
  lineLabel: string;
  countLabel: string;
  sequence: number;
  colorIndex: number;
  tone?: DmlTone;
}

interface DataOperationGroup {
  key: string;
  kind: 'dml' | 'soql' | 'async' | 'email' | 'callout' | 'exception';
  label: string;
  subtitle: string;
  detail?: string;
  executionCount: number;
  rowCount: number;
  durationMs: number;
  nodes: StoryNode[];
  occurrences: DataOperationOccurrence[];
  tone?: DmlTone;
}

interface DataOperationIndex {
  dmlGroups: DataOperationGroup[];
  soqlGroups: DataOperationGroup[];
  errorGroups: DataOperationGroup[];
  asyncGroups: DataOperationGroup[];
  emailGroups: DataOperationGroup[];
  calloutGroups: DataOperationGroup[];
}

interface PanelSizes {
  left: number;
  right: number;
  evidence: number;
}

interface InitialView {
  selectedId: string | null;
  expandedIds: Set<string>;
  navHistory: { stack: string[]; index: number };
}

interface GraphPoint {
  x: number;
  y: number;
}

interface LayoutAnchor {
  nodeId: string;
  position: GraphPoint;
}

interface GroupFocusRequest {
  nodeIds: Set<string>;
}

interface GraphViewportSnapshot {
  x: number;
  y: number;
  zoom: number;
}

interface DataOperationReturnPoint {
  selectedId: string | null;
  expandedIds: Set<string>;
  activeRevealSourceId: string | null;
  activeDmlFocusId: string | null;
  viewport?: GraphViewportSnapshot;
}

interface SelectNodeOptions {
  focusCanvas?: boolean;
  autoSelectFirstChild?: boolean;
  forceRevealSource?: boolean;
}

interface TimeProfile {
  dbMs: number;
  flowMs: number;
  codeMs: number;
  otherMs: number;
  dbPercent: number;
  flowPercent: number;
  codePercent: number;
  otherPercent: number;
}

type TimeBucket = 'db' | 'flow' | 'code' | 'other';

type NativeLogBridge = {
  openLogFile: () => Promise<{ canceled: boolean; fileName?: string; text?: string; error?: string }>;
  onOpenLogShortcut?: (callback: () => void) => () => void;
};

type VsCodeBridge = {
  postMessage: (message: { type: 'ready' } | { type: 'openLog' }) => void;
};

type VsCodeInboundMessage = {
  type?: string;
  fileName?: unknown;
  text?: unknown;
};

declare global {
  interface Window {
    apexDebugLogExplorer?: NativeLogBridge;
    acquireVsCodeApi?: () => VsCodeBridge;
  }
}

const nodeTypes = {
  story: StoryGraphNode
};

const GRAPH_NODE_WIDTH = 254;
const GRAPH_STAGE_MIN_WIDTH = 460;
const RIGHT_PANEL_MIN_WIDTH = 300;
const RIGHT_PANEL_MAX_SCREEN_SHARE = 0.5;
const MAX_DML_GRAPH_GROUPS = 2;
const MAX_DML_GRAPH_GROUP_AUTOMATION = 3;
const DEFAULT_ENABLED_KINDS = new Set<GraphVisibilityKey>(['trigger', 'flow', 'exception', 'apexAction', 'async', 'callout']);
const TOUR_STORAGE_KEY = 'apex-debug-log-explorer:onboarding:v1';
const THEME_STORAGE_KEY = 'apex-debug-log-explorer-theme';
const TOUR_POPOVER_WIDTH = 340;
const MAX_LOG_FILE_BYTES = 50 * 1024 * 1024;

function buildGraphDisplayControls(
  hasTriggers: boolean,
  hasFlows: boolean,
  hasErrors: boolean,
  hasAsync: boolean,
  hasCallouts: boolean,
  hasApexActions: boolean
): Array<{ key: GraphVisibilityKey; label: string; description: string; icon: typeof Bolt }> {
  const controls: Array<{ key: GraphVisibilityKey; label: string; description: string; icon: typeof Bolt }> = [];

  if (hasTriggers) {
    controls.push({
      key: 'trigger',
      label: 'Triggers',
      description: 'Show or hide Apex trigger branches and their downstream execution.',
      icon: Bolt
    });
  }
  if (hasFlows) {
    controls.push({
      key: 'flow',
      label: 'Flows',
      description: 'Show or hide Flow interviews. Flow elements appear when the related Flow interview is expanded.',
      icon: Workflow
    });
  }
  if (hasErrors) {
    controls.push({
      key: 'exception',
      label: 'Errors',
      description: 'Show or hide exception and Salesforce error nodes in the graph.',
      icon: AlertTriangle
    });
  }

  if (hasApexActions) {
    controls.push({
      key: 'apexAction',
      label: 'Apex Actions',
      description: 'Show or hide Apex actions invoked through Lightning, Aura, or external Apex action entry points.',
      icon: FileCode2
    });
  }
  if (hasAsync) {
    controls.push({
      key: 'async',
      label: 'Async Apex',
      description: 'Show or hide Future, Queueable, Batch, and Scheduled Apex request or transaction nodes.',
      icon: Send
    });
  }
  if (hasCallouts) {
    controls.push({
      key: 'callout',
      label: 'Callouts',
      description: 'Show or hide HTTP and Named Credential callout nodes captured in the debug log.',
      icon: Globe2
    });
  }

  return controls;
}

interface TourStep {
  id: string;
  selector: string;
  title: string;
  body: string;
  placement: TourPlacement;
}

interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const TOUR_STEPS: TourStep[] = [
  {
    id: 'summary',
    selector: '[data-tour-id="summary-metrics"]',
    title: 'Transaction Summary',
    body: 'This area shows the debug log file name and key transaction metrics: duration, DML statements, SOQL queries, Apex code units, and Flow interviews.',
    placement: 'bottom'
  },
  {
    id: 'tree',
    selector: '[data-tour-id="execution-tree"]',
    title: 'Execution Tree',
    body: 'This panel shows significant Apex, Flow, trigger, DML, SOQL, and exception events in the order they appear in the Salesforce debug log.',
    placement: 'right'
  },
  {
    id: 'indexes',
    selector: '[data-tour-id="data-index-tabs"]',
    title: 'Execution Indexes',
    body: 'These tabs group DML, SOQL, errors, Async Apex, email sends, and callouts when the log contains them. Selecting a group highlights every matching execution location.',
    placement: 'right'
  },
  {
    id: 'graph',
    selector: '[data-tour-id="graph-canvas"]',
    title: 'Execution Graph',
    body: 'This canvas shows the selected event and its downstream execution. Numbered connectors show the order Salesforce processed each branch.',
    placement: 'top'
  },
  {
    id: 'graph-display',
    selector: '[data-tour-id="graph-display-controls"]',
    title: 'Graph Display',
    body: 'Use these switches to show or hide Salesforce execution families that exist in the loaded log, such as Triggers, Flow interviews, errors, Apex Actions, Async Apex, and callouts. The Expand All control changes to Collapse All once the enabled graph is fully expanded.',
    placement: 'bottom'
  },
  {
    id: 'inspector',
    selector: '[data-tour-id="inspector"]',
    title: 'Inspector',
    body: 'This panel shows details for the selected event, including DML impact, SOQL evidence, caller context, Flow metadata, and exception details when available.',
    placement: 'left'
  },
  {
    id: 'evidence',
    selector: '[data-tour-id="raw-evidence"]',
    title: 'Raw Log Lines',
    body: 'This drawer shows the original debug log lines used as evidence for the selected event.',
    placement: 'top'
  },
  {
    id: 'controls',
    selector: '[data-tour-id="graph-controls"]',
    title: 'Graph Controls',
    body: 'These controls reset the loaded debug log view and collapse side panels when more canvas space is needed for execution analysis.',
    placement: 'bottom'
  }
];

interface RawLogSource {
  text: string;
  lineOffsets: Uint32Array;
}

function App() {
  const [result, setResult] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState('No log loaded');
  const [rawLog, setRawLog] = useState<RawLogSource | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [navHistory, setNavHistory] = useState<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeRevealSourceId, setActiveRevealSourceId] = useState<string | null>(null);
  const [activeDmlFocusId, setActiveDmlFocusId] = useState<string | null>(null);
  const [initialView, setInitialView] = useState<InitialView | null>(null);
  const [layoutAnchor, setLayoutAnchor] = useState<LayoutAnchor | null>(null);
  const [enabledKinds, setEnabledKinds] = useState<Set<GraphVisibilityKey>>(() => new Set(DEFAULT_ENABLED_KINDS));
  const soqlLensEnabled = true;
  const [pinnedSoqlIds, setPinnedSoqlIds] = useState<Set<string>>(new Set());
  const [highlightedOperationIds, setHighlightedOperationIds] = useState<Set<string>>(new Set());
  const [leftRailMode, setLeftRailMode] = useState<LeftRailMode>('story');
  const [activeDataOperationKey, setActiveDataOperationKey] = useState<string | null>(null);
  const [dataOperationReturnPoint, setDataOperationReturnPoint] = useState<DataOperationReturnPoint | null>(null);
  const [query, setQuery] = useState('');
  const [spineLimit, setSpineLimit] = useState(250);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('inspect');
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => initialThemePreference());
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(() => preferredSystemTheme());
  const [panelSizes, setPanelSizes] = useState<PanelSizes>(() => defaultPanelSizes());
  const [isLeftRailCollapsed, setIsLeftRailCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [isEvidenceCollapsed, setIsEvidenceCollapsed] = useState(true);
  const [showFullEvidence, setShowFullEvidence] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isOpeningLog, setIsOpeningLog] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasSeenTour, setHasSeenTour] = useState(() => hasSeenGuidedTour());
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const spineListRef = useRef<HTMLDivElement | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<Node<GraphNodeData>, Edge> | null>(null);
  const pendingCanvasFocusRef = useRef<string | null>(null);
  const pendingVisibleGraphFocusRef = useRef(false);
  const pendingGroupFocusRef = useRef<GroupFocusRequest | null>(null);
  const pendingViewportRestoreRef = useRef<GraphViewportSnapshot | null>(null);
  const lastRawSearchRef = useRef<string>('');
  const visibleGraphRef = useRef<{ nodes: Node<GraphNodeData>[]; edges: Edge[] }>({ nodes: [], edges: [] });
  const vscodeBridgeRef = useRef<VsCodeBridge | null>(null);

  const parseText = useCallback((text: string, nextFileName: string) => {
    setIsParsing(true);
    setParseError(null);
    setFileName(nextFileName);
    setResult(null);
    setRawLog({ text, lineOffsets: buildLineOffsets(text) });
    setInitialView(null);
    setSelectedId(null);
    setNavHistory({ stack: [], index: -1 });
    setExpandedIds(new Set());
    setActiveRevealSourceId(null);
    setActiveDmlFocusId(null);
    setLayoutAnchor(null);
    setQuery('');
    setSpineLimit(250);
    setEnabledKinds(new Set(DEFAULT_ENABLED_KINDS));
    setCanvasMode('inspect');
    setPanelSizes(defaultPanelSizes());
    setIsLeftRailCollapsed(false);
    setIsInspectorCollapsed(false);
    setIsEvidenceCollapsed(true);
    setShowFullEvidence(false);
    setPinnedSoqlIds(new Set());
    setHighlightedOperationIds(new Set());
    setActiveDataOperationKey(null);
    setDataOperationReturnPoint(null);
    setLeftRailMode('story');
    pendingCanvasFocusRef.current = null;
    pendingVisibleGraphFocusRef.current = false;
    pendingGroupFocusRef.current = null;
    pendingViewportRestoreRef.current = null;
    lastRawSearchRef.current = '';

    const handleSuccess = (parsed: ParseResult) => {
      setResult(parsed);
      const firstMeaningful =
        parsed.nodes.find((node) => node.kind === 'dml') ??
        parsed.nodes.find((node) => node.kind === 'apex') ??
        parsed.nodes[0];
      const initialSelectedId = firstMeaningful?.id ?? null;
      const initialExpandedIds = focusExpandedNodes(parsed.nodes, firstMeaningful?.id);
      const initialHistory = {
        stack: initialSelectedId ? [initialSelectedId] : [],
        index: initialSelectedId ? 0 : -1
      };
      setSelectedId(initialSelectedId);
      setActiveRevealSourceId(initialSelectedId);
      setActiveDmlFocusId(firstMeaningful?.kind === 'dml' ? initialSelectedId : null);
      setExpandedIds(new Set(initialExpandedIds));
      setInitialView({
        selectedId: initialSelectedId,
        expandedIds: initialExpandedIds,
        navHistory: initialHistory
      });
      setIsParsing(false);
      setNavHistory(initialHistory);
    };

    const parseOnMainThread = (reason?: unknown) => {
      window.setTimeout(() => {
        try {
          handleSuccess(parseSalesforceLog(text));
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Unable to parse log';
          const prefix = reason instanceof Error ? `Worker unavailable: ${reason.message}. ` : '';
          setParseError(`${prefix}${detail}`);
          setIsParsing(false);
        }
      }, 0);
    };

    try {
      let settled = false;
      const worker = new Worker(new URL('./workers/logParser.worker.ts', import.meta.url), {
        type: 'module'
      });

      worker.onmessage = (event: MessageEvent<WorkerParseResponse>) => {
        settled = true;
        if (event.data.type === 'success') {
          handleSuccess(event.data.result);
        } else {
          setParseError(event.data.message);
          setIsParsing(false);
        }
        worker.terminate();
      };

      worker.onerror = (event) => {
        event.preventDefault();
        if (settled) {
          return;
        }
        settled = true;
        worker.terminate();
        parseOnMainThread(new Error(event.message || 'The parser worker failed before it could analyze this log.'));
      };

      worker.postMessage({ type: 'parse', text });
    } catch (workerError) {
      parseOnMainThread(workerError);
    }
  }, []);

  const nodeById = useMemo(() => {
    return new Map(result?.nodes.map((node) => [node.id, node]) ?? []);
  }, [result]);

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;
  const isPanLocked = canvasMode === 'pan';
  const theme: ThemeMode = themePreference === 'system' ? systemTheme : themePreference;
  const isLightTheme = theme === 'light';

  const selectNode = useCallback((id: string, pushHistory = true, anchorPosition?: GraphPoint, options: SelectNodeOptions = {}) => {
    const revealPlan = nodeById.size > 0 ? buildRevealPlan(id, nodeById, enabledKinds, query) : undefined;
    const clickedNode = nodeById.get(id);
    const hasVisibleChildren = Boolean(revealPlan && revealPlan.visibleChildIds.length > 0);
    const shouldAutoSelectFirstChild = options.autoSelectFirstChild && !expandedIds.has(id);
    const firstChildId = shouldAutoSelectFirstChild && revealPlan ? revealPlan.visibleChildIds[0] : undefined;
    const nextSelectedId = firstChildId ?? id;

    if (options.focusCanvas) {
      pendingCanvasFocusRef.current = nextSelectedId;
    }
    setLayoutAnchor(anchorPosition ? { nodeId: id, position: { ...anchorPosition } } : null);
    setActiveRevealSourceId((current) => (options.forceRevealSource || hasVisibleChildren ? id : current ?? id));
    setActiveDmlFocusId((current) => resolveDmlFocusId(clickedNode, current, nodeById));
    setSelectedId(nextSelectedId);
    if (nodeById.size > 0) {
      setExpandedIds((current) => {
        const next = new Set(current);
        addAncestorExpansion(nextSelectedId, nodeById, next);
        revealPlan?.expansionIds.forEach((expandedId) => next.add(expandedId));
        if (nextSelectedId !== id) {
          buildRevealPlan(nextSelectedId, nodeById, enabledKinds, query).expansionIds.forEach((expandedId) => next.add(expandedId));
        }
        return next;
      });
    }

    if (pushHistory) {
      setNavHistory((prev) => {
        const nextStack = prev.stack.slice(0, prev.index + 1);
        if (nextStack[nextStack.length - 1] === nextSelectedId) {
          return prev;
        }
        return {
          stack: [...nextStack, nextSelectedId],
          index: nextStack.length
        };
      });
    }
  }, [enabledKinds, expandedIds, nodeById, query]);

  const collapseNodeBranch = useCallback((id: string, pushHistory = true, anchorPosition?: GraphPoint): boolean => {
    const clickedNode = nodeById.get(id);
    if (!clickedNode || !expandedIds.has(id)) {
      return false;
    }

    const revealPlan = buildRevealPlan(id, nodeById, enabledKinds, query);
    const isActiveBranch = selectedId === id || activeRevealSourceId === id;
    if (!isActiveBranch || revealPlan.visibleChildIds.length === 0) {
      return false;
    }

    setLayoutAnchor(anchorPosition ? { nodeId: id, position: { ...anchorPosition } } : null);
    setSelectedId(id);
    setActiveRevealSourceId(null);
    setActiveDmlFocusId((current) => {
      const currentNode = current ? nodeById.get(current) : undefined;
      if (clickedNode.kind === 'dml' || (currentNode && isDescendantOf(currentNode, id, nodeById))) {
        return null;
      }
      return resolveDmlFocusId(clickedNode, current, nodeById);
    });
    setExpandedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      collectDescendantNodes(clickedNode, nodeById).forEach((node) => next.delete(node.id));
      addParentExpansion(id, nodeById, next);
      return next;
    });

    if (pushHistory) {
      setNavHistory((prev) => {
        const nextStack = prev.stack.slice(0, prev.index + 1);
        if (nextStack[nextStack.length - 1] === id) {
          return prev;
        }
        return {
          stack: [...nextStack, id],
          index: nextStack.length
        };
      });
    }

    return true;
  }, [activeRevealSourceId, enabledKinds, expandedIds, nodeById, query, selectedId]);

  const navigateBack = useCallback(() => {
    setNavHistory((prev) => {
      if (prev.index > 0) {
        const nextIndex = prev.index - 1;
        const prevId = prev.stack[nextIndex];
        selectNode(prevId, false);
        return { ...prev, index: nextIndex };
      } else if (prev.index === 0) {
        setSelectedId(null);
        setActiveRevealSourceId(null);
        setActiveDmlFocusId(null);
        return { ...prev, index: -1 };
      }
      return prev;
    });
  }, [selectNode]);

  const navigateForward = useCallback(() => {
    setNavHistory((prev) => {
      if (prev.index < prev.stack.length - 1) {
        const nextIndex = prev.index + 1;
        const nextId = prev.stack[nextIndex];
        selectNode(nextId, false);
        return { ...prev, index: nextIndex };
      }
      return prev;
    });
  }, [selectNode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore key shortcuts if focused in an input field
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.getAttribute('contenteditable') === 'true')) {
        return;
      }

      const isCmdOrCtrl = event.metaKey || event.ctrlKey;
      if (isCmdOrCtrl) {
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) {
            navigateForward();
          } else {
            navigateBack();
          }
        } else if (event.key.toLowerCase() === 'y') {
          event.preventDefault();
          navigateForward();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigateBack, navigateForward]);

  useEffect(() => {
    const token = query.trim();
    if (!result || !rawLog || !looksLikeRawEvidenceToken(token) || lastRawSearchRef.current === token) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const lineNumber = findRawLogLine(rawLog, token);
      if (!lineNumber) {
        return;
      }
      const node = findSmallestNodeForLine(result.nodes, lineNumber);
      if (!node) {
        return;
      }
      lastRawSearchRef.current = token;
      selectNode(node.id);
      setIsEvidenceCollapsed(false);
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [query, rawLog, result, selectNode]);

  const visibleGraph = useMemo(() => {
    if (!result) {
      return { nodes: [] as Node<GraphNodeData>[], edges: [] as Edge[] };
    }
    return buildFlowGraph(
      result.nodes,
      expandedIds,
      selectedId,
      activeRevealSourceId,
      activeDmlFocusId,
      enabledKinds,
      query,
      theme,
      layoutAnchor,
      soqlLensEnabled,
      pinnedSoqlIds,
      highlightedOperationIds
    );
  }, [activeDmlFocusId, activeRevealSourceId, enabledKinds, expandedIds, highlightedOperationIds, layoutAnchor, pinnedSoqlIds, query, result, selectedId, soqlLensEnabled, theme]);

  visibleGraphRef.current = visibleGraph;

  useEffect(() => {
    if (!result) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const instance = reactFlowRef.current;
      if (!instance || visibleGraphRef.current.nodes.length === 0) {
        return;
      }
      window.requestAnimationFrame(() => {
        focusCurrentGraphContext(
          instance,
          visibleGraphRef.current.nodes,
          selectedId,
          highlightedOperationIds,
          isLeftRailCollapsed && isInspectorCollapsed,
          260
        );
      });
    }, 190);

    const followupTimeout = window.setTimeout(() => {
      const instance = reactFlowRef.current;
      if (!instance || visibleGraphRef.current.nodes.length === 0) {
        return;
      }
      focusCurrentGraphContext(
        instance,
        visibleGraphRef.current.nodes,
        selectedId,
        highlightedOperationIds,
        isLeftRailCollapsed && isInspectorCollapsed,
        180
      );
    }, 360);

    return () => {
      window.clearTimeout(timeout);
      window.clearTimeout(followupTimeout);
    };
  }, [isInspectorCollapsed, isLeftRailCollapsed, result]);

  useEffect(() => {
    const request = pendingGroupFocusRef.current;
    const instance = reactFlowRef.current;
    if (!request || !instance) {
      return;
    }

    const groupNodes = visibleGraph.nodes.filter((node) => request.nodeIds.has(node.id));
    if (groupNodes.length === 0) {
      return;
    }

    pendingGroupFocusRef.current = null;
    window.requestAnimationFrame(() => {
      void instance.fitView({
        nodes: groupNodes,
        padding: groupNodes.length > 1 ? 0.36 : 0.5,
        duration: 360,
        minZoom: 0.18,
        maxZoom: groupNodes.length > 1 ? 0.72 : 0.96
      });
    });
  }, [visibleGraph]);

  useEffect(() => {
    const nodeId = pendingCanvasFocusRef.current;
    const instance = reactFlowRef.current;
    if (!nodeId || !instance) {
      return;
    }
    const graphNode = visibleGraph.nodes.find((node) => node.id === nodeId);
    if (!graphNode) {
      return;
    }
    pendingCanvasFocusRef.current = null;
    const storyNode = graphNode.data.storyNode;
    const height = estimateGraphNodeHeight(
      storyNode,
      graphNode.data.gapBeforeMs,
      graphNode.data.querySummary,
      graphNode.data.downstreamQuerySummary,
      graphNode.data.failureRole
    );
    const currentZoom = instance.getZoom();
    const zoom = Math.min(1.05, Math.max(0.42, currentZoom || 0.62));
    window.requestAnimationFrame(() => {
      void instance.setCenter(
        graphNode.position.x + GRAPH_NODE_WIDTH / 2,
        graphNode.position.y + height / 2,
        { zoom, duration: 260 }
      );
    });
  }, [visibleGraph]);

  useEffect(() => {
    const instance = reactFlowRef.current;
    if (!pendingVisibleGraphFocusRef.current || !instance || visibleGraph.nodes.length === 0) {
      return;
    }

    pendingVisibleGraphFocusRef.current = false;
    window.requestAnimationFrame(() => {
      void instance.fitView({
        nodes: visibleGraph.nodes,
        padding: 0.26,
        duration: 260,
        minZoom: 0.18,
        maxZoom: 0.92
      });
    });
  }, [visibleGraph]);

  useEffect(() => {
    const viewport = pendingViewportRestoreRef.current;
    const instance = reactFlowRef.current;
    if (!viewport || !instance) {
      return;
    }

    pendingViewportRestoreRef.current = null;
    window.requestAnimationFrame(() => {
      void instance.setViewport(viewport, { duration: 260 });
    });
  }, [visibleGraph]);

  const importantNodes = useMemo(() => {
    if (!result) {
      return [];
    }
    const normalized = query.trim().toLowerCase();
    return result.nodes
      .filter((node) => IMPORTANT_KINDS.has(node.kind) && node.kind !== 'root' && node.kind !== 'method')
      .filter((node) => !isEmptyFlowRuntimeNode(node, nodeById))
      .filter((node) => !EXECUTION_TREE_HIDDEN_KINDS.has(node.kind))
      .filter((node) => node.kind !== 'soql')
      .filter((node) => {
        if (!normalized) {
          return true;
        }
        return `${node.label} ${node.subtitle ?? ''} ${node.detail ?? ''}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => a.lineStart - b.lineStart);
  }, [nodeById, query, result]);

  const dataOperationIndex = useMemo<DataOperationIndex>(() => {
    if (!result) {
      return { dmlGroups: [], soqlGroups: [], errorGroups: [], asyncGroups: [], emailGroups: [], calloutGroups: [] };
    }
    return buildDataOperationIndex(result.nodes, nodeById, query);
  }, [nodeById, query, result]);

  const fullDataOperationIndex = useMemo<DataOperationIndex>(() => {
    if (!result) {
      return { dmlGroups: [], soqlGroups: [], errorGroups: [], asyncGroups: [], emailGroups: [], calloutGroups: [] };
    }
    return buildDataOperationIndex(result.nodes, nodeById, '');
  }, [nodeById, result]);

  const hasAsyncIndex = fullDataOperationIndex.asyncGroups.length > 0;
  const hasEmailIndex = fullDataOperationIndex.emailGroups.length > 0;
  const hasCalloutIndex = fullDataOperationIndex.calloutGroups.length > 0;
  const hasTriggerNodes = Boolean(result?.nodes.some((node) => node.kind === 'trigger'));
  const hasFlowNodes = Boolean(result?.nodes.some((node) => node.kind === 'flow' || node.kind === 'flowElement'));
  const hasErrorNodes = Boolean(result?.nodes.some((node) => node.kind === 'exception'));
  const hasApexActionNodes = useMemo(() => {
    return Boolean(result?.nodes.some(isApexActionNode));
  }, [result]);

  const activeDataOperationGroup = useMemo(() => {
    if (!activeDataOperationKey) {
      return null;
    }
    return (
      fullDataOperationIndex.dmlGroups.find((group) => group.key === activeDataOperationKey) ??
      fullDataOperationIndex.soqlGroups.find((group) => group.key === activeDataOperationKey) ??
      fullDataOperationIndex.errorGroups.find((group) => group.key === activeDataOperationKey) ??
      fullDataOperationIndex.asyncGroups.find((group) => group.key === activeDataOperationKey) ??
      fullDataOperationIndex.emailGroups.find((group) => group.key === activeDataOperationKey) ??
      fullDataOperationIndex.calloutGroups.find((group) => group.key === activeDataOperationKey) ??
      null
    );
  }, [activeDataOperationKey, fullDataOperationIndex]);

  useEffect(() => {
    if (leftRailMode === 'async' && !hasAsyncIndex) {
      setLeftRailMode('story');
    }
    if (leftRailMode === 'email' && !hasEmailIndex) {
      setLeftRailMode('story');
    }
    if (leftRailMode === 'callouts' && !hasCalloutIndex) {
      setLeftRailMode('story');
    }
  }, [hasAsyncIndex, hasCalloutIndex, hasEmailIndex, leftRailMode]);

  useEffect(() => {
    setShowFullEvidence(false);
  }, [selectedId]);

  const hasHiddenLines = useMemo(() => {
    if (!selectedNode || !rawLog) return false;
    const before = 4;
    const after = 8;
    const lineCount = rawLog.lineOffsets.length;
    const first = Math.max(0, selectedNode.lineStart - before - 1);
    const last = Math.min(lineCount, selectedNode.lineEnd + after);
    const span = last - first;
    return span > 90;
  }, [selectedNode, rawLog]);

  const evidenceLines = useMemo(() => {
    if (!selectedNode || !rawLog) {
      return [];
    }
    if (showFullEvidence) {
      const before = 4;
      const after = 8;
      const lineCount = rawLog.lineOffsets.length;
      const first = Math.max(0, selectedNode.lineStart - before - 1);
      const last = Math.min(lineCount, selectedNode.lineEnd + after);
      return rangeLines(first + 1, last, rawLog, selectedNode);
    }
    return buildEvidenceWindow(rawLog, selectedNode);
  }, [rawLog, selectedNode, showFullEvidence]);

  const selectedGapMs = useMemo(() => {
    if (!selectedNode || !result) {
      return undefined;
    }
    return timeGapBeforeNode(selectedNode, result.nodes);
  }, [result, selectedNode]);

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }
      if (!/\.(?:log|txt)$/i.test(file.name)) {
        setParseError('Select a Salesforce debug log with a .log or .txt extension.');
        return;
      }
      if (file.size > MAX_LOG_FILE_BYTES) {
        setParseError('This log is larger than 50 MB. Trim the debug log before opening it.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => parseText(String(reader.result ?? ''), file.name);
      reader.onerror = () => setParseError('Unable to read the selected log file.');
      reader.readAsText(file);
    },
    [parseText]
  );

  const openPicker = useCallback(() => {
    if (isOpeningLog) {
      return;
    }
    if (vscodeBridgeRef.current) {
      setParseError(null);
      vscodeBridgeRef.current.postMessage({ type: 'openLog' });
      return;
    }
    void openLogFile(fileInputRef, handleFile, parseText, setParseError, setIsOpeningLog);
  }, [handleFile, isOpeningLog, parseText]);

  useEffect(() => {
    return window.apexDebugLogExplorer?.onOpenLogShortcut?.(openPicker);
  }, [openPicker]);

  useEffect(() => {
    if (!window.acquireVsCodeApi || vscodeBridgeRef.current) {
      return;
    }
    const vscode = window.acquireVsCodeApi();
    vscodeBridgeRef.current = vscode;
    const handleMessage = (event: MessageEvent<VsCodeInboundMessage>) => {
      const message = event.data;
      if (message?.type !== 'loadLog' || typeof message.text !== 'string') {
        return;
      }
      const nextFileName = typeof message.fileName === 'string' && message.fileName.trim() ? message.fileName : 'Salesforce debug log';
      parseText(message.text, nextFileName);
    };
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handleMessage);
  }, [parseText]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!media) {
      return;
    }
    const updateSystemTheme = () => setSystemTheme(media.matches ? 'light' : 'dark');
    updateSystemTheme();
    media.addEventListener?.('change', updateSystemTheme);
    return () => media.removeEventListener?.('change', updateSystemTheme);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    document.documentElement.style.colorScheme = theme;
  }, [theme, themePreference]);

  useEffect(() => {
    inspectorRef.current?.scrollTo({ top: 0, left: 0 });
  }, [selectedId]);

  const startGuidedTour = useCallback(() => {
    if (!result) {
      return;
    }
    setIsLeftRailCollapsed(false);
    setIsInspectorCollapsed(false);
    setLeftRailMode('story');
    setTourStepIndex(0);
    setIsTourOpen(true);
  }, [result]);

  const finishGuidedTour = useCallback((outcome: 'completed' | 'skipped') => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, outcome);
    setHasSeenTour(true);
    setIsTourOpen(false);
  }, []);

  useEffect(() => {
    if (!result || isParsing || hasSeenTour || isTourOpen) {
      return;
    }
    startGuidedTour();
  }, [hasSeenTour, isParsing, isTourOpen, result, startGuidedTour]);

  useEffect(() => {
    if (!result && isTourOpen) {
      setIsTourOpen(false);
    }
  }, [isTourOpen, result]);

  const resetInitialView = useCallback(() => {
    if (!initialView) {
      return;
    }
    if (isLeftRailCollapsed && isInspectorCollapsed) {
      pendingVisibleGraphFocusRef.current = true;
      pendingCanvasFocusRef.current = null;
    } else if (initialView.selectedId) {
      pendingCanvasFocusRef.current = initialView.selectedId;
    }
    setLayoutAnchor(null);
    pendingGroupFocusRef.current = null;
    pendingViewportRestoreRef.current = null;
    lastRawSearchRef.current = '';
    setParseError(null);
    setQuery('');
    setSpineLimit(250);
    setEnabledKinds(new Set(DEFAULT_ENABLED_KINDS));
    setCanvasMode('inspect');
    setPinnedSoqlIds(new Set());
    setHighlightedOperationIds(new Set());
    setActiveDataOperationKey(null);
    setDataOperationReturnPoint(null);
    setLeftRailMode('story');
    setSelectedId(initialView.selectedId);
    setActiveRevealSourceId(initialView.selectedId);
    setActiveDmlFocusId(initialView.selectedId ? (nodeById.get(initialView.selectedId)?.kind === 'dml' ? initialView.selectedId : null) : null);
    setExpandedIds(new Set(initialView.expandedIds));
    setNavHistory({
      stack: [...initialView.navHistory.stack],
      index: initialView.navHistory.index
    });
    setIsEvidenceCollapsed(true);
    setShowFullEvidence(false);
    window.requestAnimationFrame(() => {
      spineListRef.current?.scrollTo({ top: 0, left: 0 });
    });
  }, [initialView, isInspectorCollapsed, isLeftRailCollapsed, nodeById]);

  const exportGraphPng = useCallback(async () => {
    if (!canvasRef.current) {
      return;
    }
    try {
      const dataUrl = await toPng(canvasRef.current, {
        backgroundColor: isLightTheme ? '#f7fbfd' : '#071017',
        pixelRatio: 2
      });
      downloadDataUrl(`${safeFileName(fileName)}-graph.png`, dataUrl);
    } catch (error) {
      setParseError(error instanceof Error ? `Unable to export PNG: ${error.message}` : 'Unable to export PNG.');
    }
  }, [fileName, isLightTheme]);

  const toggleGraphVisibility = useCallback((key: GraphVisibilityKey) => {
    setEnabledKinds((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const expandAllVisibleFamilies = useCallback(() => {
    if (!result) {
      return;
    }
    const nextExpanded = new Set<string>();
    result.nodes.forEach((node) => {
      if (node.kind !== 'root' && isGraphCandidate(node, enabledKinds, query.trim().toLowerCase(), nodeById)) {
        nextExpanded.add(node.id);
        addAncestorExpansion(node.id, nodeById, nextExpanded);
      }
    });
    setExpandedIds(nextExpanded);
    setActiveRevealSourceId(selectedId);
    pendingVisibleGraphFocusRef.current = true;
  }, [enabledKinds, nodeById, query, result, selectedId]);

  const collapseAllVisibleFamilies = useCallback(() => {
    if (!result) {
      return;
    }
    const anchorId = selectedId ?? initialView?.selectedId ?? undefined;
    setExpandedIds(focusExpandedNodes(result.nodes, anchorId));
    setActiveRevealSourceId(anchorId ?? null);
    setLayoutAnchor(null);
    pendingVisibleGraphFocusRef.current = true;
  }, [initialView?.selectedId, result, selectedId]);

  const allVisibleExpansionIds = useMemo(() => {
    const ids = new Set<string>();
    if (!result) {
      return ids;
    }
    const normalizedQuery = query.trim().toLowerCase();
    result.nodes.forEach((node) => {
      if (node.kind !== 'root' && isGraphCandidate(node, enabledKinds, normalizedQuery, nodeById)) {
        ids.add(node.id);
        addAncestorExpansion(node.id, nodeById, ids);
      }
    });
    return ids;
  }, [enabledKinds, nodeById, query, result]);

  const isGraphFullyExpanded =
    allVisibleExpansionIds.size > 0 && [...allVisibleExpansionIds].every((nodeId) => expandedIds.has(nodeId));
  const toggleAllVisibleFamilies = useCallback(() => {
    if (isGraphFullyExpanded) {
      collapseAllVisibleFamilies();
    } else {
      expandAllVisibleFamilies();
    }
  }, [collapseAllVisibleFamilies, expandAllVisibleFamilies, isGraphFullyExpanded]);
  const expandCollapseLabel = isGraphFullyExpanded ? 'Collapse All' : 'Expand All';
  const expandCollapseTitle = isGraphFullyExpanded
    ? 'Collapse expanded branches back to the selected execution path without resetting the log.'
    : 'Expand all currently enabled execution families in the graph.';

  const selectDataOperationGroup = useCallback((group: DataOperationGroup, nodeId?: string) => {
    const targetNode = nodeId ? nodeById.get(nodeId) : group.nodes[0];
    if (!targetNode) {
      return;
    }
    if (!activeDataOperationKey && !dataOperationReturnPoint) {
      setDataOperationReturnPoint({
        selectedId,
        expandedIds: new Set(expandedIds),
        activeRevealSourceId,
        activeDmlFocusId,
        viewport: reactFlowRef.current?.getViewport()
      });
    }
    const groupNodeIds = new Set(group.nodes.map((node) => node.id));
    setActiveDataOperationKey(group.key);

    if (nodeId) {
      const exactNodeIds = new Set([targetNode.id]);
      setHighlightedOperationIds(exactNodeIds);
      setPinnedSoqlIds(group.kind === 'soql' ? exactNodeIds : new Set());
      pendingGroupFocusRef.current = null;
      selectNode(targetNode.id, true, undefined, { focusCanvas: true, forceRevealSource: true });
      return;
    }

    setHighlightedOperationIds(groupNodeIds);
    setPinnedSoqlIds(group.kind === 'soql' ? groupNodeIds : new Set());
    pendingGroupFocusRef.current = { nodeIds: groupNodeIds };
    selectNode(targetNode.id, true, undefined, { forceRevealSource: true });
  }, [activeDataOperationKey, activeDmlFocusId, activeRevealSourceId, dataOperationReturnPoint, expandedIds, nodeById, selectNode, selectedId]);

  const clearDataOperationFocus = useCallback(() => {
    pendingGroupFocusRef.current = null;
    setHighlightedOperationIds(new Set());
    setPinnedSoqlIds(new Set());
    setActiveDataOperationKey(null);
    setDataOperationReturnPoint(null);
  }, []);

  const returnToDataOperationStart = useCallback(() => {
    const returnPoint = dataOperationReturnPoint;
    clearDataOperationFocus();
    setLeftRailMode('story');
    if (!returnPoint) {
      return;
    }

    pendingViewportRestoreRef.current = returnPoint.viewport ?? null;
    setLayoutAnchor(null);
    setSelectedId(returnPoint.selectedId);
    setActiveRevealSourceId(returnPoint.activeRevealSourceId);
    setActiveDmlFocusId(returnPoint.activeDmlFocusId);
    setExpandedIds(new Set(returnPoint.expandedIds));
    const returnSelectedId = returnPoint.selectedId;
    if (returnSelectedId) {
      setNavHistory((prev) => {
        const nextStack = prev.stack.slice(0, prev.index + 1);
        if (nextStack[nextStack.length - 1] === returnSelectedId) {
          return prev;
        }
        return {
          stack: [...nextStack, returnSelectedId],
          index: nextStack.length
        };
      });
    }
  }, [clearDataOperationFocus, dataOperationReturnPoint]);

  const togglePinnedSoql = useCallback((id: string) => {
    setPinnedSoqlIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const startResize = useCallback((target: keyof PanelSizes, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = panelSizes;
    const maxRightWidth = maxInspectorWidth(isLeftRailCollapsed, start.left);

    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setPanelSizes({
        left: target === 'left' ? clamp(start.left + dx, 240, 520) : start.left,
        right: target === 'right' ? clamp(start.right - dx, RIGHT_PANEL_MIN_WIDTH, maxRightWidth) : start.right,
        evidence: target === 'evidence' ? clamp(start.evidence - dy, 120, 460) : start.evidence
      });
    };

    const stop = () => {
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };

    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }, [isLeftRailCollapsed, panelSizes]);

  useEffect(() => {
    const handleResize = () => {
      setPanelSizes((current) => ({
        ...current,
        right: clamp(current.right, RIGHT_PANEL_MIN_WIDTH, maxInspectorWidth(isLeftRailCollapsed, current.left))
      }));
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [isLeftRailCollapsed]);

  const ActiveDataOperationIcon = activeDataOperationGroup?.kind === 'dml'
    ? Database
    : activeDataOperationGroup?.kind === 'async'
      ? Send
    : activeDataOperationGroup?.kind === 'email'
      ? Mail
      : activeDataOperationGroup?.kind === 'callout'
        ? Globe2
        : activeDataOperationGroup?.kind === 'exception'
          ? AlertTriangle
        : Search;
  const activeAsyncGroupRole =
    activeDataOperationGroup?.kind === 'async' ? asyncGroupRole(activeDataOperationGroup) : undefined;
  const activeDataOperationUnit = activeDataOperationGroup
    ? dataOperationCountUnit(activeDataOperationGroup)
    : '';
  const nextExplicitTheme: ThemeMode = isLightTheme ? 'dark' : 'light';
  const ThemeIcon = nextExplicitTheme === 'dark' ? Moon : Sun;
  const themeButtonLabel =
    themePreference === 'system'
      ? `Following system appearance (${systemTheme}). Click to switch to ${nextExplicitTheme} mode.`
      : `Appearance: ${themePreference}. Click to switch to ${nextExplicitTheme} mode.`;
  const selectedPath = selectedNode ? buildSelectedPath(selectedNode, nodeById) : [];
  const graphDisplayControls = buildGraphDisplayControls(
    hasTriggerNodes,
    hasFlowNodes,
    hasErrorNodes,
    hasAsyncIndex,
    hasCalloutIndex,
    hasApexActionNodes
  );

  return (
    <div
      className={`app-shell theme-${theme}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        handleFile(event.dataTransfer.files[0]);
      }}
    >
      <header className="topbar">
        <div className="brand" data-tour-id="brand">
          <div className="brand-mark">
            <img src={appIconUrl} alt="" aria-hidden="true" />
          </div>
          <div>
            <h1>Apex Debug Log Explorer</h1>
            <p>{fileName}</p>
          </div>
        </div>

        <div className="topbar-metrics" aria-label="Log summary" data-tour-id="summary-metrics">
          <MetricCard label="Duration" value={formatMs(result?.summary.durationMs ?? 0)} tone="neutral" compact />
          <MetricCard label="DML" value={result?.summary.dmlCount ?? 0} tone="dml" compact />
          <MetricCard label="SOQL" value={result?.summary.soqlCount ?? 0} tone="soql" compact />
          <MetricCard label="Code units" value={result?.summary.codeUnitCount ?? 0} tone="apex" compact />
          <MetricCard label="Flow interviews" value={result?.summary.flowCount ?? 0} tone="flow" compact />
        </div>

        <div className="topbar-actions">
          <button
            className="icon-button"
            onClick={startGuidedTour}
            disabled={!result}
            title={result ? 'Replay product tour' : 'Upload a log to start the product tour'}
            aria-label={result ? 'Replay product tour' : 'Upload a log to start the product tour'}
            data-tooltip={result ? 'Replay product tour' : 'Upload a log to start the product tour'}
          >
            <CircleHelp size={15} />
          </button>
          <button
            className="icon-button theme-toggle"
            onClick={() => setThemePreference(nextExplicitTheme)}
            title={themeButtonLabel}
            aria-label={themeButtonLabel}
            data-tooltip={themeButtonLabel}
          >
            <ThemeIcon size={15} />
          </button>
          <button
            className="primary-button upload-icon-button"
            onClick={openPicker}
            disabled={isOpeningLog}
            title={isOpeningLog ? 'Opening log picker' : 'Upload debug log'}
            aria-label={isOpeningLog ? 'Opening log picker' : 'Upload debug log'}
            data-tooltip={isOpeningLog ? 'Opening log picker' : 'Upload debug log'}
          >
            <FileUp size={16} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".log,.txt,text/plain"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
        </div>
      </header>

      <main
        className={`workspace ${isLeftRailCollapsed ? 'left-collapsed' : ''} ${isInspectorCollapsed ? 'right-collapsed' : ''}`}
        style={
          {
            '--left-rail-width': isLeftRailCollapsed ? '0px' : `${panelSizes.left}px`,
            '--left-resize-width': isLeftRailCollapsed ? '0px' : '7px',
            '--inspector-width': isInspectorCollapsed ? '0px' : `${panelSizes.right}px`,
            '--right-resize-width': isInspectorCollapsed ? '0px' : '7px',
            '--evidence-height': `${isEvidenceCollapsed ? 44 : panelSizes.evidence}px`
          } as CSSProperties
        }
      >
        {isLeftRailCollapsed && (
          <button
            type="button"
            className="edge-panel-toggle edge-panel-toggle-left"
            onClick={() => setIsLeftRailCollapsed(false)}
            title="Show execution tree"
            aria-label="Show execution tree"
            data-tooltip="Show execution tree"
          >
            <PanelLeftOpen size={16} />
          </button>
        )}

        {isInspectorCollapsed && (
          <button
            type="button"
            className="edge-panel-toggle edge-panel-toggle-right"
            onClick={() => setIsInspectorCollapsed(false)}
            title="Show inspector"
            aria-label="Show inspector"
            data-tooltip="Show inspector"
          >
            <PanelRightOpen size={16} />
          </button>
        )}

        <aside className="left-rail" data-tour-id="execution-tree">
          <div className="rail-header">
            <div>
              <h2>
                {leftRailMode === 'story'
                  ? 'Execution Tree'
                  : leftRailMode === 'dml'
                    ? 'DML Index'
                  : leftRailMode === 'soql'
                    ? 'SOQL Index'
                  : leftRailMode === 'errors'
                      ? 'Error Index'
                      : leftRailMode === 'email'
                        ? 'Email Index'
                        : leftRailMode === 'callouts'
                          ? 'Callout Index'
                        : 'Async Apex'}
              </h2>
              <p>
                {leftRailMode === 'story'
                  ? `${formatNumber(importantNodes.length)} story events`
                  : leftRailMode === 'dml'
                    ? `${formatNumber(dataOperationIndex.dmlGroups.length)} grouped writes`
                    : leftRailMode === 'soql'
                      ? `${formatNumber(dataOperationIndex.soqlGroups.length)} query shapes`
                      : leftRailMode === 'errors'
                        ? `${formatNumber(dataOperationIndex.errorGroups.length)} grouped errors`
                      : leftRailMode === 'email'
                        ? `${formatNumber(dataOperationIndex.emailGroups.length)} grouped sends`
                        : leftRailMode === 'callouts'
                          ? `${formatNumber(dataOperationIndex.calloutGroups.length)} grouped callouts`
                        : `${formatNumber(dataOperationIndex.asyncGroups.length)} grouped requests`}
              </p>
            </div>
            <button
              type="button"
              className="icon-button panel-toggle"
              onClick={() => setIsLeftRailCollapsed(true)}
              title="Collapse execution tree"
              aria-label="Collapse execution tree"
              data-tooltip="Collapse execution tree"
            >
              <PanelLeftClose size={15} />
            </button>
          </div>

          <label className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search method, object, flow, Id"
            />
          </label>

          <div className="rail-mode-tabs" role="group" aria-label="Left rail view" data-tour-id="data-index-tabs">
            <button
              type="button"
              className={`rail-mode-tab tab-story ${leftRailMode === 'story' ? 'active' : ''}`}
              onClick={() => setLeftRailMode('story')}
            >
              <Waypoints size={14} />
              Story
              <span>{formatNumber(importantNodes.length)}</span>
            </button>
            <button
              type="button"
              className={`rail-mode-tab tab-dml ${leftRailMode === 'dml' ? 'active' : ''}`}
              onClick={() => setLeftRailMode('dml')}
            >
              <Database size={14} />
              DML
              <span>{formatNumber(dataOperationIndex.dmlGroups.reduce((total, group) => total + group.executionCount, 0))}</span>
            </button>
            <button
              type="button"
              className={`rail-mode-tab tab-soql ${leftRailMode === 'soql' ? 'active' : ''}`}
              onClick={() => setLeftRailMode('soql')}
            >
              <Search size={14} />
              SOQL
              <span>{formatNumber(dataOperationIndex.soqlGroups.reduce((total, group) => total + group.executionCount, 0))}</span>
            </button>
            <button
              type="button"
              className={`rail-mode-tab tab-errors ${leftRailMode === 'errors' ? 'active' : ''}`}
              onClick={() => setLeftRailMode('errors')}
            >
              <AlertTriangle size={14} />
              Errors
              <span>{formatNumber(dataOperationIndex.errorGroups.reduce((total, group) => total + group.executionCount, 0))}</span>
            </button>
            {hasAsyncIndex && (
              <button
                type="button"
                className={`rail-mode-tab tab-async ${leftRailMode === 'async' ? 'active' : ''}`}
                onClick={() => setLeftRailMode('async')}
              >
                <Send size={14} />
                Async Apex
                <span>{formatNumber(dataOperationIndex.asyncGroups.reduce((total, group) => total + group.executionCount, 0))}</span>
              </button>
            )}
            {hasEmailIndex && (
              <button
                type="button"
                className={`rail-mode-tab tab-email ${leftRailMode === 'email' ? 'active' : ''}`}
                onClick={() => setLeftRailMode('email')}
              >
                <Mail size={14} />
                Email
                <span>{formatNumber(dataOperationIndex.emailGroups.reduce((total, group) => total + group.executionCount, 0))}</span>
              </button>
            )}
            {hasCalloutIndex && (
              <button
                type="button"
                className={`rail-mode-tab tab-callouts ${leftRailMode === 'callouts' ? 'active' : ''}`}
                onClick={() => setLeftRailMode('callouts')}
              >
                <Globe2 size={14} />
                Callouts
                <span>{formatNumber(dataOperationIndex.calloutGroups.reduce((total, group) => total + group.executionCount, 0))}</span>
              </button>
            )}
          </div>

          <div ref={spineListRef} className="spine-list">
            <div className="indicator-top" />
            {!result ? (
              <div className="empty-rail">
                <FileUp size={18} />
                <span>Upload a Salesforce debug log to populate the execution spine.</span>
              </div>
            ) : leftRailMode === 'dml' || leftRailMode === 'soql' || leftRailMode === 'errors' || leftRailMode === 'async' || leftRailMode === 'email' || leftRailMode === 'callouts' ? (
              <DataOperationIndexList
                groups={
                  leftRailMode === 'dml'
                    ? dataOperationIndex.dmlGroups
                    : leftRailMode === 'soql'
                      ? dataOperationIndex.soqlGroups
                      : leftRailMode === 'errors'
                        ? dataOperationIndex.errorGroups
                      : leftRailMode === 'email'
                        ? dataOperationIndex.emailGroups
                        : leftRailMode === 'callouts'
                          ? dataOperationIndex.calloutGroups
                        : dataOperationIndex.asyncGroups
                }
                mode={leftRailMode}
                activeKey={activeDataOperationKey}
                selectedId={selectedId}
                onSelectGroup={selectDataOperationGroup}
              />
            ) : (
              <>
                {importantNodes.slice(0, spineLimit).map((node) => (
                  <button
                    key={node.id}
                    data-node-kind={node.kind}
                    className={`spine-row ${selectedId === node.id ? 'active' : ''}`}
                    onClick={() => {
                      clearDataOperationFocus();
                      selectNode(node.id, true, undefined, { focusCanvas: true, autoSelectFirstChild: shouldAutoSelectFirstChild(node) });
                    }}
                  >
                    <KindIcon kind={node.kind} />
                    <span className="spine-content">
                      <span className="spine-title">{node.label}</span>
                      <span className="spine-meta">
                        line {node.lineStart}
                        {node.subtitle ? ` · ${node.subtitle}` : ''}
                      </span>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
                {importantNodes.length > spineLimit && (
                  <button
                    type="button"
                    className="spine-load-more"
                    onClick={() => setSpineLimit((prev) => prev + 250)}
                    style={{
                      width: 'calc(100% - 24px)',
                      margin: '12px',
                      padding: '8px',
                      background: 'rgba(148, 163, 184, 0.1)',
                      border: '1px solid rgba(148, 163, 184, 0.2)',
                      borderRadius: '6px',
                      color: '#c8d3e2',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: '600',
                      textAlign: 'center'
                    }}
                  >
                    Load more events (showing {spineLimit} of {importantNodes.length})
                  </button>
                )}
              </>
            )}
            <div className="indicator-bottom" />
          </div>
        </aside>

        <div className="resize-handle resize-handle-vertical resize-left" onPointerDown={(event) => startResize('left', event)} />

        <section className="graph-stage">
          <div className="graph-toolbar">
            <div className="graph-toolbar-title">
              <h2>Execution Flow</h2>
            </div>
            <div className="toolbar-actions" data-tour-id="graph-controls">
              <div className="history-navigation" style={{ display: 'flex', gap: '4px', marginRight: '8px' }}>
                <button
                  type="button"
                  className="icon-button"
                  onClick={navigateBack}
                  disabled={navHistory.index <= -1}
                  title="Navigate back (Cmd/Ctrl+Z)"
                  aria-label="Navigate back"
                  data-tooltip="Navigate back"
                >
                  <ArrowLeft size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={navigateForward}
                  disabled={navHistory.index >= navHistory.stack.length - 1}
                  title="Navigate forward (Cmd/Ctrl+Y)"
                  aria-label="Navigate forward"
                  data-tooltip="Navigate forward"
                >
                  <ArrowRight size={15} />
                </button>
              </div>
              <div className="canvas-mode-toggle" role="group" aria-label="Canvas navigation mode">
                <button
                  type="button"
                  className={`mode-button ${canvasMode === 'inspect' ? 'active' : ''}`}
                  aria-pressed={canvasMode === 'inspect'}
                  title="Inspect nodes"
                  onClick={() => setCanvasMode('inspect')}
                >
                  <MousePointer2 size={15} />
                  Inspect
                </button>
                <button
                  type="button"
                  className={`mode-button ${isPanLocked ? 'active' : ''}`}
                  aria-pressed={isPanLocked}
                  title="Lock canvas panning"
                  onClick={() => setCanvasMode('pan')}
                >
                  <Hand size={15} />
                  Pan lock
                </button>
              </div>
              <button
                className="icon-button"
                onClick={resetInitialView}
                disabled={!initialView}
                title="Reset to loaded view"
                aria-label="Reset to loaded view"
                data-tooltip="Reset to loaded view"
              >
                <RotateCcw size={15} />
              </button>
              <button
                className="icon-button"
                onClick={exportGraphPng}
                disabled={!result}
                title="Export PNG"
                aria-label="Export PNG"
                data-tooltip="Export PNG"
              >
                <Download size={15} />
              </button>
            </div>
          </div>

          <div className="graph-investigation-panel">
            {activeDataOperationGroup && (
              <div className={`operation-focus-bar focus-${activeDataOperationGroup.kind} ${activeDataOperationGroup.tone ? `focus-tone-${activeDataOperationGroup.tone}` : ''}`}>
                <div className="operation-focus-summary">
                  <ActiveDataOperationIcon size={15} />
                  <span>
                    <strong>
                      {activeDataOperationGroup.kind === 'dml'
                        ? 'DML group'
                        : activeDataOperationGroup.kind === 'soql'
                        ? 'SOQL group'
                      : activeDataOperationGroup.kind === 'email'
                          ? 'Email group'
                        : activeDataOperationGroup.kind === 'callout'
                          ? 'Callout group'
                          : activeDataOperationGroup.kind === 'exception'
                            ? 'Error group'
                          : activeAsyncGroupRole === 'transaction'
                            ? 'Async Apex transaction'
                            : 'Async Apex request'}
                    </strong>
                    <em>{activeDataOperationGroup.label}</em>
                  </span>
                  <small>
                    {formatNumber(activeDataOperationGroup.executionCount)}
                    {activeDataOperationGroup.kind === 'dml'
                      ? ' statements'
                      : activeDataOperationGroup.kind === 'soql'
                        ? ' executions'
                        : activeDataOperationGroup.kind === 'exception'
                          ? ' errors'
                        : ` ${activeDataOperationUnit}${activeDataOperationGroup.executionCount === 1 ? '' : 's'}`}
                    {activeDataOperationGroup.rowCount > 0 ? ` · ${formatNumber(activeDataOperationGroup.rowCount)} rows` : ''}
                    {activeDataOperationGroup.kind === 'soql' && activeDataOperationGroup.durationMs > 0
                      ? ` · ${formatMs(activeDataOperationGroup.durationMs)} SOQL time`
                      : ''}
                  </small>
                </div>
                <div className="operation-focus-actions">
                  <button
                    type="button"
                    className="focus-action"
                    onClick={returnToDataOperationStart}
                    disabled={!dataOperationReturnPoint}
                    title="Return to the graph position before this index focus"
                  >
                    <Waypoints size={14} />
                    Back to story
                  </button>
                  <button
                    type="button"
                    className="focus-action"
                    onClick={clearDataOperationFocus}
                    title="Remove this index highlight and keep the current graph position"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            <div className="graph-view-row graph-display-row" data-tour-id="graph-display-controls">
              <div className="view-preset-group graph-family-toggle-group" role="group" aria-label="Graph display">
                {graphDisplayControls.map((control) => {
                  const ControlIcon = control.icon;
                  const isEnabled = enabledKinds.has(control.key);
                  return (
                    <button
                      key={control.key}
                      type="button"
                      className={`view-preset graph-family-toggle family-${control.key} ${isEnabled ? 'active' : ''}`}
                      aria-pressed={isEnabled}
                      title={control.description}
                      data-tooltip={control.description}
                      onClick={() => toggleGraphVisibility(control.key)}
                    >
                      <ControlIcon size={14} />
                      {control.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`view-preset expand-all-toggle ${isGraphFullyExpanded ? 'collapse-mode' : 'expand-mode'}`}
                  onClick={toggleAllVisibleFamilies}
                  disabled={!result}
                  title={expandCollapseTitle}
                  aria-label={expandCollapseTitle}
                  data-tooltip={expandCollapseTitle}
                >
                  {isGraphFullyExpanded ? <Minimize2 size={14} /> : <Layers3 size={14} />}
                  {expandCollapseLabel}
                </button>
              </div>
            </div>

            <div className="selected-path-row" aria-label="Selected execution path">
              <span className="selected-path-label">Selected path</span>
              {selectedPath.length > 0 ? (
                <div className="selected-path-items">
                  {selectedPath.map((node, index) => (
                    <span key={node.id} className={`selected-path-item kind-${node.kind}`}>
                      {index > 0 && <ChevronRight size={12} />}
                      <KindIcon kind={node.kind} />
                      <span>{compactPathLabel(node)}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="selected-path-empty">Upload a log and select a node to start tracing.</span>
              )}
            </div>
          </div>

          <div ref={canvasRef} className={`canvas ${isPanLocked ? 'pan-locked' : 'inspect-mode'}`} data-tour-id="graph-canvas">
            {isParsing ? (
              <StateOverlay title="Parsing locally" body="Building a compressed execution story from the raw log." />
            ) : parseError ? (
              <StateOverlay title="Parser stopped" body={parseError} />
            ) : !result ? (
              <LandingPage onUploadClick={openPicker} />
            ) : (
              <ReactFlow
                key={`${fileName}-${result?.summary.lineCount ?? 0}`}
                nodes={visibleGraph.nodes}
                edges={visibleGraph.edges}
                nodeTypes={nodeTypes}
                onInit={(instance) => {
                  reactFlowRef.current = instance;
                }}
                onNodeClick={(event, node) => {
                  if (event.detail > 1) {
                    return;
                  }
                  if (!isPanLocked && node.data.storyNode.kind !== 'gap') {
                    if (!highlightedOperationIds.has(node.id)) {
                      clearDataOperationFocus();
                    }
                    const collapsed = collapseNodeBranch(node.id, true, node.position);
                    if (!collapsed) {
                      selectNode(node.id, true, node.position, { autoSelectFirstChild: shouldAutoSelectFirstChild(node.data.storyNode) });
                    }
                  }
                }}
                fitView
                minZoom={0.18}
                maxZoom={1.4}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={!isPanLocked}
                selectNodesOnDrag={false}
                panOnScroll
                panOnScrollMode={PanOnScrollMode.Free}
                panOnScrollSpeed={0.72}
                panOnDrag={isPanLocked}
                panActivationKeyCode="Space"
                zoomOnScroll={false}
                zoomOnPinch
                zoomActivationKeyCode={['Meta', 'Control']}
                zoomOnDoubleClick={false}
                paneClickDistance={4}
                nodeClickDistance={4}
                preventScrolling
                fitViewOptions={{ padding: 0.22 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background color={isLightTheme ? '#c7d6e2' : '#1c2a36'} gap={18} size={1} />
                <MiniMap
                  position="top-right"
                  pannable={false}
                  zoomable={false}
                  nodeColor={(node) => graphNodeColor((node.data as GraphNodeData).storyNode, isLightTheme)}
                  maskColor={isLightTheme ? 'rgba(242, 247, 251, 0.66)' : 'rgba(3, 8, 12, 0.72)'}
                  style={{ width: 148, height: 96, opacity: 0.72, pointerEvents: 'none' }}
                />
                <Controls position="bottom-left" />
              </ReactFlow>
            )}
          </div>

          <div className="resize-handle resize-handle-horizontal resize-evidence" onPointerDown={(event) => startResize('evidence', event)} />
          <EvidenceDrawer
            selectedNode={selectedNode}
            evidenceLines={evidenceLines}
            collapsed={isEvidenceCollapsed}
            onToggleCollapsed={() => setIsEvidenceCollapsed((current) => !current)}
            hasHiddenLines={hasHiddenLines}
            showFullEvidence={showFullEvidence}
            onToggleShowFullEvidence={() => setShowFullEvidence((prev) => !prev)}
          />
        </section>

        <div className="resize-handle resize-handle-vertical resize-right" onPointerDown={(event) => startResize('right', event)} />

        <aside ref={inspectorRef} className="inspector" data-tour-id="inspector">
          <button
            type="button"
            className="icon-button panel-toggle inspector-panel-toggle"
            onClick={() => setIsInspectorCollapsed(true)}
            title="Collapse inspector"
            aria-label="Collapse inspector"
            data-tooltip="Collapse inspector"
          >
            <PanelRightClose size={15} />
          </button>
          <div className="indicator-top" />
          <Inspector
            selectedNode={selectedNode}
            nodeById={nodeById}
            summary={result?.summary ?? null}
            enabledKinds={enabledKinds}
            query={query}
            selectedGapMs={selectedGapMs}
            pinnedSoqlIds={pinnedSoqlIds}
            onSelectNode={selectNode}
            onTogglePinnedSoql={togglePinnedSoql}
          />
          <div className="indicator-bottom" />
        </aside>
      </main>
      <GuidedTour
        open={isTourOpen}
        steps={TOUR_STEPS}
        currentIndex={tourStepIndex}
        onBack={() => setTourStepIndex((index) => Math.max(0, index - 1))}
        onNext={() => setTourStepIndex((index) => Math.min(TOUR_STEPS.length - 1, index + 1))}
        onSkip={() => finishGuidedTour('skipped')}
        onDone={() => finishGuidedTour('completed')}
      />
    </div>
  );
}

function GuidedTour({
  open,
  steps,
  currentIndex,
  onBack,
  onNext,
  onSkip,
  onDone
}: {
  open: boolean;
  steps: TourStep[];
  currentIndex: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onDone: () => void;
}) {
  const step = steps[currentIndex];
  const [rect, setRect] = useState<TourRect | null>(null);
  const isLast = currentIndex >= steps.length - 1;

  useEffect(() => {
    if (!open || !step) {
      setRect(null);
      return;
    }

    const updateRect = () => {
      const element = document.querySelector(step.selector);
      const next = element?.getBoundingClientRect();
      if (!next || next.width <= 0 || next.height <= 0) {
        setRect(null);
        return;
      }
      setRect({
        top: next.top,
        left: next.left,
        width: next.width,
        height: next.height
      });
    };

    const frame = window.requestAnimationFrame(updateRect);
    const interval = window.setInterval(updateRect, 240);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [open, step]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onSkip();
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (isLast) {
          onDone();
        } else {
          onNext();
        }
      }
      if (event.key === 'ArrowLeft' && currentIndex > 0) {
        event.preventDefault();
        onBack();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, isLast, onBack, onDone, onNext, onSkip, open]);

  if (!open || !step) {
    return null;
  }

  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-labelledby="product-tour-title">
      {rect && <div className="tour-spotlight" style={tourSpotlightStyle(rect)} />}
      <section className="tour-card" style={tourCardStyle(rect, step.placement)}>
        <div className="tour-card-kicker">
          <Sparkles size={14} />
          Product tour
          <span>
            {currentIndex + 1}/{steps.length}
          </span>
        </div>
        <h2 id="product-tour-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-progress" aria-hidden="true">
          {steps.map((tourStep, index) => (
            <span key={tourStep.id} className={index <= currentIndex ? 'active' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button type="button" className="tour-link-button" onClick={onSkip} aria-label="Skip product tour">
            Skip
          </button>
          <div>
            <button
              type="button"
              className="tour-secondary-button"
              onClick={onBack}
              disabled={currentIndex === 0}
              aria-label="Previous product tour step"
            >
              Back
            </button>
            <button
              type="button"
              className="tour-primary-button"
              onClick={isLast ? onDone : onNext}
              aria-label={isLast ? 'Finish product tour' : 'Next product tour step'}
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function DataOperationIndexList({
  groups,
  mode,
  activeKey,
  selectedId,
  onSelectGroup
}: {
  groups: DataOperationGroup[];
  mode: 'dml' | 'soql' | 'errors' | 'async' | 'email' | 'callouts';
  activeKey: string | null;
  selectedId: string | null;
  onSelectGroup: (group: DataOperationGroup, nodeId?: string) => void;
}) {
  if (groups.length === 0) {
    const EmptyIcon = mode === 'dml' ? Database : mode === 'soql' ? Search : mode === 'errors' ? AlertTriangle : mode === 'email' ? Mail : mode === 'callouts' ? Globe2 : Send;
    return (
      <div className="empty-rail data-index-empty">
        <EmptyIcon size={18} />
        <span>
          No {mode === 'dml' ? 'DML statements' : mode === 'soql' ? 'SOQL query events' : mode === 'errors' ? 'error events' : mode === 'email' ? 'email sends' : mode === 'callouts' ? 'callouts' : 'Async Apex requests'} match this search.
        </span>
      </div>
    );
  }

  return (
    <div className="data-index-list">
      {groups.map((group) => {
        const isOpen = activeKey === group.key;
        const Icon = group.kind === 'dml' ? Database : group.kind === 'soql' ? Search : group.kind === 'exception' ? AlertTriangle : group.kind === 'email' ? Mail : group.kind === 'callout' ? Globe2 : Send;
        const toneClass = group.tone ? `data-tone-${group.tone}` : '';
        return (
          <div key={group.key} className={`data-index-card data-kind-${group.kind} ${toneClass} ${isOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="data-index-summary"
              onClick={() => onSelectGroup(group)}
              title={group.detail}
            >
              <Icon size={15} />
              <span className="data-index-main">
                <strong>{group.label}</strong>
                <small>{group.subtitle}</small>
              </span>
              <span className="data-index-count">
                {formatNumber(group.executionCount)}
                <small>{group.kind === 'soql' ? 'exec' : group.kind === 'async' ? (asyncGroupRole(group) === 'transaction' ? 'txn' : 'req') : group.kind === 'email' ? 'send' : group.kind === 'callout' ? 'call' : group.kind === 'exception' ? 'err' : 'stmt'}</small>
              </span>
            </button>

            {isOpen && (
              <div className="data-index-occurrences">
                {group.detail && group.kind === 'soql' && <code>{compactQueryForDisplay(group.detail)}</code>}
                {group.detail && group.kind === 'exception' && <code>{compactErrorMessage(group.detail)}</code>}
                {group.occurrences.map((occurrence) => (
                  <button
                    key={occurrence.node.id}
                    type="button"
                    className={`data-occurrence-row owner-${occurrence.ownerKind} occurrence-color-${occurrence.colorIndex} ${occurrence.tone ? `occurrence-tone-${occurrence.tone}` : ''} ${selectedId === occurrence.node.id ? 'active' : ''}`}
                    onClick={() => onSelectGroup(group, occurrence.node.id)}
                  >
                    <span className="data-occurrence-marker">{occurrence.sequence}</span>
                    <span className="data-occurrence-main">
                      <strong>{occurrence.ownerLabel}</strong>
                      <small>{occurrence.lineLabel}</small>
                    </span>
                    <em>{occurrence.countLabel}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StoryGraphNode({ data }: NodeProps<Node<GraphNodeData>>) {
  const {
    storyNode,
    selected,
    expanded,
    childCount,
    executionOrder,
    querySummary,
    downstreamQuerySummary,
    soqlLensEnabled,
    relation,
    failureRole,
    downstreamFailureCount,
    isDataOperationHighlighted,
    riskLevel,
    warnings,
    gapBeforeMs,
    theme
  } = data;
  const isLightTheme = theme === 'light';
  const style = isLightTheme ? LIGHT_KIND_STYLE[storyNode.kind] : KIND_STYLE[storyNode.kind];
  const dmlClassification = storyNode.kind === 'dml' ? classifyDmlNode(storyNode, []) : null;
  const visualStyle = dmlClassification
    ? (isLightTheme ? LIGHT_DML_TONE_STYLE[dmlClassification.tone] : DML_TONE_STYLE[dmlClassification.tone])
    : style;
  const hasQueryLens = soqlLensEnabled && querySummary !== undefined && querySummary.executionCount > 0;
  const hasDownstreamQueryLens =
    soqlLensEnabled && downstreamQuerySummary !== undefined && downstreamQuerySummary.executionCount > 0;
  const nextCue = childCount > 0 ? nextCueText(storyNode, childCount, selected, expanded) : null;

  return (
    <div
      className={`graph-node kind-${storyNode.kind} relation-${relation} failure-${failureRole} risk-${riskLevel} ${selected ? 'selected' : ''} ${isDataOperationHighlighted ? 'data-op-highlight' : ''} ${dmlClassification ? `dml-${dmlClassification.tone}` : ''} ${hasQueryLens ? `soql-lens-node ${soqlLensTone(querySummary)}` : ''}`}
      style={{ '--node-color': visualStyle.color, '--node-bg': visualStyle.bg } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-topline">
        <span className="node-kind">
          {executionOrder !== undefined && (
            <span className="node-order-badge" title="Visible execution order from the raw log">
              Seq {executionOrder}
            </span>
          )}
          <KindIcon kind={storyNode.kind} />
          {dmlClassification?.label ?? storyKindLabel(storyNode, style.label)}
        </span>
        <span className="node-line">L{storyNode.lineStart}</span>
      </div>
      <div className="node-label">{storyNode.label}</div>
      <div className="node-subtitle">{nodeSubtitle(storyNode)}</div>
      {hasNodeVisualMetrics(storyNode) && (
        <div className="node-metrics-row">
          {Number(storyNode.metrics.soqlQueries || 0) > 0 && (
            <span className="node-metric-tag soql">
              <Database size={8} />
              {storyNode.metrics.soqlQueries} SOQL
            </span>
          )}
          {Number(storyNode.metrics.dmlStatements || 0) > 0 && (
            <span className="node-metric-tag dml">
              <Bolt size={8} />
              {storyNode.metrics.dmlStatements} DML
            </span>
          )}
          {Number(storyNode.metrics.cpuMs || 0) > 0 && (
            <span className="node-metric-tag cpu">
              <Gauge size={8} />
              {storyNode.metrics.cpuMs}ms CPU
            </span>
          )}
        </div>
      )}
      {hasQueryLens && querySummary && (
        <div
          className="soql-lens-row"
          title={`${formatNumber(querySummary.executionCount)} SOQL execution${querySummary.executionCount === 1 ? '' : 's'} owned here. ${querySummary.repeatCount > 0 ? `${formatNumber(querySummary.repeatCount)} are repeats after the first execution.` : 'No repeat executions detected.'}`}
        >
          <span>
            <Database size={10} />
            {formatNumber(querySummary.executionCount)} local SOQL
          </span>
          <span>{formatNumber(querySummary.rowCount)} rows</span>
          {querySummary.repeatCount > 0 && <span>{formatNumber(querySummary.repeatCount)} repeated</span>}
        </div>
      )}
      {hasDownstreamQueryLens && downstreamQuerySummary && (
        <div
          className="soql-lens-row downstream"
          title={`${formatNumber(downstreamQuerySummary.executionCount)} SOQL execution${downstreamQuerySummary.executionCount === 1 ? '' : 's'} happen downstream from this node.`}
        >
          <span>
            <Database size={10} />
            {formatNumber(downstreamQuerySummary.executionCount)} downstream SOQL
          </span>
        </div>
      )}
      {downstreamFailureCount > 0 && failureRole === 'selected-parent' && (
        <div
          className="node-failure-row downstream-failure"
          title={`${formatNumber(downstreamFailureCount)} exception${downstreamFailureCount === 1 ? '' : 's'} happened downstream. This node is the parent context, not the throw site.`}
        >
          <AlertTriangle size={12} />
          <span>{formatNumber(downstreamFailureCount)} downstream error{downstreamFailureCount === 1 ? '' : 's'}</span>
        </div>
      )}
      {failureRole === 'path' && (
        <div className="node-failure-row path-failure" title="This node is on the path to the downstream exception.">
          <AlertTriangle size={12} />
          <span>failure path</span>
        </div>
      )}
      {failureRole === 'source' && storyNode.kind === 'exception' && (
        <div className="node-failure-row source-failure" title="This is the exception node emitted by the log.">
          <AlertTriangle size={12} />
          <span>exception thrown here</span>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="node-warning-row" title={warnings.join('\n')}>
          <AlertTriangle size={12} />
          <span>{warnings[0]}</span>
        </div>
      )}
      {dmlClassification && (
        <div className="node-chip-row">
          {dmlClassification.badges.slice(0, 2).map((badge) => (
            <span key={badge}>{badge}</span>
          ))}
        </div>
      )}
      <div className="node-footer">
        <span>{formatMs(storyNode.durationMs ?? 0)}</span>
        {gapBeforeMs !== undefined && gapBeforeMs > 2000 && <span>{formatMs(gapBeforeMs)} gap</span>}
        {nextCue && (
          <span className="node-next-cue" title={nextCue.title}>
            {nextCue.label}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function GovernorProgressBar({
  label,
  used,
  max,
  unit,
  format
}: {
  label: string;
  used: number;
  max: number;
  unit?: string;
  format?: 'bytes';
}) {
  if (used === 0 && max === 0) return null;
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const percentage = Math.round(ratio * 100);

  let tone = 'safe';
  if (ratio >= 0.85 || (label === 'CPU Usage' && used > max)) {
    tone = 'danger';
  } else if (ratio >= 0.5) {
    tone = 'watch';
  }

  let usedStr = String(used);
  let maxStr = String(max);
  if (format === 'bytes') {
    usedStr = formatBytes(used);
    maxStr = formatBytes(max);
  } else if (unit) {
    usedStr = `${used}${unit}`;
    maxStr = `${max}${unit}`;
  }

  return (
    <div className={`limit-progress-item limit-tone-${tone}`} style={{ fontSize: '11px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <strong style={{ color: '#e2e8f0', fontWeight: '600' }}>{label}</strong>
        <span className="muted" style={{ fontSize: '10px', color: '#94a3b8' }}>
          {usedStr} / {maxStr} ({percentage}%)
        </span>
      </div>
      <div style={{
        height: '6px',
        background: 'rgba(148, 163, 184, 0.15)',
        borderRadius: '3px',
        overflow: 'hidden'
      }}>
        <div style={{
          height: '100%',
          width: `${percentage}%`,
          background: tone === 'danger' ? '#f43f5e' : tone === 'watch' ? '#eab308' : '#10b981',
          borderRadius: '3px',
          transition: 'width 0.3s ease'
        }} />
      </div>
    </div>
  );
}

function GovernorLimitsPanel({ node }: { node: StoryNode }) {
  const isFlowDelta = node.metrics.limitScope === 'Flow delta';
  const limitMetrics = [
    { key: 'soqlQueries', label: 'SOQL Queries', maxKey: 'soqlQueriesLimit' },
    { key: 'dmlStatements', label: 'DML Statements', maxKey: 'dmlStatementsLimit' },
    { key: 'cpuMs', label: 'CPU Usage', maxKey: 'cpuMsLimit', unit: 'ms' },
    { key: 'heapBytes', label: 'Heap Size', maxKey: 'heapBytesLimit', format: 'bytes' }
  ];

  const activeLimits = limitMetrics.filter(
    (m) => node.metrics[m.key] !== undefined || node.metrics[m.maxKey] !== undefined
  );

  if (activeLimits.length === 0) {
    return null;
  }

  return (
    <div className="inspector-section governor-limits">
      <div className="section-title">
        <Gauge size={16} />
        {isFlowDelta ? 'Flow Governor Usage' : 'Governor Limits Usage'}
      </div>
      {isFlowDelta && (
        <p className="section-description">
          These are deltas from the Flow interview start to finish. Salesforce reports the count, but it does not always emit the individual Flow query text as SOQL_EXECUTE_BEGIN lines.
        </p>
      )}
      <div className="limit-progress-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
        {activeLimits.map((m) => {
          const rawUsed = Number(node.metrics[m.key] ?? 0);
          const rawMax = Number(node.metrics[m.maxKey] ?? 0);
          return (
            <GovernorProgressBar
              key={m.key}
              label={m.label}
              used={rawUsed}
              max={rawMax}
              unit={m.unit}
              format={m.format as 'bytes' | undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function Inspector({
  selectedNode,
  nodeById,
  summary,
  enabledKinds,
  query,
  selectedGapMs,
  pinnedSoqlIds,
  onSelectNode,
  onTogglePinnedSoql
}: {
  selectedNode: StoryNode | null;
  nodeById: Map<string, StoryNode>;
  summary: LogSummary | null;
  enabledKinds: Set<GraphVisibilityKey>;
  query: string;
  selectedGapMs?: number;
  pinnedSoqlIds: Set<string>;
  onSelectNode: (id: string) => void;
  onTogglePinnedSoql: (id: string) => void;
}) {
  if (!selectedNode) {
    const hasLog = Boolean(summary);

    if (!hasLog) {
      return (
        <div className="empty-inspector">
          <FileUp size={20} />
          <h2>Open a log</h2>
          <p>Use the upload button or drop a Salesforce debug log to start the analysis.</p>
        </div>
      );
    }

    const s = summary!;

    // 1. Calculate max governor limits across the nodes
    let maxSoql = 0;
    let maxSoqlLimit = 100;
    let maxDml = 0;
    let maxDmlLimit = 150;
    let maxCpu = 0;
    let maxCpuLimit = 10000;
    let maxHeap = 0;
    let maxHeapLimit = 6000000;

    nodeById.forEach((node) => {
      if (node.metrics.soqlQueries !== undefined) {
        maxSoql = Math.max(maxSoql, Number(node.metrics.soqlQueries));
      }
      if (node.metrics.soqlQueriesLimit !== undefined) {
        maxSoqlLimit = Math.max(maxSoqlLimit, Number(node.metrics.soqlQueriesLimit));
      }
      if (node.metrics.dmlStatements !== undefined) {
        maxDml = Math.max(maxDml, Number(node.metrics.dmlStatements));
      }
      if (node.metrics.dmlStatementsLimit !== undefined) {
        maxDmlLimit = Math.max(maxDmlLimit, Number(node.metrics.dmlStatementsLimit));
      }
      if (node.metrics.cpuMs !== undefined) {
        maxCpu = Math.max(maxCpu, Number(node.metrics.cpuMs));
      }
      if (node.metrics.cpuMsLimit !== undefined) {
        maxCpuLimit = Math.max(maxCpuLimit, Number(node.metrics.cpuMsLimit));
      }
      if (node.metrics.heapBytes !== undefined) {
        maxHeap = Math.max(maxHeap, Number(node.metrics.heapBytes));
      }
      if (node.metrics.heapBytesLimit !== undefined) {
        maxHeapLimit = Math.max(maxHeapLimit, Number(node.metrics.heapBytesLimit));
      }
    });

    const timeProfile = buildTimelineTimeProfile(nodeById, s.durationMs);

    return (
      <div className="transaction-dashboard" style={{ padding: '0 8px' }}>
        <div className="inspector-header" style={{ borderBottom: '1px solid rgba(148,163,184,0.1)', paddingBottom: '16px', marginBottom: '16px' }}>
          <span className="kind-badge" style={{ color: '#38bdf8', background: 'rgba(56,189,248,0.1)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Sparkles size={14} />
            Summary
          </span>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: '8px 0 4px 0', color: '#f8fafc' }}>Transaction Dashboard</h2>
          <p style={{ color: '#94a3b8', fontSize: '11px', margin: 0 }}>Overview of limits, hotspots, and timeline distribution</p>
        </div>

        {/* Global Stats Grid */}
        <div className="stat-grid" style={{ marginBottom: '16px' }}>
          <InlineStat label="Duration" value={formatMs(s.durationMs)} />
          <InlineStat label="DML Count" value={s.dmlCount} />
          <InlineStat label="SOQL Count" value={s.soqlCount} />
          <InlineStat label="Flow Interviews" value={s.flowCount} />
          <InlineStat label="Triggers" value={s.triggerCount} />
          <InlineStat label="Exceptions" value={s.exceptionCount} />
        </div>

        {/* Governor Limits */}
        <div className="inspector-section">
          <div className="section-title">
            <Gauge size={16} />
            Max Governor Limits Usage
          </div>
          <div className="limit-progress-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
            <GovernorProgressBar label="SOQL Queries" used={maxSoql} max={maxSoqlLimit} />
            <GovernorProgressBar label="DML Statements" used={maxDml} max={maxDmlLimit} />
            <GovernorProgressBar label="CPU Usage" used={maxCpu} max={maxCpuLimit} unit="ms" />
            <GovernorProgressBar label="Heap Size" used={maxHeap} max={maxHeapLimit} format="bytes" />
          </div>
        </div>

        {/* Time Profiler Breakdown */}
        <div className="inspector-section">
          <div className="section-title">
            <Bolt size={16} />
            Time Profiler Breakdown
          </div>
          <div style={{ marginTop: '10px' }}>
            <div style={{
              height: '10px',
              display: 'flex',
              borderRadius: '5px',
              overflow: 'hidden',
              background: 'rgba(148, 163, 184, 0.1)'
            }}>
              {timeProfile.dbPercent > 0 && <div style={{ width: `${timeProfile.dbPercent}%`, background: '#74c7ff', transition: 'width 0.3s' }} title={`Database: ${timeProfile.dbPercent}%`} />}
              {timeProfile.flowPercent > 0 && <div style={{ width: `${timeProfile.flowPercent}%`, background: '#4ade80', transition: 'width 0.3s' }} title={`Flows: ${timeProfile.flowPercent}%`} />}
              {timeProfile.codePercent > 0 && <div style={{ width: `${timeProfile.codePercent}%`, background: '#c084fc', transition: 'width 0.3s' }} title={`Code: ${timeProfile.codePercent}%`} />}
              {timeProfile.otherPercent > 0 && <div style={{ width: `${timeProfile.otherPercent}%`, background: '#94a3b8', transition: 'width 0.3s' }} title={`Unattributed: ${timeProfile.otherPercent}%`} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px', fontSize: '11px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#74c7ff', display: 'inline-block' }} />
                  Database (DML/SOQL)
                </span>
                <strong style={{ color: '#cbd5e1' }}>{formatMs(timeProfile.dbMs)} ({timeProfile.dbPercent}%)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
                  Flow / declarative automation
                </span>
                <strong style={{ color: '#cbd5e1' }}>{formatMs(timeProfile.flowMs)} ({timeProfile.flowPercent}%)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#c084fc', display: 'inline-block' }} />
                  Apex Code
                </span>
                <strong style={{ color: '#cbd5e1' }}>{formatMs(timeProfile.codeMs)} ({timeProfile.codePercent}%)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }} />
                  Unattributed / quiet
                </span>
                <strong style={{ color: '#cbd5e1' }}>{formatMs(timeProfile.otherMs)} ({timeProfile.otherPercent}%)</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Database Profiler */}
        <div className="inspector-section">
          <div className="section-title">
            <Database size={16} />
            DML Operations by SObject
          </div>
          {s.dmlByObject.length === 0 ? (
            <p className="muted" style={{ fontSize: '11px', margin: '8px 0 0 0' }}>No DML operations in this transaction.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
              {s.dmlByObject.slice(0, 5).map((item) => (
                <div key={item.eventType} style={{ fontSize: '11px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ color: '#94a3b8' }}>{item.eventType}</span>
                    <strong style={{ color: '#cbd5e1' }}>{item.count} DMLs</strong>
                  </div>
                  <div style={{ height: '4px', background: 'rgba(148, 163, 184, 0.15)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, (item.count / s.dmlCount) * 100)}%`,
                      background: '#f97316',
                      borderRadius: '2px'
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="inspector-section">
          <div className="section-title">
            <Database size={16} />
            SOQL Queries by SObject
          </div>
          {s.soqlByObject.length === 0 ? (
            <p className="muted" style={{ fontSize: '11px', margin: '8px 0 0 0' }}>No SOQL queries in this transaction.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
              {s.soqlByObject.slice(0, 5).map((item) => (
                <div key={item.eventType} style={{ fontSize: '11px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ color: '#94a3b8' }}>{item.eventType}</span>
                    <strong style={{ color: '#cbd5e1' }}>{item.count} Queries</strong>
                  </div>
                  <div style={{ height: '4px', background: 'rgba(148, 163, 184, 0.15)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, (item.count / s.soqlCount) * 100)}%`,
                      background: '#3b82f6',
                      borderRadius: '2px'
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Execution Hotspots */}
        <div className="inspector-section" style={{ marginBottom: '24px' }}>
          <div className="section-title">
            <Bolt size={16} />
            Execution Hotspots
          </div>
          {s.hotspots.length === 0 ? (
            <p className="muted" style={{ fontSize: '11px', margin: '8px 0 0 0' }}>No hotspots calculated.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
              {s.hotspots.slice(0, 5).map((item) => (
                <div key={item.label} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '11px',
                  padding: '6px 8px',
                  background: 'rgba(15, 23, 42, 0.3)',
                  borderRadius: '4px',
                  border: '1px solid rgba(148, 163, 184, 0.08)'
                }}>
                  <code style={{ color: '#94a3b8', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '200px' }} title={item.label}>
                    {item.label}
                  </code>
                  <strong style={{ color: '#e2e8f0', flexShrink: 0 }}>{item.count}x</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const ancestors = getAncestors(selectedNode, nodeById);
  const descendants = collectDescendantNodes(selectedNode, nodeById);
  const visibleChildren = buildRevealPlan(selectedNode.id, nodeById, enabledKinds, query).visibleChildIds
    .map((id) => nodeById.get(id))
    .filter(Boolean) as StoryNode[];
  const localReads = collectLocalDataReads(selectedNode, nodeById);
  const downstreamReads = collectDownstreamDataReads(selectedNode, nodeById);
  const downstreamBranchBreakdown = buildQueryBranchBreakdown(selectedNode, nodeById);
  const hasExactQueryEvidence = localReads.length > 0 || downstreamReads.length > 0;
  const hasReportedQueryUsage = Number(selectedNode.metrics.soqlQueries ?? 0) > 0;
  const debugMessages = collectDebugMessages(selectedNode, nodeById);
  const explanation = explainNode(selectedNode, ancestors, descendants);
  const dmlImpact = selectedNode.kind === 'dml' ? buildDmlImpact(selectedNode, nodeById) : null;
  const flowContext = selectedNode.kind === 'flow' || selectedNode.kind === 'flowElement'
    ? buildFlowContext(selectedNode, ancestors, descendants)
    : null;
  const downstreamFailures = selectedNode.kind === 'exception'
    ? []
    : descendants.filter((node) => node.kind === 'exception').sort(compareStoryOrder);
  const warnings = buildInspectorWarnings(selectedNode, selectedGapMs);

  return (
    <>
      <div className="inspector-header">
        <span className="kind-badge" style={{ color: KIND_STYLE[selectedNode.kind].color, background: KIND_STYLE[selectedNode.kind].bg }}>
          <KindIcon kind={selectedNode.kind} />
          {KIND_STYLE[selectedNode.kind].label}
        </span>
        <h2>{selectedNode.label}</h2>
        <p>{selectedNode.subtitle || `line ${selectedNode.lineStart}`}</p>
      </div>

      <div className="inspector-section local-explain">
        <div className="section-title">
          <Sparkles size={16} />
          Execution summary
        </div>
        <p>{explanation}</p>
      </div>

      {selectedNode.kind === 'async' && <AsyncApexPanel node={selectedNode} ancestors={ancestors} />}

      {selectedNode.kind === 'email' && <EmailSendPanel node={selectedNode} ancestors={ancestors} />}

      {selectedNode.kind === 'callout' && <CalloutPanel node={selectedNode} ancestors={ancestors} />}

      {flowContext && <FlowContextPanel context={flowContext} onSelectNode={onSelectNode} />}

      {dmlImpact && <DmlImpactPanel impact={dmlImpact} selectedNode={selectedNode} onSelectNode={onSelectNode} />}

      <GovernorLimitsPanel node={selectedNode} />

      {warnings.length > 0 && (
        <div className="inspector-section warning-details">
          <div className="section-title">
            <AlertTriangle size={16} />
            Warnings
          </div>
          <div className="warning-list">
            {warnings.map((warning) => (
              <div key={warning} className="warning-row">
                {warning}
              </div>
            ))}
          </div>
        </div>
      )}

      {downstreamFailures.length > 0 && (
        <DownstreamFailurePanel
          parentNode={selectedNode}
          failures={downstreamFailures}
          nodeById={nodeById}
          onSelectNode={onSelectNode}
        />
      )}

      {selectedNode.exception && (
        <ExceptionStoryPanel node={selectedNode} nodeById={nodeById} onSelectNode={onSelectNode} />
      )}

      <div className="stat-grid">
        <InlineStat label="Line" value={selectedNode.lineStart} />
        <InlineStat
          label={selectedNode.kind === 'soql' ? 'SOQL Time' : 'Duration'}
          value={formatMs(selectedNode.kind === 'soql' ? queryDurationMs(selectedNode) : (selectedNode.durationMs ?? 0))}
          title={selectedNode.kind === 'soql' ? 'Measured separately from Apex CPU.' : undefined}
        />
        <InlineStat label="Next visible" value={visibleChildren.length} />
      </div>

      <div className="inspector-section">
        <div className="section-title">
          <Binary size={16} />
          Metrics
        </div>
        <div className="metric-list">
          {(() => {
            const EXCLUDED_METRIC_KEYS = new Set([
              'soqlQueries',
              'soqlQueriesLimit',
              'dmlStatements',
              'dmlStatementsLimit',
              'cpuMs',
              'cpuMsLimit',
              'heapBytes',
              'heapBytesLimit',
              'totalDurationMs',
              'profileDurationMs',
              'profileExecutionCount',
              'asyncType',
              'asyncRole',
              'asyncTransactionScope',
              'requestVerb',
              'calloutType',
              'endpoint',
              'endpointHost',
              'method',
              'status',
              'statusCode',
              'namedCredential',
              'maxAsync',
              'maxAsyncLimit',
              'systemMethod',
              'transactionEntry',
              'sourceName'
            ]);
            const generalMetrics = Object.entries(selectedNode.metrics).filter(
              ([key]) => !EXCLUDED_METRIC_KEYS.has(key) && !key.startsWith('entry_') && !key.endsWith('Snapshot')
            );
            if (generalMetrics.length === 0) {
              return <span className="muted">No custom metrics on this node.</span>;
            }
            return generalMetrics.map(([key, value]) => (
              <div key={key} className="metric-row">
                <span>{humanize(key)}</span>
                <strong>{String(value)}</strong>
              </div>
            ));
          })()}
        </div>
      </div>

      {localReads.length > 0 && (
        <QueryLensPanel
          title="Local SOQL"
          description="Queries owned by this node or method."
          reads={localReads}
          pinnedSoqlIds={pinnedSoqlIds}
          onSelectNode={onSelectNode}
          onTogglePinnedSoql={onTogglePinnedSoql}
        />
      )}

      {downstreamReads.length > 0 && (
        <QueryBranchBreakdownPanel branches={downstreamBranchBreakdown} onSelectNode={onSelectNode} />
      )}

      {downstreamReads.length > 0 && (
        <QueryLensPanel
          title="Downstream SOQL Hotspots"
          description="Queries below this node, grouped by their attributed owner."
          reads={downstreamReads}
          pinnedSoqlIds={pinnedSoqlIds}
          onSelectNode={onSelectNode}
          onTogglePinnedSoql={onTogglePinnedSoql}
        />
      )}

      {!hasExactQueryEvidence && hasReportedQueryUsage && (
        <MissingQueryEvidencePanel node={selectedNode} />
      )}

      {debugMessages.length > 0 && (
        <div className="inspector-section">
          <div className="section-title">
            <MessageSquareText size={16} />
            User debug
          </div>
          <div className="debug-list">
            {debugMessages.slice(0, 12).map((message) => (
              <div key={`${message.line}-${message.message}`} className="debug-row">
                <div className="debug-meta">
                  <span>line {message.line}</span>
                  <strong>{message.level}</strong>
                </div>
                <code>{message.message}</code>
              </div>
            ))}
            {debugMessages.length > 12 && (
              <div className="debug-more">+{formatNumber(debugMessages.length - 12)} more debug messages in this selection</div>
            )}
          </div>
        </div>
      )}

      {selectedNode.callerChain && selectedNode.callerChain.length > 0 && (
        <div className="inspector-section">
          <div className="section-title">
            <Code2 size={16} />
            Caller chain
          </div>
          <ol className="chain-list">
            {selectedNode.callerChain.map((caller) => (
              <li key={caller}>{caller}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="inspector-section">
        <div className="section-title">
          <GitBranch size={16} />
          Upstream
        </div>
        <div className="link-list">
          {ancestors.length === 0 ? (
            <span className="muted">This is the root of the visible transaction.</span>
          ) : (
            ancestors
              .slice()
              .reverse()
              .map((node) => <NodeLine key={node.id} node={node} onClick={() => onSelectNode(node.id)} />)
          )}
        </div>
      </div>

      <div className="inspector-section">
        <div className="section-title">
          <Workflow size={16} />
          Downstream
        </div>
        <div className="link-list">
          {visibleChildren.length === 0 ? (
            <span className="muted">No downstream nodes were found below this event.</span>
          ) : (
            visibleChildren.slice(0, 12).map((node, index) => (
              <NodeLine
                key={node.id}
                node={node}
                order={index + 1}
                total={visibleChildren.length}
                onClick={() => onSelectNode(node.id)}
              />
            ))
          )}
        </div>
      </div>

    </>
  );
}

function DownstreamFailurePanel({
  parentNode,
  failures,
  nodeById,
  onSelectNode
}: {
  parentNode: StoryNode;
  failures: StoryNode[];
  nodeById: Map<string, StoryNode>;
  onSelectNode: (id: string) => void;
}) {
  const primaryFailure = selectPrimaryFailure(failures);
  const throwOwner = findFailureOwner(primaryFailure, parentNode.id, nodeById);
  const path = buildPathBetween(parentNode, primaryFailure, nodeById);
  const extraCount = failures.length - 1;

  return (
    <div className="inspector-section downstream-failure-details">
      <div className="section-title">
        <AlertTriangle size={16} />
        Downstream failure
      </div>
      <p className="section-description">
        This node is upstream of the error. The exception was thrown inside a child branch, so inspect the throw site before changing this parent.
      </p>

      <div className="downstream-failure-card">
        <div>
          <span>Primary downstream exception</span>
          <strong>{primaryFailure.exception?.exceptionType ?? primaryFailure.label}</strong>
          {primaryFailure.exception?.message && <p>{primaryFailure.exception.message}</p>}
        </div>
        <button type="button" className="mini-action alert" onClick={() => onSelectNode(primaryFailure.id)}>
          Inspect error
        </button>
      </div>

      <div className="metric-list">
        {throwOwner && (
          <button type="button" className="metric-row metric-row-button" onClick={() => onSelectNode(throwOwner.id)}>
            <span>Thrown inside</span>
            <strong>{throwOwner.label}</strong>
          </button>
        )}
        <div className="metric-row">
          <span>Parent context</span>
          <strong>{parentNode.label}</strong>
        </div>
        {extraCount > 0 && (
          <div className="metric-row">
            <span>Other downstream exception events</span>
            <strong>{formatNumber(extraCount)}</strong>
          </div>
        )}
      </div>

      {path.length > 1 && (
        <div className="impact-block">
          <span className="impact-block-title">Path highlighted on graph</span>
          <div className="failure-path-list">
            {path.map((node, index) => (
              <button
                key={node.id}
                type="button"
                className={`failure-path-step ${node.kind === 'exception' ? 'is-source' : ''}`}
                onClick={() => onSelectNode(node.id)}
                title={`Inspect ${node.label}`}
              >
                <span>{index + 1}</span>
                <KindIcon kind={node.kind} />
                <strong>{node.label}</strong>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ExceptionStoryPanel({
  node,
  nodeById,
  onSelectNode
}: {
  node: StoryNode;
  nodeById: Map<string, StoryNode>;
  onSelectNode: (id: string) => void;
}) {
  const context = buildExceptionContext(node, nodeById);

  return (
    <div className="inspector-section exception-details">
      <div className="section-title">
        <AlertTriangle size={16} />
        Exception story
      </div>
      <div className="exception-callout">
        <span>{node.exception?.exceptionType}</span>
        <p>{node.exception?.message}</p>
      </div>

      <div className="metric-list">
        {node.metrics.errorCategory && (
          <div className="metric-row">
            <span>Category</span>
            <strong>{String(node.metrics.errorCategory)}</strong>
          </div>
        )}
        {node.metrics.salesforceErrorCode && (
          <div className="metric-row">
            <span>Salesforce error code</span>
            <strong>{String(node.metrics.salesforceErrorCode)}</strong>
          </div>
        )}
        {context.failingQuery && (
          <button type="button" className="metric-row metric-row-button" onClick={() => onSelectNode(context.failingQuery!.id)}>
            <span>Failing query</span>
            <strong>{String(context.failingQuery.metrics.objectName ?? context.failingQuery.label)}</strong>
          </button>
        )}
        {node.exception?.apexLine !== undefined && (
          <div className="metric-row">
            <span>Apex line</span>
            <strong>{node.exception.apexLine}</strong>
          </div>
        )}
        <div className="metric-row">
          <span>Evidence</span>
          <strong>{context.confidence}</strong>
        </div>
      </div>

      {context.travelPath.length > 0 && (
        <div className="impact-block">
          <span className="impact-block-title">Travel path to failure</span>
          <ol className="compact-chain travel-chain">
            {context.travelPath.map((frame) => (
              <li key={frame}>{frame}</li>
            ))}
          </ol>
        </div>
      )}

      {context.hotspots.length > 0 && (
        <div className="impact-block">
          <span className="impact-block-title">Contributing SOQL hotspots</span>
          <div className="query-hotspot-list">
            {context.hotspots.slice(0, 5).map((read) => (
              <button key={read.id} type="button" className="query-hotspot-row" onClick={() => onSelectNode(read.id)}>
                <span>
                  <strong>{callerSummary(read) ?? String(read.metrics.ownerSignature ?? read.label)}</strong>
                  <small>{String(read.metrics.objectName ?? 'Records')} · line {read.metrics.sourceLine ?? read.lineStart}</small>
                </span>
                <em>{formatNumber(queryExecutionCount(read))}x</em>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QueryBranchBreakdownPanel({
  branches,
  onSelectNode
}: {
  branches: QueryBranchBreakdown[];
  onSelectNode: (id: string) => void;
}) {
  if (branches.length < 2) {
    return null;
  }

  const totalExecutions = branches.reduce((total, branch) => total + branch.summary.executionCount, 0);

  return (
    <div className="inspector-section query-branch-breakdown">
      <div className="section-title">
        <GitBranch size={16} />
        SOQL by child branch
      </div>
      <p className="section-description">
        This shows where the downstream SOQL count splits across the immediate children of the selected node.
      </p>

      <div className="query-branch-list">
        {branches.map((branch) => {
          const percent = totalExecutions > 0 ? Math.round((branch.summary.executionCount / totalExecutions) * 100) : 0;
          return (
            <button
              key={branch.node.id}
              type="button"
              className="query-branch-row"
              onClick={() => onSelectNode(branch.node.id)}
              title={`Inspect ${branch.node.label}`}
            >
              <span className="query-branch-main">
                <KindIcon kind={branch.node.kind} />
                <span>
                  <strong>{branch.node.label}</strong>
                  <small>{branch.node.subtitle || KIND_STYLE[branch.node.kind].label}</small>
                </span>
              </span>
              <span className="query-branch-counts">
                <strong>{formatNumber(branch.summary.executionCount)} SOQL</strong>
                <small>
                  {formatNumber(branch.summary.rowCount)} rows · {percent}%
                  {branch.summary.totalMs > 0 ? ` · ${formatMs(branch.summary.totalMs)} SOQL time` : ''}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AsyncApexPanel({ node, ancestors }: { node: StoryNode; ancestors: StoryNode[] }) {
  const role = String(node.metrics.asyncRole ?? 'request');
  const asyncType = String(node.metrics.asyncType ?? 'Async Apex');
  const systemMethod = metricText(node.metrics.systemMethod) ?? node.detail;
  const caller = callerSummary(node) ?? ancestors.find((ancestor) => ancestor.kind === 'method')?.label;
  const isTransaction = role === 'transaction';

  return (
    <div className="inspector-section async-apex-panel">
      <div className="section-title">
        <Send size={16} />
        {isTransaction ? 'Async Apex Transaction' : 'Async Apex Request'}
      </div>
      <p className="section-description">
        {isTransaction
          ? `This log shows the ${asyncType} transaction after Salesforce started the async work. The original queue or schedule request belongs to an earlier Apex transaction.`
          : `${node.label} was ${String(node.metrics.requestVerb ?? 'requested')} in this transaction. Salesforce runs the resulting ${asyncType} work in a separate Apex transaction, so that execution appears only when the async debug log is uploaded.`}
      </p>
      <div className="query-summary-grid">
        <InlineStat label="Type" value={asyncType} />
        <InlineStat label="Execution" value={isTransaction ? 'Current log' : 'Separate Apex transaction'} />
        <InlineStat label="Line" value={node.lineStart} />
      </div>
      <div className="metric-list async-evidence-list">
        {caller && (
          <div className="metric-row">
            <span>Caller</span>
            <strong>{caller}</strong>
          </div>
        )}
        {systemMethod && (
          <div className="metric-row">
            <span>Evidence</span>
            <strong>{systemMethod}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

function EmailSendPanel({ node, ancestors }: { node: StoryNode; ancestors: StoryNode[] }) {
  const emailType = String(node.metrics.emailType ?? 'Email');
  const systemMethod = metricText(node.metrics.systemMethod) ?? node.detail;
  const caller = callerSummary(node) ?? ancestors.find((ancestor) => ancestor.kind === 'method')?.label;
  const evidence = systemMethod ?? metricText(node.metrics.reference) ?? metricText(node.metrics.apiName);

  return (
    <div className="inspector-section email-send-panel">
      <div className="section-title">
        <Mail size={16} />
        Email Send
      </div>
      <p className="section-description">
        {emailSendDescription(node, emailType)}
      </p>
      <div className="query-summary-grid">
        <InlineStat label="Source" value={emailType} />
        <InlineStat label="Status" value={String(node.metrics.emailStatus ?? 'sent')} />
        <InlineStat label="Line" value={node.lineStart} />
      </div>
      <div className="metric-list async-evidence-list">
        {caller && (
          <div className="metric-row">
            <span>Caller</span>
            <strong>{caller}</strong>
          </div>
        )}
        {evidence && (
          <div className="metric-row">
            <span>Evidence</span>
            <strong>{evidence}</strong>
          </div>
        )}
        {node.metrics.recipients && (
          <div className="metric-row">
            <span>Recipients</span>
            <strong>{String(node.metrics.recipients)}</strong>
          </div>
        )}
        {node.metrics.recipientsQueued !== undefined && (
          <div className="metric-row">
            <span>Recipients queued</span>
            <strong>{formatNumber(Number(node.metrics.recipientsQueued))}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

function CalloutPanel({ node, ancestors }: { node: StoryNode; ancestors: StoryNode[] }) {
  const endpoint = metricText(node.metrics.endpoint) ?? metricText(node.metrics.endpointHost) ?? 'External endpoint';
  const method = metricText(node.metrics.method) ?? 'HTTP';
  const status = metricText(node.metrics.statusCode) ?? metricText(node.metrics.status) ?? 'request captured';
  const caller = callerSummary(node) ?? ancestors.find((ancestor) => ancestor.kind === 'method')?.label;
  const namedCredential = metricText(node.metrics.namedCredential);

  return (
    <div className="inspector-section callout-panel">
      <div className="section-title">
        <Globe2 size={16} />
        Callout
      </div>
      <p className="section-description">
        This node represents an HTTP or Named Credential callout that Salesforce emitted in the debug log. Use it to verify the Apex or Flow branch that made the external request.
      </p>
      <div className="query-summary-grid">
        <InlineStat label="Method" value={method} />
        <InlineStat label="Status" value={status} />
        <InlineStat label="Duration" value={formatMs(node.durationMs ?? 0)} />
      </div>
      <div className="metric-list async-evidence-list">
        <div className="metric-row">
          <span>Endpoint</span>
          <strong>{endpoint}</strong>
        </div>
        {namedCredential && (
          <div className="metric-row">
            <span>Named Credential</span>
            <strong>{namedCredential}</strong>
          </div>
        )}
        {caller && (
          <div className="metric-row">
            <span>Caller</span>
            <strong>{caller}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

function emailSendDescription(node: StoryNode, emailType: string): string {
  if (emailType === 'Apex Messaging') {
    return `${node.label} was invoked through the Salesforce Messaging email API. The Email tab groups these sends by API so you can jump back to the Apex caller that requested the email.`;
  }
  if (emailType === 'Workflow Email Alert') {
    return `${node.label} was emitted by Salesforce workflow email processing. The log line includes the email alert reference and recipients when Salesforce provides them.`;
  }
  if (emailType === 'Flow Email Action') {
    return `${node.label} came from a Flow action call that Salesforce reported as a Send Email action or paired with WF_EMAIL_SENT. Salesforce sends flow email after the flow transaction finishes.`;
  }
  return `${node.label} records an email send event found in the Salesforce debug log.`;
}

function QueryLensPanel({
  title,
  description,
  reads,
  pinnedSoqlIds,
  onSelectNode,
  onTogglePinnedSoql
}: {
  title?: string;
  description?: string;
  reads: StoryNode[];
  pinnedSoqlIds: Set<string>;
  onSelectNode: (id: string) => void;
  onTogglePinnedSoql: (id: string) => void;
}) {
  const summary = summarizeQueryReads(reads);
  const groups = buildQueryGroups(reads);

  return (
    <div className="inspector-section query-lens">
      <div className="section-title">
        <Search size={16} />
        {title ?? 'SOQL Lens'}
      </div>
      {description && <p className="section-description">{description}</p>}

      <div className="query-summary-grid">
        <InlineStat label="Executions" value={formatNumber(summary.executionCount)} />
        <InlineStat label="Shapes" value={formatNumber(summary.uniqueQueryCount)} />
        <InlineStat label="Rows" value={formatNumber(summary.rowCount)} />
        {summary.totalMs > 0 && (
          <InlineStat
            label="SOQL Time"
            value={formatMs(summary.totalMs)}
            title="Measured from SOQL_EXECUTE_BEGIN to SOQL_EXECUTE_END, with cumulative profiling used when available. This is separate from Apex CPU."
          />
        )}
      </div>

      {summary.repeatCount > 0 && (
        <div className="query-lens-callout">
          {formatNumber(summary.executionCount)} total execution{summary.executionCount === 1 ? '' : 's'} are shown here; {formatNumber(summary.repeatCount)} happened after the first matching query execution.
        </div>
      )}

      <div className="query-group-list">
        {groups.slice(0, 6).map((group, groupIndex) => (
          <details key={group.objectName} className="query-group-card" open={groupIndex < 2}>
            <summary>
              <span>
                <strong>{group.objectName}</strong>
                <small>
                  {formatNumber(group.summary.executionCount)} executions · {formatNumber(group.summary.rowCount)} rows
                  {group.summary.totalMs > 0 ? ` · ${formatMs(group.summary.totalMs)} SOQL time` : ''}
                </small>
              </span>
              {group.summary.repeatCount > 0 && <em>{formatNumber(group.summary.repeatCount)} repeated</em>}
            </summary>

            <div className="query-card-list">
              {group.reads.slice(0, 4).map((read) => {
                const isPinned = pinnedSoqlIds.has(read.id);
                const executionCount = queryExecutionCount(read);
                return (
                  <div key={read.id} className={`query-card ${isPinned ? 'pinned' : ''}`}>
                    <div className="query-card-header">
                      <div>
                        <strong>Line {read.lineStart}</strong>
                        <span>
                          {formatNumber(queryRows(read))} rows · {formatNumber(Number(read.metrics.fieldCount ?? 0))} fields
                          {executionCount > 1 ? ` · ${formatNumber(executionCount)}x` : ''}
                          {queryDurationMs(read) > 0 ? ` · ${formatMs(queryDurationMs(read))} SOQL time` : ''}
                        </span>
                      </div>
                      <div className="query-card-actions">
                        <button type="button" className="mini-action" onClick={() => onSelectNode(read.id)}>
                          Inspect
                        </button>
                        <button
                          type="button"
                          className={`mini-action ${isPinned ? 'active' : ''}`}
                          onClick={() => onTogglePinnedSoql(read.id)}
                        >
                          {isPinned ? 'Pinned' : 'Pin'}
                        </button>
                      </div>
                    </div>
                    {callerSummary(read) && <p>Owner: {callerSummary(read)}</p>}
                    {read.metrics.attributionConfidence && (
                      <p>
                        Attribution: {String(read.metrics.attribution ?? 'log evidence')} · {String(read.metrics.attributionConfidence)} confidence
                      </p>
                    )}
                    {read.detail && <code>{read.detail}</code>}
                  </div>
                );
              })}
              {group.reads.length > 4 && (
                <div className="debug-more">+{formatNumber(group.reads.length - 4)} more query shape{group.reads.length - 4 === 1 ? '' : 's'} on {group.objectName}</div>
              )}
            </div>
          </details>
        ))}
        {groups.length > 6 && <div className="debug-more">+{formatNumber(groups.length - 6)} more queried object{groups.length - 6 === 1 ? '' : 's'}</div>}
      </div>
    </div>
  );
}

function MissingQueryEvidencePanel({ node }: { node: StoryNode }) {
  const used = Number(node.metrics.soqlQueries ?? 0);
  const start = Number(node.metrics.entry_soqlQueries ?? Number.NaN);
  const finish = Number(node.metrics.soqlQueriesSnapshot ?? Number.NaN);
  const isFlow = node.metrics.limitScope === 'Flow delta';
  const hasRange = Number.isFinite(start) && Number.isFinite(finish);

  return (
    <div className="inspector-section query-lens query-evidence-missing">
      <div className="section-title">
        <Search size={16} />
        SOQL Evidence
      </div>
      <p className="section-description">
        {isFlow
          ? `Salesforce reported ${formatNumber(used)} SOQL governor ${used === 1 ? 'unit' : 'units'} consumed by this Flow, but this debug log did not emit the individual query text as SOQL_EXECUTE_BEGIN lines.`
          : `Salesforce reported ${formatNumber(used)} SOQL governor ${used === 1 ? 'unit' : 'units'} for this node, but no exact query event was attributed to it in the parsed log.`}
      </p>
      {hasRange && (
        <div className="metric-list">
          <div className="metric-row">
            <span>Start snapshot</span>
            <strong>{formatNumber(start)} SOQL</strong>
          </div>
          <div className="metric-row">
            <span>Finish snapshot</span>
            <strong>{formatNumber(finish)} SOQL</strong>
          </div>
          <div className="metric-row">
            <span>Delta shown on graph</span>
            <strong>{formatNumber(used)} SOQL</strong>
          </div>
        </div>
      )}
    </div>
  );
}

function FlowContextPanel({ context, onSelectNode }: { context: FlowContext; onSelectNode: (id: string) => void }) {
  const hasOwningFlowLink = Boolean(context.flowNode && context.flowNode.id !== context.flowInterviews[0]?.id);
  const isRuntimeOnly = Boolean(context.runtimeObject) && !context.flowApiName;

  return (
    <div className="inspector-section flow-context">
      <div className="section-title">
        <Workflow size={16} />
        Flow context
      </div>

      <div className="flow-context-card">
        <span>{isRuntimeOnly ? 'Runtime scope' : 'Flow API name'}</span>
        <strong>{isRuntimeOnly ? `${context.runtimeObject} record-triggered Flow runtime` : context.flowApiName ?? 'Not emitted in this log segment'}</strong>
        {context.runtimeObject && (
          <small>
            {isRuntimeOnly
              ? 'Salesforce emitted a Flow runtime code unit. It is not a specific Flow interview.'
              : `Record-triggered runtime object: ${context.runtimeObject}`}
          </small>
        )}
      </div>

      <div className="metric-list">
        {context.elementApiName && (
          <div className="metric-row">
            <span>Element API name</span>
            <strong>{context.elementApiName}</strong>
          </div>
        )}
        {context.elementType && (
          <div className="metric-row">
            <span>Element type</span>
            <strong>{context.elementType}</strong>
          </div>
        )}
        {context.interviewId && (
          <div className="metric-row">
            <span>Interview id</span>
            <strong>{context.interviewId}</strong>
          </div>
        )}
        {context.interviewCount && context.interviewCount > 1 && (
          <div className="metric-row">
            <span>Interview count</span>
            <strong>{formatNumber(context.interviewCount)}</strong>
          </div>
        )}
        {context.flowDefinitionId && (
          <div className="metric-row">
            <span>Flow definition id</span>
            <strong>{context.flowDefinitionId}</strong>
          </div>
        )}
        {context.flowVersionId && (
          <div className="metric-row">
            <span>Flow version id</span>
            <strong>{context.flowVersionId}</strong>
          </div>
        )}
      </div>

      {hasOwningFlowLink && context.flowNode && (
        <div className="impact-block">
          <span className="impact-block-title">Owning flow interview</span>
          <button type="button" className="node-line-item clickable" onClick={() => context.flowNode && onSelectNode(context.flowNode.id)}>
            <KindIcon kind={context.flowNode.kind} />
            <span>
              <strong>{String(context.flowNode.metrics.flowApiName ?? context.flowNode.label)}</strong>
              <small>
                {flowInterviewCount(context.flowNode) > 1 ? `${formatNumber(flowInterviewCount(context.flowNode))} interviews · ` : ''}
                line {context.flowNode.lineStart}
              </small>
            </span>
          </button>
        </div>
      )}

      {context.flowInterviews.length > 0 && (
        <div className="impact-block">
          <span className="impact-block-title">Flow interviews below this runtime</span>
          <div className="impact-list compact">
            {context.flowInterviews.slice(0, 8).map((flow) => (
              <button key={flow.id} type="button" className="node-line-item clickable" onClick={() => onSelectNode(flow.id)}>
                <KindIcon kind={flow.kind} />
                <span>
                  <strong>{String(flow.metrics.flowApiName ?? flow.label)}</strong>
                  <small>
                    {flowInterviewCount(flow) > 1 ? `${formatNumber(flowInterviewCount(flow))} interviews · ` : ''}
                    line {flow.lineStart}
                  </small>
                </span>
              </button>
            ))}
            {context.flowInterviews.length > 8 && (
              <div className="debug-more">+{formatNumber(context.flowInterviews.length - 8)} more flow interviews</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function nextCueText(node: StoryNode, childCount: number, selected: boolean, expanded: boolean): { label: string; title: string } {
  if (node.kind === 'flow') {
    const item = `Flow element${childCount === 1 ? '' : 's'}`;
    if (selected && expanded) {
      return {
        label: 'click: collapse',
        title: `Click this Flow interview again to hide its visible Flow elements`
      };
    }
    return {
      label: `click: ${formatNumber(childCount)} ${item}`,
      title: `Click this Flow interview to reveal its Flow elements`
    };
  }

  const item = `downstream event${childCount === 1 ? '' : 's'}`;
  if (selected && expanded) {
    return {
      label: 'click: collapse',
      title: `Click this node again to hide its visible downstream events`
    };
  }
  return {
    label: `click: ${formatNumber(childCount)} downstream`,
    title: `Click this node to reveal its ${item}`
  };
}

function shouldAutoSelectFirstChild(node: StoryNode): boolean {
  return node.kind !== 'flow' && node.kind !== 'flowElement';
}

function DmlImpactPanel({ impact, selectedNode, onSelectNode }: { impact: DmlImpact; selectedNode: StoryNode; onSelectNode: (id: string) => void }) {
  const { classification, directAutomation, automationGroups, failureNodes, previousMeaningful, nextMeaningful, counts } = impact;
  const hasAutomation = automationGroups.length > 0;
  const objectName = String(selectedNode.metrics.objectName ?? 'SObject');
  const operation = String(selectedNode.metrics.operation ?? 'DML');

  return (
    <div className={`inspector-section dml-impact impact-${classification.tone}`}>
      <div className="section-title">
          <Database size={16} />
        DML impact
      </div>

      <div className="impact-hero">
        <div>
          <span className="impact-label">{classification.label}</span>
          <h3>
            {operation} {objectName}
          </h3>
          <p>{impact.summary}</p>
        </div>
        <div className="impact-badges">
          {classification.badges.map((badge) => (
            <span key={badge}>{badge}</span>
          ))}
        </div>
      </div>

      <div className="impact-stat-grid">
        <ImpactStat label="Triggers" value={counts.trigger ?? 0} />
        <ImpactStat label="Flow" value={(counts.flow ?? 0) + (counts.flowElement ?? 0)} />
        <ImpactStat label="DML" value={counts.dml ?? 0} />
        <ImpactStat label="Errors" value={counts.exception ?? 0} alert={failureNodes.length > 0} />
      </div>

      <div className="impact-block">
        <span className="impact-block-title">Automation grouped by DML</span>
        {hasAutomation ? (
          <div className="dml-group-list">
            {automationGroups.slice(0, 10).map((group) => (
              <DmlImpactGroupCard key={group.id} group={group} onSelectNode={onSelectNode} />
            ))}
            {automationGroups.length > 10 && (
              <div className="debug-more">+{formatNumber(automationGroups.length - 10)} more DML groups downstream</div>
            )}
          </div>
        ) : (
          <p className="impact-empty">
            {classification.isPlatformEvent || classification.isTelemetry
              ? 'No downstream automation was observed below this publish. Treat it as terminal evidence unless another subscriber appears elsewhere in the log.'
              : 'No trigger, flow, validation, workflow, or nested DML was observed below this DML.'}
          </p>
        )}
      </div>

      <div className="journey-strip">
        <JourneyStop title="Before this DML" node={previousMeaningful} fallback="No earlier record event nearby." onClick={onSelectNode} />
        <JourneyStop
          title={failureNodes.length > 0 ? 'Failure path' : 'After this DML'}
          node={failureNodes[0] ?? directAutomation[0] ?? nextMeaningful}
          fallback="No downstream automation observed."
          onClick={onSelectNode}
        />
      </div>

      {selectedNode.callerChain && selectedNode.callerChain.length > 0 && (
        <div className="impact-block">
          <span className="impact-block-title">Called from</span>
          <ol className="compact-chain">
            {selectedNode.callerChain.slice(-4).map((caller) => (
              <li key={caller}>{caller}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function DmlImpactGroupCard({ group, onSelectNode }: { group: DmlImpactGroup; onSelectNode: (id: string) => void }) {
  const visibleAutomation = group.automation
    .filter((node) => node.kind !== 'soql')
    .sort((a, b) => automationDisplayPriority(a) - automationDisplayPriority(b) || a.lineStart - b.lineStart)
    .slice(0, 6);
  const flowCount = (group.counts.flow ?? 0) + (group.counts.flowElement ?? 0);
  const dmlCaller = group.dmlNode?.callerChain?.at(-1);

  return (
    <div className={`dml-group-card ${group.failureNodes.length > 0 ? 'has-error' : ''}`}>
      <button
        type="button"
        className="dml-group-header"
        onClick={() => group.dmlNode && onSelectNode(group.dmlNode.id)}
        disabled={!group.dmlNode}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          width: '100%',
          cursor: group.dmlNode ? 'pointer' : 'default',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '10px'
        }}
      >
        <div>
          <span>{group.subtitle}</span>
          <strong style={{ display: 'block', textDecoration: group.dmlNode ? 'underline' : 'none' }}>
            {group.title}
          </strong>
          {dmlCaller && <em>Issued by {dmlCaller}</em>}
        </div>
        <small>line {group.dmlNode?.lineStart ?? group.automation[0]?.lineStart ?? '?'}</small>
      </button>
      <div className="dml-group-stats">
        {(group.counts.method ?? 0) > 0 && <span>{formatNumber(group.counts.method ?? 0)} methods</span>}
        <span>{formatNumber(group.counts.trigger ?? 0)} triggers</span>
        <span>{formatNumber(flowCount)} flows</span>
        <span>{formatNumber(group.counts.dml ?? 0)} DML</span>
        <span>{formatNumber(group.counts.soql ?? 0)} SOQL</span>
        <span>{formatNumber(group.counts.exception ?? 0)} errors</span>
      </div>
      {visibleAutomation.length > 0 ? (
        <div className="impact-list compact">
          {visibleAutomation.map((node) => (
            <NodeLine key={node.id} node={node} onClick={() => onSelectNode(node.id)} />
          ))}
        </div>
      ) : (
        <p className="impact-empty">No immediate automation was observed inside this DML group.</p>
      )}
    </div>
  );
}

function automationDisplayPriority(node: StoryNode): number {
  const priorities: Partial<Record<NodeKind, number>> = {
    exception: 0,
    method: 1,
    trigger: 2,
    validation: 3,
    workflow: 4,
    flow: 5,
    flowElement: 6,
    async: 7,
    dml: 8
  };
  return priorities[node.kind] ?? 9;
}

function ImpactStat({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={`impact-stat ${alert ? 'alert' : ''}`}>
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function JourneyStop({ title, node, fallback, onClick }: { title: string; node?: StoryNode; fallback: string; onClick?: (id: string) => void }) {
  const content = node ? (
    <div>
      <strong>{node.label}</strong>
      <small>
        {KIND_STYLE[node.kind].label} · line {node.lineStart}
      </small>
    </div>
  ) : (
    <p>{fallback}</p>
  );

  if (node && onClick) {
    return (
      <button
        type="button"
        className="journey-stop clickable-stop"
        onClick={() => onClick(node.id)}
        style={{
          background: 'none',
          border: 'none',
          padding: '9px',
          margin: 0,
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          width: '100%',
          cursor: 'pointer'
        }}
      >
        <span style={{ display: 'block', color: '#9fb0c4', fontSize: '10px', fontWeight: 790, textTransform: 'uppercase', marginBottom: '6px' }}>{title}</span>
        {content}
      </button>
    );
  }

  return (
    <div className="journey-stop">
      <span>{title}</span>
      {content}
    </div>
  );
}

function EvidenceDrawer({
  selectedNode,
  evidenceLines,
  collapsed,
  onToggleCollapsed,
  hasHiddenLines,
  showFullEvidence,
  onToggleShowFullEvidence
}: {
  selectedNode: StoryNode | null;
  evidenceLines: Array<{ number: number; content: string; active: boolean; gap?: boolean }>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  hasHiddenLines: boolean;
  showFullEvidence: boolean;
  onToggleShowFullEvidence: () => void;
}) {
  const copyEvidence = useCallback(async () => {
    const text = evidenceLines
      .filter((line) => !line.gap)
      .map((line) => `${line.number}\t${line.content}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
  }, [evidenceLines]);

  return (
    <div className={`evidence-drawer ${collapsed ? 'collapsed' : ''}`} data-tour-id="raw-evidence">
      <div className="evidence-header">
        <div>
          <h3>Raw Log Lines</h3>
          <p>
            {selectedNode
              ? `Lines ${selectedNode.lineStart}-${selectedNode.lineEnd} for ${selectedNode.label}`
              : 'Select a node to inspect raw log lines.'}
          </p>
        </div>
        <div className="evidence-actions">
          {selectedNode && hasHiddenLines && !collapsed && (
            <button
              className={`icon-button ${showFullEvidence ? 'active' : ''}`}
              onClick={onToggleShowFullEvidence}
              title={showFullEvidence ? 'Collapse hidden lines' : 'Show all lines'}
              aria-label={showFullEvidence ? 'Collapse hidden lines' : 'Show all lines'}
              data-tooltip={showFullEvidence ? 'Collapse hidden lines' : 'Show all lines'}
              style={showFullEvidence ? { color: '#38bdf8', background: 'rgba(56,189,248,0.1)' } : undefined}
            >
              <Maximize2 size={14} style={showFullEvidence ? { transform: 'rotate(180deg)', transition: 'transform 0.2s ease' } : { transition: 'transform 0.2s ease' }} />
            </button>
          )}
          <button
            className="icon-button"
            onClick={onToggleCollapsed}
            disabled={!selectedNode}
            title={collapsed ? 'Show raw evidence' : 'Hide raw evidence'}
            aria-label={collapsed ? 'Show raw evidence' : 'Hide raw evidence'}
            data-tooltip={collapsed ? 'Show raw evidence' : 'Hide raw evidence'}
          >
            <ChevronRight size={15} />
          </button>
          <button
            className="icon-button"
            onClick={copyEvidence}
            disabled={evidenceLines.length === 0}
            title="Copy raw evidence"
            aria-label="Copy raw evidence"
            data-tooltip="Copy raw evidence"
          >
            <Copy size={15} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="evidence-code">
          <div className="indicator-top" />
          {evidenceLines.map((line, index) => {
            let logTypeClass = '';
            if (!line.gap) {
              if (
                line.content.includes('|FATAL_ERROR|') ||
                line.content.includes('|EXCEPTION_THROWN|') ||
                line.content.includes('|FLOW_ELEMENT_ERROR|') ||
                line.content.includes('|FLOW_START_INTERVIEWS_ERROR|') ||
                line.content.includes('|WF_FLOW_ACTION_ERROR|') ||
                line.content.includes('|VALIDATION_FAIL|') ||
                line.content.includes('System.LimitException:')
              ) {
                logTypeClass = 'evidence-error';
              } else if (line.content.includes('|WARN|') || line.content.includes('|WARNING|')) {
                logTypeClass = 'evidence-warning';
              } else if (line.content.includes('|USER_DEBUG|')) {
                logTypeClass = 'evidence-debug';
              }
            }
            return (
              <div
                key={`${line.number}-${index}`}
                className={`evidence-line ${line.active ? 'active' : ''} ${line.gap ? 'gap' : ''} ${logTypeClass}`}
              >
                <span>{line.gap ? '' : line.number}</span>
                <code>{line.content}</code>
              </div>
            );
          })}
          <div className="indicator-bottom" />
        </div>
      )}
    </div>
  );
}

async function openLogFile(
  fileInputRef: RefObject<HTMLInputElement | null>,
  handleFile: (file: File | undefined) => void,
  parseText: (text: string, nextFileName: string) => void,
  setParseError: (message: string | null) => void,
  setIsOpeningLog: (isOpening: boolean) => void
) {
  setParseError(null);
  if (!window.apexDebugLogExplorer) {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    fileInputRef.current?.click();
    return;
  }

  setIsOpeningLog(true);
  try {
    const result = await window.apexDebugLogExplorer.openLogFile();
    if (result.canceled) {
      return;
    }
    if (result.error || result.text === undefined || !result.fileName) {
      setParseError(result.error ?? 'Unable to open the selected log file.');
      return;
    }
    parseText(result.text, result.fileName);
  } catch (error) {
    setParseError(error instanceof Error ? `Unable to open log picker: ${error.message}` : 'Unable to open the log picker.');
  } finally {
    setIsOpeningLog(false);
  }
}

function downloadDataUrl(fileName: string, dataUrl: string): void {
  downloadHref(fileName, dataUrl);
}

function downloadHref(fileName: string, href: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function safeFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'apex-debug-log-explorer';
}

function preferredSystemTheme(): ThemeMode {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function initialThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'system' || stored === 'light' || stored === 'dark') {
    return stored;
  }
  return 'system';
}

function hasSeenGuidedTour(): boolean {
  const stored = window.localStorage.getItem(TOUR_STORAGE_KEY);
  return stored === 'completed' || stored === 'skipped';
}

function tourSpotlightStyle(rect: TourRect): CSSProperties {
  const padding = 7;
  return {
    top: `${Math.max(8, rect.top - padding)}px`,
    left: `${Math.max(8, rect.left - padding)}px`,
    width: `${rect.width + padding * 2}px`,
    height: `${rect.height + padding * 2}px`
  };
}

function tourCardStyle(rect: TourRect | null, placement: TourPlacement): CSSProperties {
  const margin = 14;
  const gap = 16;
  const estimatedHeight = 238;
  const viewportWidth = window.innerWidth || 1200;
  const viewportHeight = window.innerHeight || 800;
  const centerLeft = (viewportWidth - TOUR_POPOVER_WIDTH) / 2;
  let left = centerLeft;
  let top = (viewportHeight - estimatedHeight) / 2;

  if (rect) {
    switch (placement) {
      case 'right':
        left = rect.left + rect.width + gap;
        top = rect.top + rect.height / 2 - estimatedHeight / 2;
        if (left + TOUR_POPOVER_WIDTH > viewportWidth - margin) {
          left = rect.left - TOUR_POPOVER_WIDTH - gap;
        }
        break;
      case 'left':
        left = rect.left - TOUR_POPOVER_WIDTH - gap;
        top = rect.top + rect.height / 2 - estimatedHeight / 2;
        if (left < margin) {
          left = rect.left + rect.width + gap;
        }
        break;
      case 'top':
        left = rect.left + rect.width / 2 - TOUR_POPOVER_WIDTH / 2;
        top = rect.top - estimatedHeight - gap;
        if (top < margin) {
          top = rect.top + rect.height + gap;
        }
        break;
      case 'bottom':
        left = rect.left + rect.width / 2 - TOUR_POPOVER_WIDTH / 2;
        top = rect.top + rect.height + gap;
        if (top + estimatedHeight > viewportHeight - margin) {
          top = rect.top - estimatedHeight - gap;
        }
        break;
      case 'center':
        break;
    }
  }

  return {
    width: `${TOUR_POPOVER_WIDTH}px`,
    left: `${clamp(left, margin, viewportWidth - TOUR_POPOVER_WIDTH - margin)}px`,
    top: `${clamp(top, margin, viewportHeight - estimatedHeight - margin)}px`
  };
}

function defaultPanelSizes(): PanelSizes {
  const left = 312;
  return {
    left,
    right: clamp(366, RIGHT_PANEL_MIN_WIDTH, maxInspectorWidth(false, left)),
    evidence: 132
  };
}

function buildLineOffsets(text: string): Uint32Array {
  const offsets: number[] = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      offsets.push(index + 1);
    }
  }
  return Uint32Array.from(offsets);
}

function readLine(source: RawLogSource, lineNumber: number): string {
  const lineIndex = lineNumber - 1;
  if (lineIndex < 0 || lineIndex >= source.lineOffsets.length) {
    return '';
  }
  const start = source.lineOffsets[lineIndex];
  let end = lineIndex + 1 < source.lineOffsets.length ? source.lineOffsets[lineIndex + 1] - 1 : source.text.length;
  if (end > start && source.text.charCodeAt(end - 1) === 13) {
    end -= 1;
  }
  return source.text.slice(start, end);
}

function looksLikeRawEvidenceToken(value: string): boolean {
  return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(value) || /[A-Za-z0-9_]{8,}__c/.test(value);
}

function findRawLogLine(source: RawLogSource, token: string): number | undefined {
  const index = source.text.indexOf(token);
  if (index < 0) {
    return undefined;
  }
  let low = 0;
  let high = source.lineOffsets.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = source.lineOffsets[mid];
    const next = mid + 1 < source.lineOffsets.length ? source.lineOffsets[mid + 1] : source.text.length + 1;
    if (index >= current && index < next) {
      return mid + 1;
    }
    if (index < current) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return undefined;
}

function findSmallestNodeForLine(nodes: StoryNode[], lineNumber: number): StoryNode | undefined {
  return nodes
    .filter((node) => node.kind !== 'root' && !isGraphBridgeNode(node) && node.lineStart <= lineNumber && node.lineEnd >= lineNumber)
    .sort((a, b) => {
      const spanDelta = a.lineEnd - a.lineStart - (b.lineEnd - b.lineStart);
      if (spanDelta !== 0) {
        return spanDelta;
      }
      return nodeLinePriority(a.kind) - nodeLinePriority(b.kind);
    })[0];
}

function nodeLinePriority(kind: NodeKind): number {
  const priority: Partial<Record<NodeKind, number>> = {
    exception: 0,
    dml: 1,
    soql: 2,
    async: 3,
    method: 4,
    trigger: 5,
    flowElement: 6,
    flow: 7,
    flowRuntime: 8,
    apex: 9
  };
  return priority[kind] ?? 9;
}

function buildEvidenceWindow(
  rawLog: RawLogSource,
  selectedNode: StoryNode
): Array<{ number: number; content: string; active: boolean; gap?: boolean }> {
  const before = 4;
  const after = 8;
  const maxContiguousLines = 90;
  const lineCount = rawLog.lineOffsets.length;
  const first = Math.max(0, selectedNode.lineStart - before - 1);
  const last = Math.min(lineCount, selectedNode.lineEnd + after);
  const span = last - first;

  if (span <= maxContiguousLines) {
    return rangeLines(first + 1, last, rawLog, selectedNode);
  }

  const headEnd = Math.min(lineCount, selectedNode.lineStart + 22);
  const tailStart = Math.max(headEnd, selectedNode.lineEnd - 12);
  const head = rangeLines(first + 1, headEnd, rawLog, selectedNode);
  const tail = rangeLines(tailStart + 1, last, rawLog, selectedNode);

  return [
    ...head,
    {
      number: 0,
      content: `... ${Math.max(0, tailStart - headEnd).toLocaleString()} downstream log lines hidden. Use the graph to inspect the nested events.`,
      active: false,
      gap: true
    },
    ...tail
  ];
}

function rangeLines(
  startLine: number,
  endLine: number,
  rawLog: RawLogSource,
  selectedNode: StoryNode
): Array<{ number: number; content: string; active: boolean }> {
  const lines: Array<{ number: number; content: string; active: boolean }> = [];
  for (let number = startLine; number <= endLine; number += 1) {
    lines.push({
  number,
      content: readLine(rawLog, number),
      active: number >= selectedNode.lineStart && number <= selectedNode.lineEnd
    });
  }
  return lines;
}

function buildFlowGraph(
  storyNodes: StoryNode[],
  expandedIds: Set<string>,
  selectedId: string | null,
  activeRevealSourceId: string | null,
  activeDmlFocusId: string | null,
  enabledKinds: Set<GraphVisibilityKey>,
  query: string,
  theme: ThemeMode,
  layoutAnchor: LayoutAnchor | null,
  soqlLensEnabled: boolean,
  pinnedSoqlIds: Set<string>,
  highlightedOperationIds: Set<string>
): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  const byId = new Map(storyNodes.map((node) => [node.id, node]));
  const visibleIds = new Set<string>();
  const normalized = query.trim().toLowerCase();
  const context = selectedId ? buildGraphContext(selectedId, byId) : null;
  const failureContext = selectedId ? buildFailureContext(selectedId, byId) : null;
  const focusedDmlNode = activeDmlFocusId ? byId.get(activeDmlFocusId) : undefined;
  const dmlFocusId = focusedDmlNode?.kind === 'dml' && selectedId === focusedDmlNode.id && !normalized ? focusedDmlNode.id : null;

  const addAncestors = (nodeId: string | undefined) => {
    let cursor = nodeId ? byId.get(nodeId) : undefined;
    while (cursor) {
      if (cursor.kind !== 'root' && !isGraphBridgeNode(cursor)) {
        visibleIds.add(cursor.id);
      }
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  };

  storyNodes.forEach((node) => {
    if (node.kind === 'root') {
      return;
    }
    if (dmlFocusId && node.id !== dmlFocusId && isDescendantOf(node, dmlFocusId, byId)) {
      return;
    }
    const parentExpanded = !node.parentId || expandedIds.has(node.parentId);
    const selected = selectedId === node.id;

    if ((parentExpanded || selected || expandedIds.has(node.id)) && isGraphCandidate(node, enabledKinds, normalized, byId)) {
      visibleIds.add(node.id);
    }
  });

  addAncestors(selectedId ?? undefined);
  addSelectedDmlBundles(dmlFocusId, byId, visibleIds, enabledKinds, normalized);
  addRevealedBranchChildren(activeRevealSourceId, byId, visibleIds, enabledKinds, normalized, failureContext, addAncestors);
  pinnedSoqlIds.forEach((nodeId) => {
    const pinnedNode = byId.get(nodeId);
    if (!pinnedNode || pinnedNode.kind !== 'soql') {
      return;
    }
    visibleIds.add(pinnedNode.id);
    addAncestors(pinnedNode.id);
  });
  highlightedOperationIds.forEach((nodeId) => {
    const highlightedNode = byId.get(nodeId);
    if (!highlightedNode) {
      return;
    }
    visibleIds.add(highlightedNode.id);
    addAncestors(highlightedNode.id);
  });

  const visibleNodes = storyNodes.filter((node) => visibleIds.has(node.id));
  const gapById = buildTimeGapMap(visibleNodes);
  const querySummaryById = new Map<string, QuerySummary>();
  const downstreamQuerySummaryById = new Map<string, QuerySummary>();
  if (soqlLensEnabled) {
    visibleNodes.forEach((node) => {
      if (node.kind === 'soql') {
        return;
      }
      const localSummary = summarizeQueryReads(collectLocalDataReads(node, byId));
      if (localSummary.executionCount > 0) {
        querySummaryById.set(node.id, localSummary);
      }
      const downstreamSummary = summarizeQueryReads(collectDownstreamDataReads(node, byId));
      if (downstreamSummary.executionCount > 0) {
        downstreamQuerySummaryById.set(node.id, downstreamSummary);
      }
    });
  }
  const edgePairs = visibleNodes
    .map((node) => {
      const source = nearestVisibleParent(node, byId, visibleIds);
      if (!source) {
        return null;
      }
      return { source, target: node };
    })
    .filter(Boolean) as Array<{ source: StoryNode; target: StoryNode }>;
  const executionOrderById = buildExecutionOrderMap(storyNodes);
  const siblingOrderById = buildSiblingOrderMap(edgePairs);
  const visibleFailureEdges = failureContext ? visibleFailureEdgeIds(failureContext.pathIds, visibleIds, byId) : new Set<string>();

  const hasVisibleQueryLens = soqlLensEnabled && (querySummaryById.size > 0 || downstreamQuerySummaryById.size > 0);
  const layoutGraph = new dagre.graphlib.Graph();
  layoutGraph.setGraph({
    rankdir: 'LR',
    nodesep: hasVisibleQueryLens ? 82 : 36,
    ranksep: hasVisibleQueryLens ? 158 : 138,
    edgesep: hasVisibleQueryLens ? 28 : 18,
    marginx: 30,
    marginy: hasVisibleQueryLens ? 56 : 30
  });
  layoutGraph.setDefaultEdgeLabel(() => ({}));

  visibleNodes.forEach((node) => {
    const gapBeforeMs = gapById.get(node.id);
    const querySummary = querySummaryById.get(node.id);
    const downstreamQuerySummary = downstreamQuerySummaryById.get(node.id);
    const failureRole = graphFailureRole(node, selectedId, failureContext);
    layoutGraph.setNode(node.id, {
      width: GRAPH_NODE_WIDTH,
      height: estimateGraphNodeHeight(node, gapBeforeMs, querySummary, downstreamQuerySummary, failureRole)
    });
  });

  edgePairs.forEach(({ source, target }) => {
    layoutGraph.setEdge(source.id, target.id);
  });

  dagre.layout(layoutGraph);

  const isLightTheme = theme === 'light';

  let flowNodes: Node<GraphNodeData>[] = visibleNodes.map((node) => {
    const gapBeforeMs = gapById.get(node.id);
    const querySummary = querySummaryById.get(node.id);
    const downstreamQuerySummary = downstreamQuerySummaryById.get(node.id);
    const warnings = buildGraphWarnings(node, gapBeforeMs);
    const failureRole = graphFailureRole(node, selectedId, failureContext);
    const height = estimateGraphNodeHeight(node, gapBeforeMs, querySummary, downstreamQuerySummary, failureRole);
    const layoutNode = layoutGraph.node(node.id) as { x: number; y: number } | undefined;
    return {
      id: node.id,
      type: 'story',
      position: {
        x: (layoutNode?.x ?? 0) - GRAPH_NODE_WIDTH / 2,
        y: (layoutNode?.y ?? 0) - height / 2
      },
      data: {
        storyNode: node,
        selected: selectedId === node.id,
        expanded: expandedIds.has(node.id),
        childCount: node.kind === 'gap' ? 0 : buildRevealPlan(node.id, byId, enabledKinds, query).visibleChildIds.length,
        executionOrder: executionOrderById.get(node.id),
        siblingOrder: siblingOrderById.get(node.id)?.index,
        siblingTotal: siblingOrderById.get(node.id)?.total,
        querySummary,
        downstreamQuerySummary,
        soqlLensEnabled,
        relation: graphRelation(node.id, context),
        failureRole,
        downstreamFailureCount: node.id === selectedId ? failureContext?.failureCount ?? 0 : 0,
        isDataOperationHighlighted: highlightedOperationIds.has(node.id),
        gapBeforeMs,
        riskLevel: riskLevelFor(node, warnings, gapBeforeMs),
        warnings,
        theme
      }
    };
  });

  const anchor = layoutAnchor;
  const anchorNode = anchor ? flowNodes.find((node) => node.id === anchor.nodeId) : undefined;
  if (anchor && anchorNode) {
    const dx = anchor.position.x - anchorNode.position.x;
    const dy = anchor.position.y - anchorNode.position.y;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      flowNodes = flowNodes.map((node) => ({
        ...node,
        position: {
          x: node.position.x + dx,
          y: node.position.y + dy
        }
      }));
    }
  }

  const edges: Edge[] = edgePairs
    .map(({ source, target }) => {
      const activeColor = isLightTheme ? LIGHT_KIND_STYLE[target.kind].color : KIND_STYLE[target.kind].color;
      const siblingOrder = siblingOrderById.get(target.id);
      const orderLabelSourceId = activeRevealSourceId && byId.has(activeRevealSourceId) ? activeRevealSourceId : selectedId;
      const showOrderLabel = Boolean(siblingOrder && siblingOrder.total > 1 && source.id === orderLabelSourceId);
      const isFailureEdge = visibleFailureEdges.has(`${source.id}->${target.id}`);
      const edgeRelationName = edgeRelation(source.id, target.id, context);
      const edgeColor = isFailureEdge ? (isLightTheme ? '#dc2626' : '#ff6680') : activeColor;
      return {
        id: `${source.id}-${target.id}`,
        source: source.id,
        target: target.id,
        label: showOrderLabel ? String(siblingOrder?.index) : undefined,
        labelShowBg: showOrderLabel,
        labelBgPadding: [5, 3],
        labelBgBorderRadius: 999,
        labelStyle: {
          fill: isLightTheme ? '#172231' : '#f6fbff',
          fontSize: 11,
          fontWeight: 800
        },
        labelBgStyle: {
          fill: isLightTheme ? '#ffffff' : '#101923',
          fillOpacity: 0.95,
          stroke: activeColor,
          strokeWidth: 1
        },
        animated: isFailureEdge || target.kind === 'dml' || target.kind === 'exception',
        className: `story-edge edge-${edgeRelationName} ${isFailureEdge ? 'edge-failure-path' : ''}`,
        style: {
          stroke: edgeColor,
          strokeWidth: isFailureEdge ? 2.8 : selectedId === target.id || selectedId === source.id ? 2.4 : 1.4
        }
      } satisfies Edge;
    })
    .filter(Boolean);

  return { nodes: flowNodes, edges };
}

function buildExecutionOrderMap(nodes: StoryNode[]): Map<string, number> {
  return new Map(
    nodes
      .filter((node) => node.kind !== 'gap')
      .sort(compareStoryOrder)
      .map((node, index) => [node.id, index + 1])
  );
}

function buildSiblingOrderMap(edgePairs: Array<{ source: StoryNode; target: StoryNode }>): Map<string, { index: number; total: number }> {
  const bySource = new Map<string, StoryNode[]>();
  edgePairs.forEach(({ source, target }) => {
    const siblings = bySource.get(source.id) ?? [];
    siblings.push(target);
    bySource.set(source.id, siblings);
  });

  const orderById = new Map<string, { index: number; total: number }>();
  bySource.forEach((siblings) => {
    const ordered = [...siblings].sort(compareStoryOrder);
    ordered.forEach((node, index) => {
      orderById.set(node.id, { index: index + 1, total: ordered.length });
    });
  });
  return orderById;
}

function compareStoryOrder(a: StoryNode, b: StoryNode): number {
  return a.lineStart - b.lineStart || a.startNs - b.startNs || a.lineEnd - b.lineEnd || a.id.localeCompare(b.id);
}

function hasNodeVisualMetrics(node: StoryNode): boolean {
  const soql = Number(node.metrics.soqlQueries || 0);
  const dml = Number(node.metrics.dmlStatements || 0);
  const cpu = Number(node.metrics.cpuMs || 0);
  return soql > 0 || dml > 0 || cpu > 0;
}

function estimateGraphNodeHeight(
  node: StoryNode,
  gapBeforeMs?: number,
  querySummary?: QuerySummary,
  downstreamQuerySummary?: QuerySummary,
  failureRole: FailureRole = 'none'
): number {
  let height = 106;
  if (node.kind === 'dml') {
    height += 25;
  }
  if (node.loopMultiplier && node.loopMultiplier > 1) {
    height += 12;
  }
  if (hasNodeVisualMetrics(node)) {
    height += 20;
  }
  if (querySummary && querySummary.executionCount > 0) {
    height += 46;
  }
  if (downstreamQuerySummary && downstreamQuerySummary.executionCount > 0) {
    height += 28;
  }
  if (failureRole !== 'none') {
    height += 26;
  }
  if (buildGraphWarnings(node, gapBeforeMs).length > 0) {
    height += 26;
  }
  return height;
}

function focusCurrentGraphContext(
  instance: ReactFlowInstance<Node<GraphNodeData>, Edge>,
  nodes: Node<GraphNodeData>[],
  selectedId: string | null,
  highlightedOperationIds: Set<string>,
  preferVisibleGraphBounds: boolean,
  duration: number
): void {
  const highlightedNodes = nodes.filter((node) => highlightedOperationIds.has(node.id));
  if (highlightedNodes.length > 1) {
    void instance.fitView({
      nodes: highlightedNodes,
      padding: 0.34,
      duration,
      minZoom: 0.18,
      maxZoom: 0.72
    });
    return;
  }

  if (preferVisibleGraphBounds && nodes.length > 1) {
    void instance.fitView({
      nodes,
      padding: 0.26,
      duration,
      minZoom: 0.18,
      maxZoom: 0.92
    });
    return;
  }

  const graphNode = selectedId ? nodes.find((node) => node.id === selectedId) : highlightedNodes[0];
  if (!graphNode) {
    void instance.fitView({ padding: 0.24, duration, maxZoom: 0.95 });
    return;
  }

  const height = estimateGraphNodeHeight(
    graphNode.data.storyNode,
    graphNode.data.gapBeforeMs,
    graphNode.data.querySummary,
    graphNode.data.downstreamQuerySummary,
    graphNode.data.failureRole
  );
  void instance.setCenter(
    graphNode.position.x + GRAPH_NODE_WIDTH / 2,
    graphNode.position.y + height / 2,
    { zoom: instance.getZoom(), duration }
  );
}

function buildTimeGapMap(nodes: StoryNode[]): Map<string, number> {
  const gapById = new Map<string, number>();
  const ordered = [...nodes].sort((a, b) => a.lineStart - b.lineStart);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const gap = durationMs(previous.endNs ?? previous.startNs, current.startNs);
    if (gap > 0) {
      gapById.set(current.id, gap);
    }
  }
  return gapById;
}

function buildSyntheticGapNodes(nodes: StoryNode[]): Array<{ node: StoryNode; sourceId: string; targetId: string }> {
  const ordered = [...nodes].sort((a, b) => a.lineStart - b.lineStart);
  const gaps: Array<{ node: StoryNode; sourceId: string; targetId: string }> = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const gap = durationMs(previous.endNs ?? previous.startNs, current.startNs);
    if (gap < 1000) {
      continue;
    }
    gaps.push({
      sourceId: previous.id,
      targetId: current.id,
      node: {
        id: `gap-${previous.id}-${current.id}`,
        kind: 'gap',
        label: 'Execution gap',
        subtitle: 'Managed package, callout, or unlogged work',
        parentId: previous.id,
        childIds: [],
        startNs: previous.endNs ?? previous.startNs,
        endNs: current.startNs,
        durationMs: gap,
        lineStart: previous.lineEnd,
        lineEnd: current.lineStart,
        metrics: { durationMs: gap },
        warnings: [`${formatMs(gap)} with no visible log events`]
      }
    });
  }
  return gaps.slice(0, 24);
}

function timeGapBeforeNode(node: StoryNode, nodes: StoryNode[]): number | undefined {
  const previous = nodes
    .filter((candidate) => candidate.lineStart < node.lineStart)
    .sort((a, b) => a.lineStart - b.lineStart)
    .at(-1);
  if (!previous) {
    return undefined;
  }
  const gap = durationMs(previous.endNs ?? previous.startNs, node.startNs);
  return gap > 0 ? gap : undefined;
}

function buildGraphWarnings(node: StoryNode, gapBeforeMs?: number): string[] {
  void gapBeforeMs;
  return uniqueWarnings(node.warnings ?? []);
}

function buildInspectorWarnings(node: StoryNode, gapBeforeMs?: number): string[] {
  return buildGraphWarnings(node, gapBeforeMs);
}

function riskLevelFor(node: StoryNode, warnings: string[], gapBeforeMs?: number): RiskLevel {
  const soqlShare = metricShare(node, 'soqlQueries');
  const dmlShare = metricShare(node, 'dmlStatements');
  const cpuShare = metricShare(node, 'cpuMs');
  const critical =
    node.kind === 'exception' || node.kind === 'gap' || soqlShare >= 0.25 || dmlShare >= 0.25 || cpuShare >= 0.25 || (gapBeforeMs ?? 0) > 5000;
  if (critical) {
    return 'danger';
  }
  return warnings.length > 0 ? 'watch' : 'none';
}

function metricShare(node: StoryNode, metricKey: string): number {
  const used = Number(node.metrics[metricKey] ?? 0);
  const limit = Number(node.metrics[`${metricKey}Limit`] ?? 0);
  return used > 0 && limit > 0 ? used / limit : 0;
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.filter(Boolean))];
}

function addSelectedDmlBundles(
  selectedId: string | null,
  nodeById: Map<string, StoryNode>,
  visibleIds: Set<string>,
  enabledKinds: Set<GraphVisibilityKey>,
  normalizedQuery: string
): void {
  const selected = selectedId ? nodeById.get(selectedId) : undefined;
  if (!selected || selected.kind !== 'dml') {
    return;
  }

  const descendants = collectDescendantNodes(selected, nodeById);
  const groups = buildDmlImpactGroups(selected, descendants, nodeById);
  const graphGroups = selectDmlGraphGroups(groups);
  visibleIds.add(selected.id);

  graphGroups.forEach((group) => {
    if (group.dmlNode && isGraphCandidate(group.dmlNode, enabledKinds, normalizedQuery, nodeById)) {
      visibleIds.add(group.dmlNode.id);
      addDmlContextAncestors(group.dmlNode, selected.id, nodeById, visibleIds, enabledKinds, normalizedQuery);
    }

    selectDmlGraphAutomation(group.automation).forEach((node) => {
      if (!isGraphCandidate(node, enabledKinds, normalizedQuery, nodeById)) {
        return;
      }
      visibleIds.add(node.id);
      addDmlContextAncestors(node, selected.id, nodeById, visibleIds, enabledKinds, normalizedQuery);
    });
  });
}

function addRevealedBranchChildren(
  sourceId: string | null,
  nodeById: Map<string, StoryNode>,
  visibleIds: Set<string>,
  enabledKinds: Set<GraphVisibilityKey>,
  normalizedQuery: string,
  failureContext: ReturnType<typeof buildFailureContext> | null,
  addAncestors: (nodeId: string | undefined) => void
): void {
  if (!sourceId || !nodeById.has(sourceId)) {
    return;
  }

  if (failureContext) {
    failureContext.pathIds.forEach((pathId) => {
      const node = nodeById.get(pathId);
      if (!node || node.kind === 'root' || isGraphBridgeNode(node)) {
        return;
      }
      if (isGraphCandidate(node, enabledKinds, normalizedQuery, nodeById)) {
        visibleIds.add(node.id);
        addAncestors(node.id);
      }
    });
  }

  const depthLimit = 1;
  const maxAdded = 36;
  const visited = new Set<string>();
  let added = 0;

  const reveal = (parentId: string, depth: number) => {
    if (visited.has(parentId) || depth > depthLimit || added >= maxAdded) {
      return;
    }
    visited.add(parentId);
    const revealPlan = buildRevealPlan(parentId, nodeById, enabledKinds, normalizedQuery);
    revealPlan.visibleChildIds.forEach((childId) => {
      if (added >= maxAdded) {
        return;
      }
      visibleIds.add(childId);
      addAncestors(childId);
      added += 1;
      reveal(childId, depth + 1);
    });
  };

  reveal(sourceId, 1);
}

function addDmlContextAncestors(
  node: StoryNode,
  stopId: string,
  nodeById: Map<string, StoryNode>,
  visibleIds: Set<string>,
  enabledKinds: Set<GraphVisibilityKey>,
  normalizedQuery: string
): void {
  let cursor = node.parentId ? nodeById.get(node.parentId) : undefined;
  while (cursor) {
    if (cursor.id === stopId) {
      return;
    }
    const includeContextNode =
      isGraphCandidate(cursor, enabledKinds, normalizedQuery, nodeById) ||
      (isFlowRecordMutationNode(cursor) && nodeMatchesSearch(cursor, normalizedQuery));
    if (cursor.kind !== 'root' && includeContextNode) {
      visibleIds.add(cursor.id);
      if (isFlowRecordMutationNode(cursor)) {
        addFlowRecordMutationChildren(cursor, nodeById, visibleIds, enabledKinds, normalizedQuery);
      }
    }
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }
}

function addFlowRecordMutationChildren(
  node: StoryNode,
  nodeById: Map<string, StoryNode>,
  visibleIds: Set<string>,
  enabledKinds: Set<GraphVisibilityKey>,
  normalizedQuery: string
): void {
  node.childIds.forEach((childId) => {
    const child = nodeById.get(childId);
    if (!child || !['trigger', 'validation', 'workflow', 'exception'].includes(child.kind)) {
      return;
    }
    if (isGraphCandidate(child, enabledKinds, normalizedQuery, nodeById)) {
      visibleIds.add(child.id);
    }
  });
}

function isFlowRecordMutationNode(node: StoryNode): boolean {
  return node.kind === 'flowElement' && /^flowrecord(?:create|update|delete)$/i.test(String(node.metrics.elementType ?? ''));
}

function selectDmlGraphGroups(groups: DmlImpactGroup[]): DmlImpactGroup[] {
  const selectedGroup = groups.find((group) => !group.dmlNode);
  const nestedGroups = groups.filter((group) => group.dmlNode).slice(0, MAX_DML_GRAPH_GROUPS);
  return selectedGroup ? [...nestedGroups, selectedGroup] : nestedGroups;
}

function selectDmlGraphAutomation(nodes: StoryNode[]): StoryNode[] {
  return [...nodes]
    .sort((a, b) => {
      const priorityDelta = graphAutomationPriority(a) - graphAutomationPriority(b);
      return priorityDelta || a.lineStart - b.lineStart;
    })
    .slice(0, MAX_DML_GRAPH_GROUP_AUTOMATION)
    .sort((a, b) => a.lineStart - b.lineStart);
}

function graphAutomationPriority(node: StoryNode): number {
  const priority: Partial<Record<NodeKind, number>> = {
    exception: 0,
    trigger: 1,
    validation: 2,
    workflow: 3,
    flow: 4,
    flowElement: 5,
    async: 6,
    callout: 7,
    dml: 8,
    soql: 9
  };
  return priority[node.kind] ?? 9;
}

function buildGraphContext(selectedId: string, byId: Map<string, StoryNode>) {
  const upstream = new Set<string>();
  const downstream = new Set<string>();
  let cursor = byId.get(selectedId)?.parentId ? byId.get(byId.get(selectedId)?.parentId ?? '') : undefined;

  while (cursor) {
    upstream.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  const visit = (nodeId: string) => {
    const node = byId.get(nodeId);
    node?.childIds.forEach((childId) => {
      downstream.add(childId);
      visit(childId);
    });
  };
  visit(selectedId);

  return { selectedId, upstream, downstream };
}

function buildFailureContext(selectedId: string, byId: Map<string, StoryNode>) {
  const selected = byId.get(selectedId);
  if (!selected) {
    return null;
  }

  if (selected.kind === 'exception') {
    return {
      failureCount: 1,
      sourceId: selected.id,
      pathIds: [selected.id],
      pathSet: new Set<string>([selected.id])
    };
  }

  const failures = collectDescendantNodes(selected, byId)
    .filter((node) => node.kind === 'exception')
    .sort(compareStoryOrder);
  const source = selectPrimaryFailure(failures);
  if (!source) {
    return null;
  }

  const pathIds: string[] = [];
  let cursor: StoryNode | undefined = source;
  while (cursor) {
    pathIds.push(cursor.id);
    if (cursor.id === selectedId) {
      break;
    }
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  pathIds.reverse();

  return {
    failureCount: failures.length,
    sourceId: source.id,
    pathIds,
    pathSet: new Set<string>(pathIds)
  };
}

function graphFailureRole(
  node: StoryNode,
  selectedId: string | null,
  context: ReturnType<typeof buildFailureContext> | null
): FailureRole {
  if (node.kind === 'exception') {
    return node.id === selectedId || context?.sourceId === node.id ? 'source' : 'none';
  }
  if (!selectedId || !context) {
    return 'none';
  }
  if (node.id === selectedId && context.failureCount > 0) {
    return 'selected-parent';
  }
  if (context.pathSet.has(node.id)) {
    return 'path';
  }
  return 'none';
}

function visibleFailureEdgeIds(
  pathIds: string[],
  visibleIds: Set<string>,
  byId: Map<string, StoryNode>
): Set<string> {
  const edgeIds = new Set<string>();
  const pathSet = new Set(pathIds);
  pathIds.forEach((nodeId) => {
    if (!visibleIds.has(nodeId)) {
      return;
    }
    const node = byId.get(nodeId);
    if (!node) {
      return;
    }
    const source = nearestVisibleParent(node, byId, visibleIds);
    if (source && pathSet.has(source.id)) {
      edgeIds.add(`${source.id}->${node.id}`);
    }
  });
  return edgeIds;
}

function selectPrimaryFailure(failures: StoryNode[]): StoryNode {
  return [...failures].sort((a, b) => {
    const priorityDelta = failurePriority(b) - failurePriority(a);
    return priorityDelta || compareStoryOrder(b, a);
  })[0];
}

function failurePriority(node: StoryNode): number {
  const eventType = String(node.metrics.eventType ?? '');
  const exceptionType = node.exception?.exceptionType ?? String(node.metrics.exceptionType ?? '');
  const message = node.exception?.message ?? node.subtitle ?? '';
  if (eventType === 'FATAL_ERROR') {
    return 4;
  }
  if (/FLOW_ELEMENT_ERROR|FLOW_START_INTERVIEWS_ERROR|WF_FLOW_ACTION_ERROR/i.test(eventType)) {
    return 3;
  }
  if (/LimitException/i.test(exceptionType) || /Too many SOQL queries/i.test(message)) {
    return 3;
  }
  if (/DmlException|QueryException/i.test(exceptionType)) {
    return 2;
  }
  if (eventType === 'VALIDATION_FAIL') {
    return 2;
  }
  return 1;
}

function findFailurePresetTarget(
  selectedNode: StoryNode | null,
  nodes: StoryNode[],
  nodeById: Map<string, StoryNode>
): StoryNode | undefined {
  if (selectedNode) {
    if (selectedNode.kind === 'exception') {
      return selectedNode;
    }
    const selectedFailures = collectDescendantNodes(selectedNode, nodeById)
      .filter((node) => node.kind === 'exception')
      .sort(compareStoryOrder);
    if (selectedFailures.length > 0) {
      return selectedNode;
    }
  }

  const primaryFailure = selectPrimaryFailure(nodes.filter((node) => node.kind === 'exception'));
  if (!primaryFailure) {
    return undefined;
  }
  return findFailureOwner(primaryFailure, nodes.find((node) => node.kind === 'root')?.id ?? primaryFailure.id, nodeById) ?? primaryFailure;
}

function buildPathBetween(parentNode: StoryNode, targetNode: StoryNode, nodeById: Map<string, StoryNode>): StoryNode[] {
  const path: StoryNode[] = [];
  let cursor: StoryNode | undefined = targetNode;
  while (cursor) {
    path.push(cursor);
    if (cursor.id === parentNode.id) {
      break;
    }
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }
  path.reverse();
  return path[0]?.id === parentNode.id ? path : [parentNode, targetNode];
}

function findFailureOwner(
  exceptionNode: StoryNode,
  scopeId: string,
  nodeById: Map<string, StoryNode>
): StoryNode | undefined {
  const meaningfulKinds = new Set<NodeKind>(['soql', 'method', 'trigger', 'flowElement', 'flow', 'dml', 'async', 'email', 'callout', 'apex', 'codeUnit']);
  let fallback: StoryNode | undefined;
  let cursor = exceptionNode.parentId ? nodeById.get(exceptionNode.parentId) : undefined;

  while (cursor) {
    if (!fallback && cursor.kind !== 'root') {
      fallback = cursor;
    }
    if (cursor.id === scopeId) {
      return fallback ?? cursor;
    }
    if (meaningfulKinds.has(cursor.kind)) {
      return cursor;
    }
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }

  return fallback;
}

function graphRelation(
  nodeId: string,
  context: ReturnType<typeof buildGraphContext> | null
): GraphRelation {
  if (!context) {
    return 'unrelated';
  }
  if (nodeId === context.selectedId) {
    return 'selected';
  }
  if (context.upstream.has(nodeId)) {
    return 'upstream';
  }
  if (context.downstream.has(nodeId)) {
    return 'downstream';
  }
  return 'unrelated';
}

function edgeRelation(
  sourceId: string,
  targetId: string,
  context: ReturnType<typeof buildGraphContext> | null
): GraphRelation {
  if (!context) {
    return 'unrelated';
  }
  if (sourceId === context.selectedId || targetId === context.selectedId) {
    return targetId === context.selectedId ? 'upstream' : 'downstream';
  }
  if (context.upstream.has(sourceId) && (context.upstream.has(targetId) || targetId === context.selectedId)) {
    return 'upstream';
  }
  if ((context.downstream.has(sourceId) || sourceId === context.selectedId) && context.downstream.has(targetId)) {
    return 'downstream';
  }
  return 'unrelated';
}

function buildRevealPlan(
  nodeId: string,
  nodeById: Map<string, StoryNode>,
  enabledKinds: Set<GraphVisibilityKey>,
  query: string
): RevealPlan {
  const expansionIds = new Set<string>([nodeId]);
  const visibleChildIds: string[] = [];
  const visited = new Set<string>();
  const normalized = query.trim().toLowerCase();

  const visitChildren = (parentId: string) => {
    if (visited.has(parentId)) {
      return;
    }
    visited.add(parentId);
    expansionIds.add(parentId);
    const parent = nodeById.get(parentId);
    parent?.childIds.forEach((childId) => {
      const child = nodeById.get(childId);
      if (!child) {
        return;
      }
      if (isGraphCandidate(child, enabledKinds, normalized, nodeById)) {
        visibleChildIds.push(child.id);
        return;
      }
      expansionIds.add(child.id);
      visitChildren(child.id);
    });
  };

  visitChildren(nodeId);
  return { expansionIds, visibleChildIds };
}

function addAncestorExpansion(nodeId: string, nodeById: Map<string, StoryNode>, target: Set<string>): void {
  let cursor = nodeById.get(nodeId);
  while (cursor) {
    target.add(cursor.id);
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }
}

function addParentExpansion(nodeId: string, nodeById: Map<string, StoryNode>, target: Set<string>): void {
  const node = nodeById.get(nodeId);
  let cursor = node?.parentId ? nodeById.get(node.parentId) : undefined;
  while (cursor) {
    target.add(cursor.id);
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }
}

function isGraphCandidate(
  node: StoryNode,
  enabledKinds: Set<GraphVisibilityKey>,
  normalizedQuery: string,
  nodeById?: Map<string, StoryNode>
): boolean {
  if (node.kind === 'soql') {
    return false;
  }
  if (isGraphBridgeNode(node)) {
    return false;
  }
  if (nodeById && isInsideDisabledGraphFamily(node, nodeById, enabledKinds)) {
    return false;
  }
  const matchesSearch = nodeMatchesSearch(node, normalizedQuery);
  return matchesSearch && isGraphFamilyEnabled(node, enabledKinds);
}

function isGraphFamilyEnabled(node: StoryNode, enabledKinds: Set<GraphVisibilityKey>): boolean {
  if (node.kind === 'validation' || node.kind === 'workflow') {
    return false;
  }
  if (node.kind === 'trigger') {
    return enabledKinds.has('trigger');
  }
  if (node.kind === 'flow' || node.kind === 'flowElement') {
    return enabledKinds.has('flow');
  }
  if (node.kind === 'exception') {
    return enabledKinds.has('exception');
  }
  if (node.kind === 'async') {
    return enabledKinds.has('async');
  }
  if (node.kind === 'callout') {
    return enabledKinds.has('callout');
  }
  if (isApexActionNode(node)) {
    return enabledKinds.has('apexAction');
  }
  return true;
}

function isInsideDisabledGraphFamily(
  node: StoryNode,
  nodeById: Map<string, StoryNode>,
  enabledKinds: Set<GraphVisibilityKey>
): boolean {
  let cursor = node.parentId ? nodeById.get(node.parentId) : undefined;
  while (cursor) {
    if (isDisabledGraphBranchRoot(cursor, enabledKinds)) {
      return true;
    }
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }
  return false;
}

function isDisabledGraphBranchRoot(node: StoryNode, enabledKinds: Set<GraphVisibilityKey>): boolean {
  if (node.kind === 'trigger') {
    return !enabledKinds.has('trigger');
  }
  if (node.kind === 'flow' || node.kind === 'flowElement') {
    return !enabledKinds.has('flow');
  }
  if (node.kind === 'async') {
    return !enabledKinds.has('async');
  }
  if (node.kind === 'callout') {
    return !enabledKinds.has('callout');
  }
  if (isApexActionNode(node)) {
    return !enabledKinds.has('apexAction');
  }
  return false;
}

function isApexActionNode(node: StoryNode): boolean {
  return node.kind === 'apex' && (node.metrics.apexAction === 'true' || /apex action/i.test(node.subtitle ?? ''));
}

function isGraphBridgeNode(node: StoryNode): boolean {
  return node.kind === 'flowRuntime' && node.metrics.runtimeNode === 'true';
}

function isEmptyFlowRuntimeNode(node: StoryNode, nodeById: Map<string, StoryNode>): boolean {
  if (node.kind !== 'flowRuntime' || node.metrics.runtimeNode !== 'true') {
    return false;
  }
  if (metricText(node.metrics.flowApiName) || metricText(node.metrics.interviewId)) {
    return false;
  }
  if (node.exception || (node.warnings?.length ?? 0) > 0) {
    return false;
  }
  if (
    Number(node.metrics.soqlQueries ?? 0) > 0 ||
    Number(node.metrics.dmlStatements ?? 0) > 0 ||
    Number(node.metrics.cpuMs ?? 0) > 0
  ) {
    return false;
  }
  return !node.childIds.some((childId) => {
    const child = nodeById.get(childId);
    return child && !isEmptyFlowRuntimeNode(child, nodeById);
  });
}

function nodeMatchesSearch(node: StoryNode, normalizedQuery: string): boolean {
  return !normalizedQuery || `${node.label} ${node.subtitle ?? ''} ${node.detail ?? ''}`.toLowerCase().includes(normalizedQuery);
}

function nearestVisibleParent(
  node: StoryNode,
  byId: Map<string, StoryNode>,
  visibleIds: Set<string>
): StoryNode | null {
  let cursor = node.parentId ? byId.get(node.parentId) : undefined;
  while (cursor) {
    if (visibleIds.has(cursor.id)) {
      return cursor;
    }
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return null;
}

function isDescendantOf(node: StoryNode, ancestorId: string | null, byId: Map<string, StoryNode>): boolean {
  if (!ancestorId) {
    return false;
  }
  let cursor = node.parentId ? byId.get(node.parentId) : undefined;
  while (cursor) {
    if (cursor.id === ancestorId) {
      return true;
    }
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return false;
}

function resolveDmlFocusId(
  clickedNode: StoryNode | undefined,
  currentDmlFocusId: string | null,
  nodeById: Map<string, StoryNode>
): string | null {
  if (!clickedNode) {
    return currentDmlFocusId;
  }
  if (clickedNode.kind === 'dml') {
    return clickedNode.id;
  }
  if (currentDmlFocusId && isDescendantOf(clickedNode, currentDmlFocusId, nodeById)) {
    return currentDmlFocusId;
  }

  let cursor = clickedNode.parentId ? nodeById.get(clickedNode.parentId) : undefined;
  while (cursor) {
    if (cursor.kind === 'dml') {
      return cursor.id;
    }
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }
  return null;
}

function focusExpandedNodes(nodes: StoryNode[], selectedId?: string): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const expanded = new Set<string>();
  let cursor = selectedId ? byId.get(selectedId) : undefined;
  while (cursor) {
    if (cursor.kind !== 'root') {
      expanded.add(cursor.id);
    }
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return expanded;
}

function collectDescendantNodes(node: StoryNode, nodeById: Map<string, StoryNode>): StoryNode[] {
  const found: StoryNode[] = [];
  const visit = (id: string) => {
    const child = nodeById.get(id);
    if (!child) {
      return;
    }
    found.push(child);
    child.childIds.forEach(visit);
  };
  node.childIds.forEach(visit);
  return found;
}

function collectDataReads(node: StoryNode, nodeById: Map<string, StoryNode>): StoryNode[] {
  const scope = node.kind === 'soql' ? [node] : collectDescendantNodes(node, nodeById);
  return scope.filter((child) => child.kind === 'soql').sort((a, b) => a.lineStart - b.lineStart);
}

function buildDataOperationIndex(
  nodes: StoryNode[],
  nodeById: Map<string, StoryNode>,
  query: string
): DataOperationIndex {
  const normalizedQuery = query.trim().toLowerCase();
  const dmlGroups = buildDmlOperationGroups(nodes.filter((node) => node.kind === 'dml'), nodeById);
  const soqlGroups = buildSoqlOperationGroups(nodes.filter((node) => node.kind === 'soql'), nodeById);
  const errorGroups = buildErrorOperationGroups(nodes.filter((node) => node.kind === 'exception'), nodeById);
  const asyncGroups = buildAsyncOperationGroups(nodes.filter((node) => node.kind === 'async'), nodeById);
  const emailGroups = buildEmailOperationGroups(nodes.filter((node) => node.kind === 'email'), nodeById);
  const calloutGroups = buildCalloutOperationGroups(nodes.filter((node) => node.kind === 'callout'), nodeById);
  return {
    dmlGroups: filterDataOperationGroups(dmlGroups, normalizedQuery),
    soqlGroups: filterDataOperationGroups(soqlGroups, normalizedQuery),
    errorGroups: filterDataOperationGroups(errorGroups, normalizedQuery),
    asyncGroups: filterDataOperationGroups(asyncGroups, normalizedQuery),
    emailGroups: filterDataOperationGroups(emailGroups, normalizedQuery),
    calloutGroups: filterDataOperationGroups(calloutGroups, normalizedQuery)
  };
}

function buildDmlOperationGroups(nodes: StoryNode[], nodeById: Map<string, StoryNode>): DataOperationGroup[] {
  const byKey = new Map<string, StoryNode[]>();
  nodes.forEach((node) => {
    const operation = titleCaseDmlOperation(String(node.metrics.operation ?? 'DML'));
    const objectName = String(node.metrics.objectName ?? 'SObject');
    const key = `dml:${operation.toLowerCase()}:${objectName.toLowerCase()}`;
    byKey.set(key, [...(byKey.get(key) ?? []), node]);
  });

  return [...byKey.entries()]
    .map(([key, groupNodes]) => {
      const orderedNodes = [...groupNodes].sort(compareStoryOrder);
      const first = orderedNodes[0];
      const operation = titleCaseDmlOperation(String(first.metrics.operation ?? 'DML'));
      const objectName = String(first.metrics.objectName ?? 'SObject');
      const classification = classifyDmlNode(first, []);
      const rowCount = orderedNodes.reduce((total, node) => total + Number(node.metrics.rows ?? 0), 0);
      const durationMs = orderedNodes.reduce((total, node) => total + Number(node.durationMs ?? 0), 0);
      const statementText = `${formatNumber(orderedNodes.length)} statement${orderedNodes.length === 1 ? '' : 's'} · ${formatNumber(rowCount)} row${rowCount === 1 ? '' : 's'}`;
      return {
        key,
        kind: 'dml' as const,
        label: `${operation} ${objectName}`,
        subtitle: classification.isPlatformEvent ? `Platform Event Publish · ${statementText}` : statementText,
        executionCount: orderedNodes.length,
        rowCount,
        durationMs,
        nodes: orderedNodes,
        tone: classification.tone,
        occurrences: orderedNodes.map((node, index) => ({
          node,
          sequence: index + 1,
          colorIndex: index % 6,
          tone: classifyDmlNode(node, []).tone,
          ownerLabel: operationOwnerLabel(node, nodeById),
          ownerKind: operationOwnerKind(node, nodeById),
          lineLabel: `line ${node.lineStart}`,
          countLabel: `${formatNumber(Number(node.metrics.rows ?? 0))} row${Number(node.metrics.rows ?? 0) === 1 ? '' : 's'}`
        }))
      };
    })
    .sort((a, b) => b.executionCount - a.executionCount || b.rowCount - a.rowCount || a.label.localeCompare(b.label));
}

function buildSoqlOperationGroups(nodes: StoryNode[], nodeById: Map<string, StoryNode>): DataOperationGroup[] {
  const byKey = new Map<string, StoryNode[]>();
  nodes.forEach((node) => {
    const key = `soql:${normalizeQueryShape(node.detail ?? node.label)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), node]);
  });

  return [...byKey.entries()]
    .map(([key, groupNodes]) => {
      const orderedNodes = [...groupNodes].sort(compareStoryOrder);
      const first = orderedNodes[0];
      const executionCount = orderedNodes.reduce((total, node) => total + queryExecutionCount(node), 0);
      const rowCount = orderedNodes.reduce((total, node) => total + queryRows(node), 0);
      const durationMs = orderedNodes.reduce((total, node) => total + queryDurationMs(node), 0);
      const objectName = queryObjectName(first);
      return {
        key,
        kind: 'soql' as const,
        label: `Query ${objectName}`,
        subtitle: `${formatNumber(executionCount)} execution${executionCount === 1 ? '' : 's'} · ${formatNumber(orderedNodes.length)} owner${orderedNodes.length === 1 ? '' : 's'} · ${formatNumber(rowCount)} row${rowCount === 1 ? '' : 's'}${durationMs > 0 ? ` · ${formatMs(durationMs)} SOQL time` : ''}`,
        detail: first.detail,
        executionCount,
        rowCount,
        durationMs,
        nodes: orderedNodes,
        occurrences: orderedNodes.map((node, index) => {
          const count = queryExecutionCount(node);
          const duration = queryDurationMs(node);
          return {
            node,
            sequence: index + 1,
            colorIndex: index % 6,
            ownerLabel: operationOwnerLabel(node, nodeById),
            ownerKind: operationOwnerKind(node, nodeById),
            lineLabel: `line ${node.lineStart}${node.metrics.sourceLine ? ` · Apex ${node.metrics.sourceLine}` : ''}`,
            countLabel: `${formatNumber(count)}x${duration > 0 ? ` · ${formatMs(duration)}` : ''}`
          };
        })
      };
    })
    .sort((a, b) => b.executionCount - a.executionCount || b.rowCount - a.rowCount || a.label.localeCompare(b.label));
}

function buildErrorOperationGroups(nodes: StoryNode[], nodeById: Map<string, StoryNode>): DataOperationGroup[] {
  const byKey = new Map<string, StoryNode[]>();
  nodes.forEach((node) => {
    const type = node.exception?.exceptionType ?? String(node.metrics.exceptionType ?? node.label);
    const code = metricText(node.metrics.salesforceErrorCode);
    const message = compactErrorMessage(node.exception?.message ?? node.subtitle ?? node.detail ?? '');
    const key = `error:${type.toLowerCase()}:${code?.toLowerCase() ?? ''}:${message.toLowerCase()}`;
    byKey.set(key, [...(byKey.get(key) ?? []), node]);
  });

  return [...byKey.entries()]
    .map(([key, groupNodes]) => {
      const orderedNodes = [...groupNodes].sort(compareStoryOrder);
      const first = orderedNodes[0];
      const type = first.exception?.exceptionType ?? String(first.metrics.exceptionType ?? first.label);
      const code = metricText(first.metrics.salesforceErrorCode);
      const category = metricText(first.metrics.errorCategory);
      const message = first.exception?.message ?? first.subtitle ?? first.detail;
      return {
        key,
        kind: 'exception' as const,
        label: code ?? type,
        subtitle: `${formatNumber(orderedNodes.length)} error${orderedNodes.length === 1 ? '' : 's'}${category ? ` · ${category}` : ''} · first line ${first.lineStart}`,
        detail: message,
        executionCount: orderedNodes.length,
        rowCount: 0,
        durationMs: orderedNodes.reduce((total, node) => total + Number(node.durationMs ?? 0), 0),
        nodes: orderedNodes,
        occurrences: orderedNodes.map((node, index) => ({
          node,
          sequence: index + 1,
          colorIndex: index % 6,
          ownerLabel: operationOwnerLabel(node, nodeById),
          ownerKind: operationOwnerKind(node, nodeById),
          lineLabel: `line ${node.lineStart}${node.metrics.apexLine ? ` · Apex ${node.metrics.apexLine}` : ''}`,
          countLabel: metricText(node.metrics.salesforceErrorCode) ?? metricText(node.metrics.errorCategory) ?? String(node.metrics.eventType ?? 'error')
        }))
      };
    })
    .sort((a, b) => b.executionCount - a.executionCount || a.nodes[0].lineStart - b.nodes[0].lineStart || a.label.localeCompare(b.label));
}

function buildAsyncOperationGroups(nodes: StoryNode[], nodeById: Map<string, StoryNode>): DataOperationGroup[] {
  const byKey = new Map<string, StoryNode[]>();
  nodes.forEach((node) => {
    const asyncType = String(node.metrics.asyncType ?? 'Async Apex');
    const role = asyncRoleValue(node);
    const key = `async:${role}:${asyncType.toLowerCase()}:${node.label.toLowerCase()}`;
    byKey.set(key, [...(byKey.get(key) ?? []), node]);
  });

  return [...byKey.entries()]
    .map(([key, groupNodes]) => {
      const orderedNodes = [...groupNodes].sort(compareStoryOrder);
      const first = orderedNodes[0];
      const asyncType = String(first.metrics.asyncType ?? 'Async Apex');
      const role = asyncRoleValue(first);
      const durationMs = orderedNodes.reduce((total, node) => total + Number(node.durationMs ?? 0), 0);
      const itemWord = role === 'transaction' ? 'transaction' : 'request';
      return {
        key,
        kind: 'async' as const,
        label: role === 'transaction' ? `${asyncType} Transaction` : first.label,
        subtitle: `${formatNumber(orderedNodes.length)} ${itemWord}${orderedNodes.length === 1 ? '' : 's'} · ${asyncGroupSummary(first)}`,
        detail: first.detail,
        executionCount: orderedNodes.length,
        rowCount: 0,
        durationMs,
        nodes: orderedNodes,
        occurrences: orderedNodes.map((node, index) => ({
          node,
          sequence: index + 1,
          colorIndex: index % 6,
          ownerLabel: operationOwnerLabel(node, nodeById),
          ownerKind: operationOwnerKind(node, nodeById),
          lineLabel: `line ${node.lineStart}${node.metrics.sourceLine ? ` · Apex ${node.metrics.sourceLine}` : ''}`,
          countLabel: asyncRoleValue(node) === 'transaction' ? 'ran here' : String(node.metrics.requestVerb ?? 'queued')
        }))
      };
    })
    .sort((a, b) => b.executionCount - a.executionCount || b.durationMs - a.durationMs || a.label.localeCompare(b.label));
}

function buildEmailOperationGroups(nodes: StoryNode[], nodeById: Map<string, StoryNode>): DataOperationGroup[] {
  const byKey = new Map<string, StoryNode[]>();
  nodes.forEach((node) => {
    const emailType = String(node.metrics.emailType ?? 'Email');
    const identity =
      emailType === 'Flow Email Action'
        ? node.metrics.apiName ?? node.metrics.emailActionName ?? node.metrics.reference ?? node.label
        : node.metrics.emailApi ?? node.metrics.reference ?? node.metrics.apiName ?? node.label;
    const groupingKey =
      String(identity)
        .trim()
        .toLowerCase() || node.label.toLowerCase();
    const key = `email:${emailType.toLowerCase()}:${groupingKey}`;
    byKey.set(key, [...(byKey.get(key) ?? []), node]);
  });

  return [...byKey.entries()]
    .map(([key, groupNodes]) => {
      const orderedNodes = [...groupNodes].sort(compareStoryOrder);
      const first = orderedNodes[0];
      const emailType = String(first.metrics.emailType ?? 'Email');
      const durationMs = orderedNodes.reduce((total, node) => total + Number(node.durationMs ?? 0), 0);
      return {
        key,
        kind: 'email' as const,
        label: emailGroupLabel(first),
        subtitle: `${formatNumber(orderedNodes.length)} send${orderedNodes.length === 1 ? '' : 's'} · ${emailType}`,
        detail: first.detail,
        executionCount: orderedNodes.length,
        rowCount: 0,
        durationMs,
        nodes: orderedNodes,
        occurrences: orderedNodes.map((node, index) => ({
          node,
          sequence: index + 1,
          colorIndex: index % 6,
          ownerLabel: operationOwnerLabel(node, nodeById),
          ownerKind: operationOwnerKind(node, nodeById),
          lineLabel: `line ${node.lineStart}${node.metrics.sourceLine ? ` · Apex ${node.metrics.sourceLine}` : ''}`,
          countLabel: emailOccurrenceStatus(node)
        }))
      };
    })
    .sort((a, b) => b.executionCount - a.executionCount || b.durationMs - a.durationMs || a.label.localeCompare(b.label));
}

function buildCalloutOperationGroups(nodes: StoryNode[], nodeById: Map<string, StoryNode>): DataOperationGroup[] {
  const byKey = new Map<string, StoryNode[]>();
  nodes.forEach((node) => {
    const method = String(node.metrics.method ?? 'HTTP');
    const endpoint = String(node.metrics.endpointHost ?? node.metrics.endpoint ?? node.label);
    const key = `callout:${method.toLowerCase()}:${endpoint.toLowerCase()}`;
    byKey.set(key, [...(byKey.get(key) ?? []), node]);
  });

  return [...byKey.entries()]
    .map(([key, groupNodes]) => {
      const orderedNodes = [...groupNodes].sort(compareStoryOrder);
      const first = orderedNodes[0];
      const method = String(first.metrics.method ?? 'HTTP');
      const endpoint = String(first.metrics.endpointHost ?? first.metrics.endpoint ?? first.label);
      const durationMs = orderedNodes.reduce((total, node) => total + Number(node.durationMs ?? 0), 0);
      return {
        key,
        kind: 'callout' as const,
        label: `${method} ${endpoint}`.trim(),
        subtitle: `${formatNumber(orderedNodes.length)} callout${orderedNodes.length === 1 ? '' : 's'}${durationMs > 0 ? ` · ${formatMs(durationMs)}` : ''}`,
        detail: first.detail,
        executionCount: orderedNodes.length,
        rowCount: 0,
        durationMs,
        nodes: orderedNodes,
        occurrences: orderedNodes.map((node, index) => ({
          node,
          sequence: index + 1,
          colorIndex: index % 6,
          ownerLabel: operationOwnerLabel(node, nodeById),
          ownerKind: operationOwnerKind(node, nodeById),
          lineLabel: `line ${node.lineStart}${node.metrics.sourceLine ? ` · Apex ${node.metrics.sourceLine}` : ''}`,
          countLabel: calloutOccurrenceStatus(node)
        }))
      };
    })
    .sort((a, b) => b.executionCount - a.executionCount || b.durationMs - a.durationMs || a.label.localeCompare(b.label));
}

function emailGroupLabel(node: StoryNode): string {
  const emailType = String(node.metrics.emailType ?? '');
  if (emailType === 'Apex Messaging') {
    return String(node.metrics.emailApi ?? 'Apex Email Send');
  }
  if (emailType === 'Workflow Email Alert') {
    return metricText(node.metrics.reference) ?? 'Workflow Email Alert';
  }
  if (emailType === 'Flow Email Action') {
    return metricText(node.metrics.apiName) ?? 'Flow Email Action';
  }
  return node.label;
}

function emailOccurrenceStatus(node: StoryNode): string {
  const status = String(node.metrics.emailStatus ?? 'sent');
  const recipients = Number(node.metrics.recipientsQueued ?? 0);
  return recipients > 0 ? `${status} · ${formatNumber(recipients)} recipients` : status;
}

function calloutOccurrenceStatus(node: StoryNode): string {
  const status = metricText(node.metrics.statusCode) ?? metricText(node.metrics.status) ?? 'request';
  const duration = node.durationMs && node.durationMs > 0 ? ` · ${formatMs(node.durationMs)}` : '';
  return `${status}${duration}`;
}

function filterDataOperationGroups(groups: DataOperationGroup[], normalizedQuery: string): DataOperationGroup[] {
  if (!normalizedQuery) {
    return groups;
  }
  return groups.filter((group) => {
    const haystack = [
      group.label,
      group.subtitle,
      group.detail ?? '',
      ...group.occurrences.flatMap((occurrence) => [
        occurrence.ownerLabel,
        occurrence.lineLabel,
        occurrence.node.detail ?? '',
        occurrence.node.subtitle ?? ''
      ])
    ].join(' ').toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function asyncGroupSummary(node: StoryNode): string {
  return asyncRoleValue(node) === 'transaction' ? 'ran in this log' : 'separate Apex transaction';
}

function asyncRoleValue(node: StoryNode): 'request' | 'transaction' {
  return String(node.metrics.asyncRole ?? 'request') === 'transaction' ? 'transaction' : 'request';
}

function asyncGroupRole(group: DataOperationGroup): 'request' | 'transaction' {
  return group.nodes.some((node) => asyncRoleValue(node) === 'transaction') ? 'transaction' : 'request';
}

function dataOperationCountUnit(group: DataOperationGroup): string {
  if (group.kind === 'dml') {
    return 'statement';
  }
  if (group.kind === 'soql') {
    return 'execution';
  }
  if (group.kind === 'email') {
    return 'send';
  }
  if (group.kind === 'callout') {
    return 'callout';
  }
  if (group.kind === 'exception') {
    return 'error';
  }
  return asyncGroupRole(group) === 'transaction' ? 'transaction' : 'request';
}

function operationOwnerLabel(node: StoryNode, nodeById: Map<string, StoryNode>): string {
  const ownerSignature = node.metrics.ownerSignature ? String(node.metrics.ownerSignature) : undefined;
  const caller = callerSummary(node);
  const ownerNode = operationOwnerNode(node, nodeById);
  return ownerSignature ?? caller ?? ownerNode?.label ?? node.label;
}

function operationOwnerKind(node: StoryNode, nodeById: Map<string, StoryNode>): NodeKind {
  if (node.metrics.ownerSignature || node.callerChain?.length) {
    return 'method';
  }
  return operationOwnerNode(node, nodeById)?.kind ?? node.kind;
}

function operationOwnerNode(node: StoryNode, nodeById: Map<string, StoryNode>): StoryNode | undefined {
  const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
  if (parent && parent.kind !== 'root') {
    return parent;
  }
  return getAncestors(node, nodeById).find((ancestor) =>
    ['method', 'trigger', 'flow', 'flowElement', 'apex', 'async', 'email', 'callout', 'codeUnit', 'dml'].includes(ancestor.kind)
  );
}

function normalizeQueryShape(query: string): string {
  return query.replace(/\s+/g, ' ').trim().toLowerCase();
}

function compactQueryForDisplay(query: string): string {
  const compact = query.replace(/\s+/g, ' ').trim();
  return compact.length > 360 ? `${compact.slice(0, 360)}...` : compact;
}

function compactErrorMessage(message: string): string {
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

function titleCaseDmlOperation(operation: string): string {
  const lower = operation.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function collectLocalDataReads(node: StoryNode, nodeById: Map<string, StoryNode>): StoryNode[] {
  if (node.kind === 'soql') {
    return [node];
  }
  return node.childIds
    .map((childId) => nodeById.get(childId))
    .filter((child): child is StoryNode => child?.kind === 'soql')
    .sort((a, b) => a.lineStart - b.lineStart);
}

function isHighConfidenceQueryOwnerRead(read: StoryNode): boolean {
  return read.metrics.attributionConfidence === 'high' || Boolean(read.metrics.ownerSignature);
}

function collectDownstreamDataReads(node: StoryNode, nodeById: Map<string, StoryNode>): StoryNode[] {
  const localIds = new Set(collectLocalDataReads(node, nodeById).map((read) => read.id));
  return collectDataReads(node, nodeById).filter((read) => !localIds.has(read.id));
}

function buildQueryBranchBreakdown(node: StoryNode, nodeById: Map<string, StoryNode>): QueryBranchBreakdown[] {
  return node.childIds
    .map((childId) => {
      const child = nodeById.get(childId);
      if (!child) {
        return null;
      }
      const summary = summarizeQueryReads(collectDataReads(child, nodeById));
      if (summary.executionCount <= 0) {
        return null;
      }
      return { node: child, summary };
    })
    .filter((branch): branch is QueryBranchBreakdown => Boolean(branch))
    .sort((a, b) => b.summary.executionCount - a.summary.executionCount || a.node.lineStart - b.node.lineStart);
}

function summarizeQueryReads(reads: StoryNode[]): QuerySummary {
  const objectExecutions = new Map<string, number>();
  let executionCount = 0;
  let rowCount = 0;
  let repeatCount = 0;
  let totalMs = 0;
  let slowestMs = 0;

  reads.forEach((read) => {
    const executions = queryExecutionCount(read);
    const objectName = queryObjectName(read);
    const duration = queryDurationMs(read);
    executionCount += executions;
    rowCount += queryRows(read);
    repeatCount += Math.max(0, executions - 1);
    totalMs += duration;
    slowestMs = Math.max(slowestMs, duration);
    objectExecutions.set(objectName, (objectExecutions.get(objectName) ?? 0) + executions);
  });

  const topObject = [...objectExecutions.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];

  return {
    executionCount,
    uniqueQueryCount: reads.length,
    rowCount,
    repeatCount,
    objectCount: objectExecutions.size,
    topObject,
    totalMs,
    slowestMs
  };
}

function buildQueryGroups(reads: StoryNode[]): QueryGroup[] {
  const byObject = new Map<string, StoryNode[]>();
  reads.forEach((read) => {
    const objectName = queryObjectName(read);
    byObject.set(objectName, [...(byObject.get(objectName) ?? []), read]);
  });

  return [...byObject.entries()]
    .map(([objectName, groupReads]) => ({
      objectName,
      reads: groupReads.sort((a, b) => {
        const executionDelta = queryExecutionCount(b) - queryExecutionCount(a);
        return executionDelta || queryRows(b) - queryRows(a) || a.lineStart - b.lineStart;
      }),
      summary: summarizeQueryReads(groupReads)
    }))
    .sort((a, b) => {
      const executionDelta = b.summary.executionCount - a.summary.executionCount;
      return executionDelta || b.summary.rowCount - a.summary.rowCount || a.objectName.localeCompare(b.objectName);
    });
}

function queryExecutionCount(node: StoryNode): number {
  return Math.max(1, Number(node.metrics.executionCount ?? node.loopMultiplier ?? 1) || 1);
}

function flowInterviewCount(node?: StoryNode): number {
  return Math.max(1, Number(node?.metrics.interviewCount ?? node?.loopMultiplier ?? 1) || 1);
}

function queryRows(node: StoryNode): number {
  return Math.max(0, Number(node.metrics.rows ?? 0) || 0);
}

function queryDurationMs(node: StoryNode): number {
  const exactDuration = Number(node.metrics.totalDurationMs ?? 0);
  if (exactDuration > 0) {
    return exactDuration;
  }
  const profileDuration = Number(node.metrics.profileDurationMs ?? 0);
  if (profileDuration > 0) {
    return profileDuration;
  }
  return Math.max(0, Number(node.durationMs ?? 0) || 0);
}

function queryObjectName(node: StoryNode): string {
  return String(node.metrics.objectName ?? (node.label.replace(/^Query\s+/i, '') || 'Unknown'));
}

function callerSummary(node: StoryNode): string | undefined {
  return metricText(node.metrics.ownerSignature) ?? friendlyApexLocation(node.callerChain?.at(-1) ?? node.callerChain?.[0]);
}

function friendlyApexLocation(signature: string | undefined): string | undefined {
  return signature?.replace(/\.line(\d+)$/, ' line $1');
}

function soqlLensTone(summary?: QuerySummary): string {
  if (!summary || summary.executionCount === 0) {
    return '';
  }
  if (summary.executionCount >= 20 || summary.rowCount >= 5000 || summary.repeatCount >= 10) {
    return 'soql-lens-heavy';
  }
  if (summary.executionCount >= 5 || summary.repeatCount > 0) {
    return 'soql-lens-watch';
  }
  return 'soql-lens-calm';
}

function collectDebugMessages(node: StoryNode, nodeById: Map<string, StoryNode>) {
  return [node, ...collectDescendantNodes(node, nodeById)]
    .flatMap((child) => child.debugMessages ?? [])
    .sort((a, b) => a.line - b.line);
}

function buildExceptionContext(node: StoryNode, nodeById: Map<string, StoryNode>) {
  const allNodes = [...nodeById.values()];
  const apexLine = node.exception?.apexLine;
  const failingQuery = allNodes
    .filter((candidate) => candidate.kind === 'soql' && candidate.lineStart <= node.lineStart)
    .filter((candidate) => apexLine === undefined || Number(candidate.metrics.sourceLine ?? 0) === apexLine || node.lineStart - candidate.lineStart <= 3)
    .sort((a, b) => b.lineStart - a.lineStart)
    .at(0);
  const stack = node.exception?.stack ?? [];
  const rawTravelPath = stack.length > 0
    ? [...stack].reverse()
    : (node.callerChain ?? []);
  const travelPath = rawTravelPath.filter(isUsefulTravelFrame);
  const hotspotSource = allNodes
    .filter((candidate) => candidate.kind === 'soql')
    .filter((candidate) => queryExecutionCount(candidate) > 1 || candidate.metrics.attributionConfidence === 'high')
    .sort((a, b) => queryExecutionCount(b) - queryExecutionCount(a) || b.lineStart - a.lineStart);
  const hotspots = dedupeQueryHotspots([
    ...(failingQuery ? [failingQuery] : []),
    ...hotspotSource
  ]);
  const confidence = failingQuery?.metrics.attributionConfidence === 'high' || stack.length > 0
    ? 'High confidence: stack + profiling'
    : 'Log evidence';

  return { failingQuery, travelPath, hotspots, confidence };
}

function dedupeQueryHotspots(reads: StoryNode[]): StoryNode[] {
  const byKey = new Map<string, StoryNode>();
  reads.forEach((read) => {
    const key = [
      read.metrics.ownerSignature ?? callerSummary(read) ?? read.parentId ?? read.id,
      read.metrics.objectName ?? read.label,
      read.metrics.sourceLine ?? read.lineStart
    ].join('|');
    const existing = byKey.get(key);
    if (!existing || queryExecutionCount(read) > queryExecutionCount(existing)) {
      byKey.set(key, read);
    }
  });
  return [...byKey.values()].sort((a, b) => queryExecutionCount(b) - queryExecutionCount(a) || a.lineStart - b.lineStart);
}

function isUsefulTravelFrame(frame: string): boolean {
  return !/^SObjectDomain\./.test(frame);
}

function buildFlowContext(selectedNode: StoryNode, ancestors: StoryNode[], descendants: StoryNode[]): FlowContext {
  const owningFlow = selectedNode.kind === 'flowElement'
    ? ancestors.find((ancestor) => ancestor.kind === 'flow' && metricText(ancestor.metrics.flowApiName))
    : undefined;
  const flowApiName = metricText(selectedNode.metrics.flowApiName) ?? metricText(owningFlow?.metrics.flowApiName);
  const owningRuntime = selectedNode.kind === 'flowRuntime'
    ? selectedNode
    : ancestors.find((ancestor) => ancestor.kind === 'flowRuntime' && ancestor.metrics.runtimeNode);
  const runtimeObject = metricText(owningRuntime?.metrics.objectName);
  const flowInterviews = uniqueStoryNodes(
    descendants.filter((node) => node.kind === 'flow' && Boolean(metricText(node.metrics.flowApiName)))
  );

  return {
    flowApiName,
    runtimeObject,
    interviewId: metricText(selectedNode.metrics.interviewId) ?? metricText(owningFlow?.metrics.interviewId),
    interviewCount: flowInterviewCount(selectedNode.kind === 'flow' ? selectedNode : owningFlow),
    flowDefinitionId: metricText(selectedNode.metrics.flowDefinitionId) ?? metricText(owningFlow?.metrics.flowDefinitionId),
    flowVersionId: metricText(selectedNode.metrics.flowVersionId) ?? metricText(owningFlow?.metrics.flowVersionId),
    elementApiName: selectedNode.kind === 'flowElement' ? metricText(selectedNode.metrics.apiName) : undefined,
    elementType: selectedNode.kind === 'flowElement' ? metricText(selectedNode.metrics.elementType) : undefined,
    flowNode: selectedNode.kind === 'flow' && flowApiName ? selectedNode : owningFlow,
    flowInterviews
  };
}

function uniqueStoryNodes(nodes: StoryNode[]): StoryNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) {
      return false;
    }
    seen.add(node.id);
    return true;
  });
}

function metricText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return String(value);
}

function indefiniteArticle(value: string): 'a' | 'an' {
  return /^[aeiou]/i.test(value.trim()) ? 'an' : 'a';
}

function buildDmlImpact(node: StoryNode, nodeById: Map<string, StoryNode>): DmlImpact {
  const ancestors = getAncestors(node, nodeById);
  const descendants = collectDescendantNodes(node, nodeById);
  const meaningfulNodes = [...nodeById.values()]
    .filter((candidate) => candidate.id !== node.id && isMeaningfulStoryNode(candidate))
    .sort((a, b) => a.lineStart - b.lineStart);
  const previousMeaningful = meaningfulNodes.filter((candidate) => candidate.lineStart < node.lineStart).at(-1);
  const nextMeaningful = meaningfulNodes.find((candidate) => candidate.lineStart > node.lineEnd);
  const directAutomation = descendants.filter((child) =>
    ['method', 'trigger', 'flow', 'flowElement', 'validation', 'workflow', 'dml', 'email', 'exception'].includes(child.kind)
  );
  const automationGroups = buildDmlImpactGroups(node, descendants, nodeById);
  const failureNodes = descendants.filter((child) => child.kind === 'exception');
  const counts = summarizeStoryKindCounts(descendants);
  const classification = classifyDmlNode(node, ancestors);
  const objectName = String(node.metrics.objectName ?? 'SObject');
  const operation = String(node.metrics.operation ?? 'DML');

  let summary: string;
  if (classification.isPlatformEvent && classification.isTelemetry && directAutomation.length === 0) {
    summary = `This ${objectName} publish looks like exception logging emitted after an earlier failure. It is useful evidence, but probably not the original record DML that caused the issue.`;
  } else if (classification.isPlatformEvent) {
    summary = `This is a platform event publish. Treat it as the EventBus publish point; subscribers run from the event bus in their own execution context when those logs are uploaded.`;
  } else if (failureNodes.length > 0) {
    summary = `${operation} on ${objectName} has ${failureNodes.length} downstream error${failureNodes.length === 1 ? '' : 's'} in its execution tree. The error belongs to the highlighted child path, not necessarily to this DML line itself.`;
  } else if (directAutomation.length > 0) {
    summary = `${operation} on ${objectName} caused ${summarizeEffects(counts)} downstream. The graph highlights that impact path from the selected DML.`;
  } else if (classification.tone === 'logging') {
    summary = `This looks like logging or audit DML. It records diagnostic context, but no downstream automation was observed below it.`;
  } else {
    summary = `${operation} on ${objectName} completed without visible downstream automation in the current graph filters.`;
  }

  return {
    classification,
    summary,
    directAutomation,
    automationGroups,
    failureNodes,
    previousMeaningful,
    nextMeaningful,
    counts
  };
}

function buildDmlImpactGroups(
  selectedDml: StoryNode,
  descendants: StoryNode[],
  nodeById: Map<string, StoryNode>
): DmlImpactGroup[] {
  const descendantById = new Map(descendants.map((node) => [node.id, node]));
  const dmlDescendants = descendants
    .filter((node) => node.kind === 'dml')
    .sort((a, b) => a.lineStart - b.lineStart);

  const buildGroup = (groupDml: StoryNode | undefined): DmlImpactGroup | null => {
    const groupId = groupDml?.id ?? selectedDml.id;
    const scopedNodes = descendants.filter((candidate) => {
      if (candidate.id === groupId) {
        return false;
      }
      if (!isDmlGroupSignal(candidate)) {
        return false;
      }
      return nearestDmlAncestorId(candidate, selectedDml.id, nodeById, descendantById) === groupId;
    });

    if (scopedNodes.length === 0) {
      return null;
    }

    const counts = summarizeStoryKindCounts(scopedNodes);
    const dmlObject = groupDml ? String(groupDml.metrics.objectName ?? 'SObject') : String(selectedDml.metrics.objectName ?? 'SObject');
    const operation = groupDml ? String(groupDml.metrics.operation ?? 'DML') : String(selectedDml.metrics.operation ?? 'DML');

    return {
      id: groupId,
      title: groupDml ? `${operation} ${dmlObject}` : `Directly under ${operation} ${dmlObject}`,
      subtitle: groupDml ? 'Nested DML group' : 'Selected DML group',
      dmlNode: groupDml,
      automation: scopedNodes.sort((a, b) => a.lineStart - b.lineStart),
      counts,
      failureNodes: scopedNodes.filter((child) => child.kind === 'exception')
    };
  };

  const groups = [
    buildGroup(undefined),
    ...dmlDescendants.map((dml) => buildGroup(dml))
  ].filter(Boolean) as DmlImpactGroup[];

  const [selectedGroup, ...nestedGroups] = groups;
  const sortedNestedGroups = nestedGroups.sort((a, b) => {
      const aSignal = groupSignalScore(a);
      const bSignal = groupSignalScore(b);
      if (aSignal !== bSignal) {
        return bSignal - aSignal;
      }
      return (a.dmlNode?.lineStart ?? 0) - (b.dmlNode?.lineStart ?? 0);
    });

  return sortedNestedGroups.length > 0
    ? [...sortedNestedGroups, ...(selectedGroup ? [selectedGroup] : [])]
    : selectedGroup
      ? [selectedGroup]
      : [];
}

function groupSignalScore(group: DmlImpactGroup): number {
  const durationScore = Math.min(
    80,
    group.automation.reduce((total, node) => total + (node.durationMs ?? 0), 0) / 150
  );
  return (
    (group.counts.exception ?? 0) * 100 +
    (group.counts.method ?? 0) * 25 +
    (group.counts.trigger ?? 0) * 20 +
    ((group.counts.flow ?? 0) + (group.counts.flowElement ?? 0)) * 10 +
    (group.counts.validation ?? 0) * 8 +
    (group.counts.workflow ?? 0) * 8 +
    (group.counts.async ?? 0) * 12 +
    (group.counts.callout ?? 0) * 14 +
    (group.counts.soql ?? 0) +
    durationScore
  );
}

function nearestDmlAncestorId(
  node: StoryNode,
  selectedDmlId: string,
  nodeById: Map<string, StoryNode>,
  descendantById: Map<string, StoryNode>
): string | null {
  let cursor = node.parentId ? nodeById.get(node.parentId) : undefined;
  while (cursor) {
    if (cursor.kind === 'dml') {
      return cursor.id;
    }
    if (cursor.id === selectedDmlId) {
      return selectedDmlId;
    }
    if (!descendantById.has(cursor.id)) {
      return null;
    }
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }
  return null;
}

function isDmlGroupSignal(node: StoryNode): boolean {
  return ['method', 'trigger', 'flow', 'flowElement', 'validation', 'workflow', 'dml', 'soql', 'async', 'email', 'callout', 'exception'].includes(node.kind);
}

function classifyDmlNode(node: StoryNode, ancestors: StoryNode[]): DmlClassification {
  const objectName = String(node.metrics.objectName ?? '');
  const objectLower = objectName.toLowerCase();
  const operation = String(node.metrics.operation ?? 'DML');
  const isPlatformEvent = /__e$/i.test(objectName);
  const isTelemetry = /(?:error|log|audit|telemetry|exception|monitor|debug)/i.test(objectName);
  const isAutomationContext = ancestors.some((ancestor) =>
    ['trigger', 'flow', 'flowElement', 'validation', 'workflow'].includes(ancestor.kind)
  );
  const isSystemish = objectLower.startsWith('asyncapex') || objectLower.startsWith('crontrigger');

  if (isPlatformEvent) {
    return {
      label: 'Platform Event Publish',
      tone: 'platform',
      badges: [isTelemetry ? 'Exception logging' : 'EventBus.publish', 'Publish point'],
      isPlatformEvent,
      isTelemetry
    };
  }

  if (isTelemetry) {
    return {
      label: 'Logging/Audit DML',
      tone: 'logging',
      badges: ['Diagnostic record', `${operation}`],
      isPlatformEvent,
      isTelemetry
    };
  }

  if (isSystemish) {
    return {
      label: 'System DML',
      tone: 'system',
      badges: ['System', `${operation}`],
      isPlatformEvent,
      isTelemetry
    };
  }

  if (isAutomationContext) {
    return {
      label: 'Automation-originated DML',
      tone: 'automation',
      badges: ['Trigger/Flow context', `${operation}`],
      isPlatformEvent,
      isTelemetry
    };
  }

  return {
    label: 'Record DML',
    tone: 'record',
    badges: ['SObject DML', `${operation}`],
    isPlatformEvent,
    isTelemetry
  };
}

function isMeaningfulStoryNode(node: StoryNode): boolean {
  return ['apex', 'trigger', 'flow', 'flowElement', 'validation', 'workflow', 'method', 'dml', 'async', 'email', 'callout', 'exception', 'codeUnit'].includes(node.kind);
}

function getAncestors(node: StoryNode, nodeById: Map<string, StoryNode>): StoryNode[] {
  const ancestors: StoryNode[] = [];
  let cursor = node.parentId ? nodeById.get(node.parentId) : undefined;
  while (cursor) {
    if (cursor.kind !== 'root') {
      ancestors.push(cursor);
    }
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }
  return ancestors;
}

function buildSelectedPath(node: StoryNode, nodeById: Map<string, StoryNode>): StoryNode[] {
  return [...getAncestors(node, nodeById)]
    .reverse()
    .concat(node)
    .filter((pathNode) => !isGraphBridgeNode(pathNode))
    .filter((pathNode) => ['apex', 'dml', 'trigger', 'flow', 'flowElement', 'method', 'async', 'email', 'callout', 'exception', 'codeUnit'].includes(pathNode.kind))
    .slice(-6);
}

function compactPathLabel(node: StoryNode): string {
  const label = node.kind === 'flow' ? String(node.metrics.flowApiName ?? node.label) : node.label;
  return label.length > 34 ? `${label.slice(0, 31)}...` : label;
}

function explainNode(node: StoryNode, ancestors: StoryNode[], descendants: StoryNode[]): string {
  const nearestContext = ancestors.find((ancestor) => ancestor.kind !== 'method') ?? ancestors[0];
  const counts = summarizeStoryKindCounts(descendants);

  if (node.kind === 'dml') {
    const objectName = node.metrics.objectName ?? 'records';
    const operation = node.metrics.operation ?? 'DML';
    const effects = summarizeEffects(counts);
    const classification = classifyDmlNode(node, ancestors);
    const methodPath = ancestors
      .filter((ancestor) => ancestor.kind === 'method')
      .slice()
      .reverse()
      .map((ancestor) => ancestor.label)
      .join(' -> ');
    const sourceContext = methodPath
      ? `${methodPath} inside ${nearestContext?.label ?? 'the transaction'}`
      : nearestContext?.label ?? 'the transaction entry';
    if (classification.isPlatformEvent && classification.isTelemetry) {
      return `${operation} on ${objectName} is classified as platform-event exception logging. It is likely reporting an earlier failure, so use the journey section below to move back to the preceding record DML or exception.`;
    }
    return `${operation} on ${objectName} is ${articleFor(classification.label)} ${classification.label} issued by ${sourceContext}. Downstream from this DML, the log shows ${effects || 'no additional visible automation'} before control returned.`;
  }

  if (node.kind === 'soql') {
    return `This query reads ${node.metrics.objectName ?? 'records'} and returned ${node.metrics.rows ?? 'unknown'} rows. Its caller path is preserved so a developer can jump from the data access back to the Apex method that requested it.`;
  }

  if (node.kind === 'async') {
    const asyncType = String(node.metrics.asyncType ?? 'Async Apex');
    const role = String(node.metrics.asyncRole ?? 'request');
    if (role === 'transaction') {
      return `This debug log is the ${asyncType} execution transaction. The queue or schedule request happened in an earlier Apex transaction and is not part of this log.`;
    }
    return `${node.label} records an Async Apex request in this transaction. Salesforce runs the resulting ${asyncType} work in a separate Apex transaction unless that async log is uploaded.`;
  }

  if (node.kind === 'email') {
    const emailType = String(node.metrics.emailType ?? 'Email');
    const source = callerSummary(node) ?? nearestContext?.label ?? 'the current transaction';
    return `${node.label} is ${indefiniteArticle(emailType)} ${emailType} send signal emitted by Salesforce at line ${node.lineStart}. It is attributed to ${source}.`;
  }

  if (node.kind === 'callout') {
    const endpoint = metricText(node.metrics.endpointHost) ?? metricText(node.metrics.endpoint) ?? 'an external endpoint';
    const method = metricText(node.metrics.method) ?? 'HTTP';
    const source = callerSummary(node) ?? nearestContext?.label ?? 'the current transaction';
    return `${node.label} records a ${method} callout to ${endpoint} at line ${node.lineStart}. It is attributed to ${source}, so follow this node when diagnosing integration latency or callout failures.`;
  }

  if (node.kind === 'trigger') {
    const effects = summarizeEffects(counts);
    return `${node.label} is part of the automation chain below ${nearestContext?.label ?? 'the transaction'}. Its visible subtree contains ${effects || 'no DML, SOQL, or nested automation'} in the parsed log.`;
  }

  if (node.kind === 'flow') {
    const effects = summarizeEffects(counts);
    const flowApiName = metricText(node.metrics.flowApiName);
    if (flowApiName) {
      return `${flowApiName} is the concrete Flow interview that ran in this transaction. Its visible subtree contains ${effects || 'no DML, SOQL, or nested automation'} in the parsed log.`;
    }
    return `${node.label} is a Flow interview node. Salesforce did not emit the Flow API name on this log segment.`;
  }

  if (node.kind === 'flowElement') {
    const elementApiName = metricText(node.metrics.apiName) ?? node.label;
    const elementType = metricText(node.metrics.elementType) ?? 'Flow element';
    const owningFlow = ancestors.find((ancestor) => ancestor.kind === 'flow' && metricText(ancestor.metrics.flowApiName));
    const flowApiName = metricText(owningFlow?.metrics.flowApiName);
    return `${elementApiName} is a ${elementType} Flow element${flowApiName ? ` inside ${flowApiName}` : ''}. Use Flow context for the Flow API name and interview id.`;
  }

  if (node.kind === 'exception') {
    const type = node.exception?.exceptionType ?? 'This error';
    const message = node.exception?.message ? `: ${node.exception.message}` : '';
    return `${type}${message}. Start here, then walk upstream to see the record operation that led into the failure.`;
  }

  return `This node is positioned inside ${nearestContext?.label ?? 'the transaction'}. Click the node in the graph to reveal the DML, SOQL, Flow interviews, Flow elements, triggers, and evidence that follow it.`;
}

function summarizeEffects(counts: Record<string, number>): string {
  const pieces = [
    counts.method ? `${formatNumber(counts.method)} Apex method${counts.method === 1 ? '' : 's'}` : '',
    counts.trigger ? `${formatNumber(counts.trigger)} trigger${counts.trigger === 1 ? '' : 's'}` : '',
    counts.flow ? `${formatNumber(counts.flow)} Flow interview${counts.flow === 1 ? '' : 's'}` : '',
    counts.dml ? `${formatNumber(counts.dml)} DML operation${counts.dml === 1 ? '' : 's'}` : '',
    counts.soql ? `${formatNumber(counts.soql)} SOQL quer${counts.soql === 1 ? 'y' : 'ies'}` : '',
    counts.async ? `${formatNumber(counts.async)} Async Apex event${counts.async === 1 ? '' : 's'}` : '',
    counts.email ? `${formatNumber(counts.email)} email send${counts.email === 1 ? '' : 's'}` : '',
    counts.callout ? `${formatNumber(counts.callout)} callout${counts.callout === 1 ? '' : 's'}` : '',
    counts.exception ? `${formatNumber(counts.exception)} error${counts.exception === 1 ? '' : 's'}` : ''
  ].filter(Boolean);
  return pieces.join(', ');
}

function summarizeStoryKindCounts(nodes: StoryNode[]): Record<string, number> {
  return nodes.reduce(
    (acc, node) => {
      acc[node.kind] = (acc[node.kind] ?? 0) + storyKindCountWeight(node);
      return acc;
    },
    {} as Record<string, number>
  );
}

function storyKindCountWeight(node: StoryNode): number {
  if (node.kind === 'soql') {
    return queryExecutionCount(node);
  }
  if (node.kind === 'dml') {
    return Math.max(1, Number(node.metrics.executionCount ?? 1) || 1);
  }
  return 1;
}

function articleFor(label: string): 'a' | 'an' {
  return /^[aeiou]/i.test(label) ? 'an' : 'a';
}

function NodeLine({ node, order, total, onClick }: { node: StoryNode; order?: number; total?: number; onClick?: () => void }) {
  const content = (
    <>
      <KindIcon kind={node.kind} />
      <span>
        <strong>{node.label}</strong>
        <small>
          {order !== undefined && total !== undefined ? `${order}/${total} · ` : ''}
          line {node.lineStart}
        </small>
      </span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="node-line-item clickable" onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <div className="node-line-item">
      {content}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  compact = false
}: {
  label: string;
  value: string | number;
  tone: 'neutral' | 'dml' | 'soql' | 'apex' | 'flow' | 'muted';
  compact?: boolean;
}) {
  return (
    <div className={`metric-card tone-${tone} ${compact ? 'compact' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InlineStat({ label, value, title }: { label: string; value: string | number; title?: string }) {
  return (
    <div className="inline-stat" title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildTimelineTimeProfile(nodeById: Map<string, StoryNode>, transactionDurationMs: number): TimeProfile {
  const root = [...nodeById.values()].find((node) => node.kind === 'root');
  const nodes = [...nodeById.values()].filter((node) => {
    if (node.kind === 'root' || node.endNs === undefined || node.endNs <= node.startNs) {
      return false;
    }
    return timelineBucketForNode(node) !== 'other';
  });
  if (!root && nodes.length === 0) {
    return {
      dbMs: 0,
      flowMs: 0,
      codeMs: 0,
      otherMs: transactionDurationMs,
      dbPercent: 0,
      flowPercent: 0,
      codePercent: 0,
      otherPercent: transactionDurationMs > 0 ? 100 : 0
    };
  }
  const startNs = root?.startNs ?? Math.min(...nodes.map((node) => node.startNs));
  const endNs = root?.endNs ?? Math.max(...nodes.map((node) => node.endNs ?? node.startNs));
  const points = [...new Set([startNs, endNs, ...nodes.flatMap((node) => [node.startNs, node.endNs ?? node.startNs])])]
    .filter((point) => Number.isFinite(point) && point >= startNs && point <= endNs)
    .sort((a, b) => a - b);
  const buckets = { db: 0, flow: 0, code: 0, other: 0 };

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (end <= start) {
      continue;
    }

    const activeNode = chooseTimelineNode(nodes, start, end, nodeById);
    const bucket = activeNode ? timelineBucketForNode(activeNode) : 'other';
    buckets[bucket] += end - start;
  }

  const dbMs = nsToMs(buckets.db);
  const flowMs = nsToMs(buckets.flow);
  const codeMs = nsToMs(buckets.code);
  const intervalOtherMs = nsToMs(buckets.other);
  const intervalTotalMs = dbMs + flowMs + codeMs + intervalOtherMs;
  const totalMs = transactionDurationMs > 0 ? transactionDurationMs : intervalTotalMs;
  const otherMs = Math.max(0, totalMs - dbMs - flowMs - codeMs);
  const denominator = totalMs > 0 ? totalMs : 1;
  const dbPercent = Math.round((dbMs / denominator) * 100);
  const flowPercent = Math.round((flowMs / denominator) * 100);
  const codePercent = Math.round((codeMs / denominator) * 100);

  return {
    dbMs,
    flowMs,
    codeMs,
    otherMs,
    dbPercent,
    flowPercent,
    codePercent,
    otherPercent: Math.max(0, 100 - dbPercent - flowPercent - codePercent)
  };
}

function chooseTimelineNode(
  nodes: StoryNode[],
  startNs: number,
  endNs: number,
  nodeById: Map<string, StoryNode>
): StoryNode | undefined {
  let best: StoryNode | undefined;

  nodes.forEach((node) => {
    const nodeEnd = node.endNs ?? node.startNs;
    if (node.startNs > startNs || nodeEnd < endNs) {
      return;
    }
    if (!best || timelineNodeScore(node, nodeById) < timelineNodeScore(best, nodeById)) {
      best = node;
    }
  });

  return best;
}

function timelineNodeScore(node: StoryNode, nodeById: Map<string, StoryNode>): number {
  const duration = Math.max(1, (node.endNs ?? node.startNs) - node.startNs);
  return timelineBucketPriority(node) * 1_000_000_000_000 + duration - nodeDepth(node, nodeById) * 1000;
}

function timelineBucketPriority(node: StoryNode): number {
  if (node.kind === 'dml' || node.kind === 'soql') {
    return 0;
  }
  if (node.kind === 'trigger' || node.kind === 'method' || node.kind === 'async' || node.kind === 'email' || node.kind === 'callout' || node.kind === 'apex' || node.kind === 'codeUnit') {
    return 1;
  }
  if (node.kind === 'flowRuntime' || node.kind === 'flow' || node.kind === 'flowElement' || node.kind === 'validation' || node.kind === 'workflow') {
    return 2;
  }
  return 3;
}

function timelineBucketForNode(node: StoryNode): TimeBucket {
  if (node.kind === 'dml' || node.kind === 'soql') {
    return 'db';
  }
  if (node.kind === 'flowRuntime' || node.kind === 'flow' || node.kind === 'flowElement' || node.kind === 'validation' || node.kind === 'workflow') {
    return 'flow';
  }
  if (node.kind === 'apex' || node.kind === 'trigger' || node.kind === 'method' || node.kind === 'async' || node.kind === 'email' || node.kind === 'callout' || node.kind === 'codeUnit' || node.kind === 'exception') {
    return 'code';
  }
  return 'other';
}

function nodeDepth(node: StoryNode, nodeById: Map<string, StoryNode>): number {
  let depth = 0;
  let cursor = node.parentId ? nodeById.get(node.parentId) : undefined;
  while (cursor) {
    depth += 1;
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }
  return depth;
}

function nsToMs(value: number): number {
  return Math.round((value / 1_000_000) * 100) / 100;
}

function LandingPage({ onUploadClick }: { onUploadClick: () => void }) {
  return (
    <div className="landing-container">
      <div className="landing-hero">
        <div className="landing-logo">
          <img src={appIconUrl} alt="" aria-hidden="true" />
        </div>
        <h2>Apex Debug Log Explorer</h2>
        <p className="landing-subtitle">
          Visualize, profile, and troubleshoot complex Salesforce debug logs locally. Identify CPU bottlenecks, SOQL query hotspots, and DML recursive limits instantly.
        </p>
      </div>

      <div className="landing-dropzone" onClick={onUploadClick}>
        <div className="dropzone-glow" />
        <div className="dropzone-content">
          <div className="dropzone-icons">
            <FileUp size={36} className="icon-upload" />
          </div>
          <h3>Drag and drop your debug log file here</h3>
          <p>Supports standard Salesforce `.log` or `.txt` files (up to 50MB)</p>
          <button type="button" className="upload-button" onClick={(e) => { e.stopPropagation(); onUploadClick(); }}>
            Select File
          </button>
        </div>
      </div>
    </div>
  );
}

function StateOverlay({ title, body }: { title: string; body: string }) {
  return (
    <div className="state-overlay">
      <div className="pulse-ring" />
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function KindIcon({ kind }: { kind: NodeKind }) {
  const size = 15;
  switch (kind) {
    case 'dml':
      return <Database size={size} />;
    case 'soql':
      return <Search size={size} />;
    case 'trigger':
      return <Bolt size={size} />;
    case 'flowRuntime':
    case 'flow':
    case 'flowElement':
      return <Workflow size={size} />;
    case 'exception':
      return <AlertTriangle size={size} />;
    case 'method':
      return <Code2 size={size} />;
    case 'apex':
      return <FileCode2 size={size} />;
    case 'validation':
      return <ShieldCheck size={size} />;
    case 'async':
      return <Send size={size} />;
    case 'email':
      return <Mail size={size} />;
    case 'callout':
      return <Globe2 size={size} />;
    default:
      return <CircleDot size={size} />;
  }
}

function graphNodeColor(node: StoryNode, isLightTheme?: boolean): string {
  if (isLightTheme) {
    const lightColors: Record<NodeKind, string> = {
      root: '#1a56db',
      apex: '#0284c7',
      trigger: '#ca8a04',
      flowRuntime: '#047857',
      flow: '#059669',
      flowElement: '#0d9488',
      validation: '#c026d3',
      workflow: '#ca8a04',
      method: '#475569',
      dml: '#ea580c',
      soql: '#2563eb',
      exception: '#dc2626',
      async: '#7c3aed',
      email: '#0891b2',
      callout: '#0f766e',
      debug: '#65a30d',
      gap: '#7c3aed',
      limit: '#6b7280',
      codeUnit: '#4b5563'
    };
    if (node.kind === 'dml') {
      const tone = classifyDmlNode(node, []).tone;
      const lightDmlColors: Record<DmlTone, string> = {
        record: '#ea580c',
        automation: '#ca8a04',
        platform: '#7c3aed',
        logging: '#65a30d',
        system: '#4b5563'
      };
      return lightDmlColors[tone];
    }
    return lightColors[node.kind] || '#4b5563';
  }

  if (node.kind === 'dml') {
    return DML_TONE_STYLE[classifyDmlNode(node, []).tone].color;
  }
  return KIND_STYLE[node.kind].color;
}

function nodeSubtitle(node: StoryNode): string {
  const loopText = node.loopMultiplier && node.loopMultiplier > 1 ? ` · ${formatNumber(node.loopMultiplier)} repeats` : '';
  if (node.kind === 'dml') {
    const classification = classifyDmlNode(node, []);
    return `${classification.label} · ${node.metrics.rows ?? '?'} row${node.metrics.rows === 1 ? '' : 's'}${loopText}`;
  }
  if (node.kind === 'soql') {
    return `${node.metrics.rows ?? '?'} rows · ${node.metrics.fieldCount ?? '?'} fields${loopText}`;
  }
  if (node.kind === 'gap') {
    return `${formatMs(node.durationMs ?? 0)} quiet time${loopText}`;
  }
  if (node.kind === 'email') {
    const emailType = metricText(node.metrics.emailType) ?? 'Email';
    const status = metricText(node.metrics.emailStatus);
    return `${emailType}${status ? ` · ${status}` : ''}${loopText}`;
  }
  if (node.kind === 'callout') {
    const method = metricText(node.metrics.method) ?? 'HTTP';
    const status = metricText(node.metrics.statusCode) ?? metricText(node.metrics.status);
    return `${method}${status ? ` · ${status}` : ''}${loopText}`;
  }
  if (node.kind === 'flowRuntime') {
    return `Runtime wrapper · ${node.metrics.objectName ?? 'record-triggered'}${loopText}`;
  }
  if (node.kind === 'flow') {
    const interviewCount = flowInterviewCount(node);
    return interviewCount > 1
      ? `${formatNumber(interviewCount)} Flow interviews`
      : `${node.metrics.flowApiName ? 'Flow interview' : (node.subtitle || 'Flow interview')}${loopText}`;
  }
  return `${node.subtitle || `${node.childIds.length} downstream`}${loopText}`;
}

function storyKindLabel(node: StoryNode, fallback: string): string {
  if (node.kind === 'async') {
    return 'Async Apex';
  }
  if (node.kind === 'flowRuntime') {
    return 'Flow runtime';
  }
  if (node.kind === 'flow') {
    return 'Flow interview';
  }
  if (node.kind === 'flowElement') {
    return 'Flow element';
  }
  if (node.kind === 'callout') {
    return 'Callout';
  }
  return fallback;
}

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (first) => first.toUpperCase());
}

function durationMs(startNs: number, endNs: number): number {
  return Math.max(0, Math.round(((endNs - startNs) / 1_000_000) * 100) / 100);
}

function formatMs(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }
  return `${value.toFixed(value < 10 ? 2 : 1)}ms`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function maxInspectorWidth(isLeftRailCollapsed: boolean, leftWidth: number): number {
  if (typeof window === 'undefined') {
    return 560;
  }
  const leftBudget = isLeftRailCollapsed ? 0 : leftWidth;
  const resizeHandleBudget = (isLeftRailCollapsed ? 0 : 7) + 7;
  const graphSafeMax = window.innerWidth - leftBudget - resizeHandleBudget - GRAPH_STAGE_MIN_WIDTH;
  const halfScreen = Math.floor(window.innerWidth * RIGHT_PANEL_MAX_SCREEN_SHARE);
  return Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(halfScreen, graphSafeMax));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export default App;

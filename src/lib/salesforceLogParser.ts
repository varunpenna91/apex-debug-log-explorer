import type { DebugMessage, ExceptionDetail, FlowDecisionTrace, Hotspot, LogSummary, NodeKind, NoiseGroup, ParseResult, StoryNode } from './types';

const LOG_LINE_PATTERN = /^(\d{2}:\d{2}:\d{2}\.\d+)\s+\((\d+)\)\|([^|]*)(?:\|(.*))?$/;

const NOISY_EVENTS = new Set([
  'METHOD_ENTRY',
  'METHOD_EXIT',
  'CONSTRUCTOR_ENTRY',
  'CONSTRUCTOR_EXIT',
  'SYSTEM_METHOD_ENTRY',
  'SYSTEM_METHOD_EXIT',
  'SYSTEM_CONSTRUCTOR_ENTRY',
  'SYSTEM_CONSTRUCTOR_EXIT',
  'STATEMENT_EXECUTE',
  'HEAP_ALLOCATE',
  'VARIABLE_ASSIGNMENT',
  'VARIABLE_SCOPE_BEGIN',
  'VARIABLE_SCOPE_END',
  'STATIC_VARIABLE_LIST',
  'SYSTEM_MODE_ENTER',
  'SYSTEM_MODE_EXIT'
]);

const LIMIT_LABELS: Record<string, string> = {
  'SOQL queries': 'soqlQueries',
  'Number of SOQL queries': 'soqlQueries',
  'SOQL query rows': 'soqlRows',
  'Number of query rows': 'soqlRows',
  'DML statements': 'dmlStatements',
  'Number of DML statements': 'dmlStatements',
  'DML rows': 'dmlRows',
  'Number of DML rows': 'dmlRows',
  'CPU time in ms': 'cpuMs',
  'Maximum CPU time': 'cpuMs',
  'Heap size in bytes': 'heapBytes',
  'Maximum heap size': 'heapBytes',
  Callouts: 'callouts',
  'Number of callouts': 'callouts',
  'Email invocations': 'emailInvocations',
  'Number of Email Invocations': 'emailInvocations',
  'Future calls': 'futureCalls',
  'Number of future calls': 'futureCalls',
  'Jobs in queue': 'queuedJobs',
  'Number of queueable jobs added to the queue': 'queuedJobs',
  QUEUEABLE: 'queuedJobs',
  FUTURE: 'futureCalls',
  EMAIL: 'emailInvocations',
  MAX_ASYNC: 'maxAsync'
};

interface StackFrame {
  signature: string;
  line: number;
}

interface CodeUnitInfo {
  id: string;
  label: string;
  startLine: number;
  entryLimits: LimitSnapshot;
}

interface PendingSoql {
  id: string;
  queryObject: string;
  key: string;
  startNs: number;
}

interface PendingFlowRecordMutation {
  nodeId: string;
  interviewId?: string;
  parentId?: string;
  operation: 'insert' | 'update' | 'delete';
  startNs: number;
  objectName?: string;
}

interface PendingFlowCreate {
  parentId: string;
  groupId: number;
  lineNumber: number;
  ns: number;
  raw: string;
  orgId?: string;
  flowDefinitionId?: string;
  flowVersionId?: string;
}

interface AsyncApexDefinition {
  asyncType: string;
  label: string;
  subtitle: string;
  role: 'request' | 'transaction';
  transactionScope: 'separateApexTransaction' | 'currentApexTransaction';
  verb: string;
}

interface AsyncApexStackItem {
  id: string;
  signature: string;
}

interface EmailSendDefinition {
  emailType: string;
  label: string;
  subtitle: string;
  status: string;
}

interface EmailSendStackItem {
  id: string;
  signature: string;
}

interface CalloutStackItem {
  id: string;
  requestType: string;
}

interface CalloutInfo {
  label: string;
  subtitle: string;
  rawText?: string;
  sourceLine?: number;
  endpoint?: string;
  endpointRedacted?: string;
  endpointHost?: string;
  method?: string;
  status?: string;
  statusCode?: string;
  namedCredential?: string;
  namedCredentialId?: string;
  namedCredentialName?: string;
  externalCredentialType?: string;
  authorizationSummary?: string;
  contentType?: string;
  requestSizeBytes?: number;
  responseSizeBytes?: number;
  retryOn401?: string;
  overallCalloutTimeMs?: number;
  connectTimeMs?: number;
}

interface ValidationRuleContext {
  ruleId?: string;
  name: string;
  parentId: string;
  lineNumber: number;
}

interface DmlProfile {
  sourceLine: number;
  operation: string;
  objectName: string;
  signature: string;
}

interface SoqlProfile {
  sourceLine: number;
  objectName: string;
  signature: string;
  executionCount: number;
  durationMs: number;
  query: string;
}

interface DebugContext {
  signature: string;
  line: number;
  parentId: string;
  ns: number;
}

interface SourceContext {
  className: string;
  sourceLine: number;
  logLine: number;
  ns: number;
  parentId: string;
  evidence: string;
}

interface AttributionContext {
  bridge: string[];
  callerChain: string[];
  source: string;
  graphSource?: string;
  confidence: string;
  ownerSignature?: string;
  debugSignature?: string;
}

type LimitSnapshot = Record<string, number>;
type AddNode = (
  kind: NodeKind,
  label: string,
  line: number,
  startNs: number,
  parentId?: string,
  extras?: Partial<StoryNode>
) => StoryNode;

export function parseSalesforceLog(text: string): ParseResult {
  const rawLines = text.split(/\r?\n/);
  const dmlProfiles = buildDmlProfileIndex(rawLines);
  const soqlProfiles = buildSoqlProfileIndex(rawLines);
  const nodes: StoryNode[] = [];
  const nodeById = new Map<string, StoryNode>();
  const flowByInterview = new Map<string, string>();
  const flowElementByKey = new Map<string, string>();
  const lastFlowElementByParent = new Map<string, string>();
  const lastFlowElementByInterview = new Map<string, string>();
  const activeBulkDecisionByInterview = new Map<string, string>();
  const eventCounts = new Map<string, number>();
  const methodCounts = new Map<string, number>();
  const dmlByObject = new Map<string, number>();
  const soqlByObject = new Map<string, number>();
  const currentLimits: LimitSnapshot = {};
  const currentLimitCeilings: LimitSnapshot = {};
  const methodContextByKey = new Map<string, string>();
  const latestDebugContextByParent = new Map<string, DebugContext>();
  const recentDebugMessagesByParent = new Map<string, DebugMessage[]>();
  const recentSourceContexts: SourceContext[] = [];
  const soqlRepeatByKey = new Map<string, string>();
  const exceptionNodeByStackKey = new Map<string, string>();

  let sequence = 0;
  let firstNs: number | undefined;
  let lastNs = 0;
  let dmlCount = 0;
  let soqlCount = 0;
  let collapsedNoiseCount = 0;
  let recentExceptionFingerprint: { fingerprint: string; line: number } | undefined;

  const addNode = (
    kind: NodeKind,
    label: string,
    line: number,
    startNs: number,
    parentId?: string,
    extras: Partial<StoryNode> = {}
  ): StoryNode => {
    const id = `${kind}-${++sequence}`;
    const node: StoryNode = {
      id,
      kind,
      label,
      parentId,
      childIds: [],
      startNs,
      lineStart: line,
      lineEnd: line,
      metrics: {},
      warnings: [],
      ...extras
    };
    nodes.push(node);
    nodeById.set(id, node);
    if (parentId) {
      nodeById.get(parentId)?.childIds.push(id);
    }
    return node;
  };

  const addExceptionNode = (
    exception: ExceptionDetail,
    lineNumber: number,
    ns: number,
    parentId: string,
    callerChain: string[] = [],
    metrics: Record<string, string | number | boolean> = {}
  ): StoryNode | undefined => {
    const fingerprint = `${exception.exceptionType}|${exception.message}|${parentId}`;
    if (recentExceptionFingerprint?.fingerprint === fingerprint && lineNumber - recentExceptionFingerprint.line <= 80) {
      return undefined;
    }
    const stack = exception.stack ?? [];
    const node = addNode('exception', exception.exceptionType, lineNumber, ns, parentId, {
      subtitle: compactExceptionMessage(exception.message),
      detail: exception.raw,
      metrics: {
        ...metrics,
        eventType: exception.eventType,
        exceptionType: exception.exceptionType,
        errorCategory: classifyExceptionCategory(exception.eventType, exception.exceptionType, exception.message),
        ...optionalErrorCodeMetric(exception.message),
        ...(stack.length === 0 ? {} : { stackFrames: stack.length }),
        ...(exception.apexLine === undefined ? {} : { apexLine: exception.apexLine })
      },
      exception,
      callerChain: uniqueStrings(callerChain)
    });
    closeNode(node, ns, lineNumber);
    extendMethodAncestors(node, ns, lineNumber, nodeById);
    recentExceptionFingerprint = { fingerprint, line: lineNumber };
    return node;
  };

  const root = addNode('root', 'Salesforce Transaction', 1, 0, undefined, {
    subtitle: 'Local debug log analysis',
    detail: 'Upload a Salesforce Apex debug log to inspect the execution path.'
  });

  const codeUnitStack: CodeUnitInfo[] = [{ id: root.id, label: root.label, startLine: 1, entryLimits: { ...currentLimits } }];
  const skippedCodeUnitFinishDepths: number[] = [];
  const methodStack: StackFrame[] = [];
  const dmlStack: string[] = [];
  const asyncApexStack: AsyncApexStackItem[] = [];
  const emailSendStack: EmailSendStackItem[] = [];
  const calloutStack: CalloutStackItem[] = [];
  let pendingSoql: PendingSoql | undefined;
  let pendingApexActionWrapper: { className: string; methodName: string; lineNumber: number; rawName: string } | undefined;
  const pendingFlowCreates: PendingFlowCreate[] = [];
  const flowInterviewGroupByKey = new Map<string, string>();
  let flowCreateGroupSequence = 0;
  let activeFlowCreateGroupId = 0;
  let pendingFlowRecordMutation: PendingFlowRecordMutation | undefined;
  let latestEmailNodeId: string | undefined;
  let latestValidationRule: ValidationRuleContext | undefined;
  let latestWorkflowFlowErrorId: string | undefined;

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];
    const lineNumber = index + 1;
    const match = LOG_LINE_PATTERN.exec(line);
    if (!match) {
      continue;
    }

    const ns = Number(match[2]);
    const eventType = match[3];
    const fields = match[4] ? match[4].split('|') : [];

    if (firstNs === undefined) {
      firstNs = ns;
      root.startNs = ns;
    }
    lastNs = Math.max(lastNs, ns);
    eventCounts.set(eventType, (eventCounts.get(eventType) ?? 0) + 1);
    if (NOISY_EVENTS.has(eventType)) {
      collapsedNoiseCount += 1;
    }

    switch (eventType) {
      case 'CODE_UNIT_STARTED': {
        const rawName = pickCodeUnitName(fields);
        if (shouldCollapseSystemCodeUnit(rawName)) {
          skippedCodeUnitFinishDepths.push(codeUnitStack.length);
          break;
        }
        const apexActionWrapper = parseApexActionName(rawName);
        if (apexActionWrapper && shouldSkipApexActionWrapper(rawName, rawLines, index)) {
          pendingApexActionWrapper = {
            ...apexActionWrapper,
            lineNumber,
            rawName
          };
          skippedCodeUnitFinishDepths.push(codeUnitStack.length);
          break;
        }
        const codeUnitParentId = currentCodeUnitId(codeUnitStack);
        const classified = classifyCodeUnit(rawName, codeUnitParentId === root.id);
        const activeDmlNode = nodeById.get(dmlStack[dmlStack.length - 1] ?? '');
        const defaultParentId = activeDmlNode?.id ?? codeUnitParentId;
        const canUseFlowMutationParent =
          !pendingFlowRecordMutation || !activeDmlNode || activeDmlNode.startNs > pendingFlowRecordMutation.startNs;
        const mutationParentId = canUseFlowMutationParent
          ? flowRecordMutationParentId(classified, pendingFlowRecordMutation, codeUnitParentId)
          : codeUnitParentId;
        const runtimeParentId = mutationParentId !== codeUnitParentId ? mutationParentId : defaultParentId;
        const parentId = bridgeNestedCodeUnitParent(
          runtimeParentId,
          codeUnitParentId,
          activeDmlNode,
          methodStack,
          lineNumber,
          ns,
          addNode,
          nodeById,
          methodContextByKey
        );
        const metrics = { ...classified.metrics };
        let subtitle = classified.subtitle;
        if (pendingApexActionWrapper && rawName.startsWith(`${pendingApexActionWrapper.className}.${pendingApexActionWrapper.methodName}(`)) {
          metrics.apexAction = 'true';
          metrics.actionClass = pendingApexActionWrapper.className;
          metrics.actionMethod = pendingApexActionWrapper.methodName;
          metrics.actionName = `${pendingApexActionWrapper.className}.${pendingApexActionWrapper.methodName}`;
          metrics.actionLine = String(pendingApexActionWrapper.lineNumber);
          metrics.actionWrapper = pendingApexActionWrapper.rawName;
          subtitle = 'Apex action';
          pendingApexActionWrapper = undefined;
        } else if (pendingApexActionWrapper && lineNumber - pendingApexActionWrapper.lineNumber > 12) {
          pendingApexActionWrapper = undefined;
        }
        const node = addNode(classified.kind, classified.label, lineNumber, ns, parentId, {
          subtitle,
          detail: rawName,
          metrics
        });
        if (parentId === pendingFlowRecordMutation?.nodeId && typeof classified.metrics.objectName === 'string') {
          pendingFlowRecordMutation.objectName = classified.metrics.objectName;
        }
        codeUnitStack.push({ id: node.id, label: node.label, startLine: lineNumber, entryLimits: { ...currentLimits } });
        break;
      }
      case 'CODE_UNIT_FINISHED': {
        if (skippedCodeUnitFinishDepths.at(-1) === codeUnitStack.length) {
          skippedCodeUnitFinishDepths.pop();
          break;
        }
        const finished = codeUnitStack.pop();
        if (finished && finished.id !== root.id) {
          const node = nodeById.get(finished.id);
          closeNode(node, ns, lineNumber);
          extendMethodAncestors(node, ns, lineNumber, nodeById);
          attachLimitDeltas(node, finished.entryLimits, currentLimits, currentLimitCeilings);
        }
        if (codeUnitStack.length === 0) {
          codeUnitStack.push({ id: root.id, label: root.label, startLine: 1, entryLimits: { ...currentLimits } });
        }
        break;
      }
      case 'METHOD_ENTRY':
      case 'CONSTRUCTOR_ENTRY': {
        const signature = normalizeSignature(fields, eventType);
        methodStack.push({ signature, line: lineNumber });
        if (isMeaningfulMethod(signature)) {
          methodCounts.set(signature, (methodCounts.get(signature) ?? 0) + 1);
        }
        break;
      }
      case 'METHOD_EXIT':
      case 'CONSTRUCTOR_EXIT': {
        if (methodStack.length > 0) {
          methodStack.pop();
        }
        break;
      }
      case 'SYSTEM_METHOD_ENTRY': {
        const signature = systemMethodSignature(fields);
        const sourceLine = readSourceLine(fields);
        trackSystemSourceContext(recentSourceContexts, signature, sourceLine, currentCodeUnitId(codeUnitStack), lineNumber, ns);
        const emailSend = classifySystemEmailSend(signature);
        if (emailSend) {
          const caller = ensureCallerPath(methodStack, codeUnitStack);
          const sourceContext = findEmailSourceContext(recentSourceContexts, caller.parentId, sourceLine, ns, lineNumber);
          const contextChain = buildEmailContextChain(caller.chain, sourceContext, sourceLine);
          const parentId = ensureMethodContextPath(
            caller.parentId,
            contextChain.bridge,
            lineNumber,
            ns,
            contextChain.source,
            addNode,
            nodeById,
            methodContextByKey
          );
          const node = addNode('email', emailSend.label, lineNumber, ns, parentId, {
            subtitle: emailSend.subtitle,
            detail: signature,
            metrics: {
              emailType: emailSend.emailType,
              emailStatus: emailSend.status,
              emailApi: emailApiName(signature),
              systemMethod: signature,
              attribution: contextChain.source,
              attributionConfidence: contextChain.confidence,
              ...(contextChain.ownerSignature ? { ownerSignature: contextChain.ownerSignature } : {}),
              ...(sourceContext ? { sourceClass: sourceContext.className, sourceEvidence: sourceContext.evidence } : {}),
              ...(sourceLine === undefined ? {} : { sourceLine })
            },
            callerChain: contextChain.callerChain
          });
          emailSendStack.push({ id: node.id, signature });
          latestEmailNodeId = node.id;
          break;
        }

        const asyncApexRequest = classifySystemAsyncApexRequest(signature);
        if (!asyncApexRequest) {
          break;
        }
        const caller = ensureCallerPath(methodStack, codeUnitStack);
        const bridge = selectBusinessMethodBridge(caller.chain);
        const parentId = ensureMethodContextPath(
          caller.parentId,
          bridge,
          lineNumber,
          ns,
          'Apex caller stack',
          addNode,
          nodeById,
          methodContextByKey
        );
        const node = addNode('async', asyncApexRequest.label, lineNumber, ns, parentId, {
          subtitle: asyncApexRequest.subtitle,
          detail: signature,
          metrics: {
            asyncType: asyncApexRequest.asyncType,
            asyncRole: asyncApexRequest.role,
            asyncTransactionScope: asyncApexRequest.transactionScope,
            requestVerb: asyncApexRequest.verb,
            systemMethod: signature,
            attribution: bridge.length > 0 ? 'Apex caller stack' : 'Code unit context',
            attributionConfidence: bridge.length > 0 ? 'low' : 'unknown',
            ...(sourceLine === undefined ? {} : { sourceLine })
          },
          callerChain: uniqueStrings([...caller.chain, ...bridge])
        });
        asyncApexStack.push({ id: node.id, signature });
        break;
      }
      case 'SYSTEM_METHOD_EXIT': {
        const signature = systemMethodSignature(fields);
        const emailStackIndex = findLastIndex(emailSendStack, (item) => item.signature === signature);
        if (emailStackIndex >= 0) {
          const [emailSend] = emailSendStack.splice(emailStackIndex, 1);
          const node = nodeById.get(emailSend.id);
          closeNode(node, ns, lineNumber);
          extendMethodAncestors(node, ns, lineNumber, nodeById);
          latestEmailNodeId = emailSend.id;
          break;
        }

        const stackIndex = findLastIndex(asyncApexStack, (item) => item.signature === signature);
        if (stackIndex >= 0) {
          const [request] = asyncApexStack.splice(stackIndex, 1);
          const node = nodeById.get(request.id);
          closeNode(node, ns, lineNumber);
          extendMethodAncestors(node, ns, lineNumber, nodeById);
        }
        break;
      }
      case 'WF_EMAIL_SENT': {
        const email = parseWorkflowEmailSent(fields);
        const flowActionNode = findRecentFlowActionCallNode(nodeById, lineNumber);
        if (flowActionNode) {
          markFlowActionAsEmail(flowActionNode, 'sent');
          flowActionNode.metrics.emailStatus = 'sent';
          if (email.reference) {
            flowActionNode.metrics.reference = email.reference;
          }
          if (email.recipients) {
            flowActionNode.metrics.recipients = email.recipients;
          }
          if (email.ccEmails) {
            flowActionNode.metrics.ccEmails = email.ccEmails;
          }
          flowActionNode.detail = flowActionNode.detail ? `${flowActionNode.detail}\n${fields.join('|')}` : fields.join('|');
          flowActionNode.lineEnd = Math.max(flowActionNode.lineEnd, lineNumber);
          latestEmailNodeId = flowActionNode.id;
          break;
        }

        const parentId = currentCodeUnitId(codeUnitStack);
        const node = addNode('email', 'Workflow Email Sent', lineNumber, ns, parentId, {
          subtitle: email.reference ?? 'Workflow email alert',
          detail: fields.join('|'),
          metrics: {
            emailType: 'Workflow Email Alert',
            emailStatus: 'sent',
            ...(email.reference ? { reference: email.reference } : {}),
            ...(email.recipients ? { recipients: email.recipients } : {}),
            ...(email.ccEmails ? { ccEmails: email.ccEmails } : {})
          }
        });
        closeNode(node, ns, lineNumber);
        latestEmailNodeId = node.id;
        break;
      }
      case 'EMAIL_QUEUE': {
        const activeEmailId = emailSendStack.at(-1)?.id ?? latestEmailNodeId;
        const node = activeEmailId ? nodeById.get(activeEmailId) : undefined;
        if (node?.kind === 'email') {
          const queueText = fields.join('|');
          const subject = readEmbeddedEmailQueueValue(queueText, 'subject');
          const toAddresses = readEmbeddedEmailQueueValue(queueText, 'toAddresses');
          const templateId = readEmbeddedEmailQueueValue(queueText, 'templateId');
          const targetObjectId = readEmbeddedEmailQueueValue(queueText, 'targetObjectId');
          const whatId = readEmbeddedEmailQueueValue(queueText, 'whatId');
          node.metrics.emailStatus = 'queued';
          if (subject) {
            node.metrics.subject = subject;
          }
          if (toAddresses) {
            node.metrics.toAddresses = toAddresses;
          }
          if (templateId) {
            node.metrics.templateId = templateId;
          }
          if (targetObjectId) {
            node.metrics.targetObjectId = targetObjectId;
          }
          if (whatId) {
            node.metrics.whatId = whatId;
          }
          const recipientCount = toAddresses ? countEmailAddresses(toAddresses) : 0;
          if (recipientCount > 0) {
            node.metrics.recipientsQueued = Math.max(Number(node.metrics.recipientsQueued ?? 0), recipientCount);
          }
          node.detail = node.detail ? `${node.detail}\n${fields.join('|')}` : fields.join('|');
          node.lineEnd = Math.max(node.lineEnd, lineNumber);
        }
        break;
      }
      case 'TOTAL_EMAIL_RECIPIENTS_QUEUED': {
        const recipientsQueued = Number(fields[0] ?? 0);
        if (!Number.isFinite(recipientsQueued)) {
          break;
        }
        const activeStackEmailId = emailSendStack.at(-1)?.id;
        const activeEmailId = activeStackEmailId ?? latestEmailNodeId;
        const node = activeEmailId ? nodeById.get(activeEmailId) : undefined;
        if (node?.kind === 'email' && (activeStackEmailId || lineNumber - node.lineEnd <= 12)) {
          node.metrics.recipientsQueued = recipientsQueued;
          node.lineEnd = Math.max(node.lineEnd, lineNumber);
        }
        break;
      }
      case 'CALLOUT_REQUEST':
      case 'NAMED_CREDENTIAL_REQUEST': {
        const callout = parseCalloutRequest(eventType, fields);
        if (eventType === 'NAMED_CREDENTIAL_REQUEST') {
          const activeStackItem = calloutStack.at(-1);
          const activeNode = activeStackItem ? nodeById.get(activeStackItem.id) : undefined;
          if (activeStackItem?.requestType === 'CALLOUT_REQUEST' && activeNode?.kind === 'callout') {
            mergeCalloutRequestNode(activeNode, callout, eventType, fields, lineNumber);
            activeNode.lineEnd = Math.max(activeNode.lineEnd, lineNumber);
            break;
          }
        }
        const caller = ensureCallerPath(methodStack, codeUnitStack);
        const bridge = selectBusinessMethodBridge(caller.chain);
        const parentId = ensureMethodContextPath(
          caller.parentId,
          bridge,
          lineNumber,
          ns,
          'Apex caller stack',
          addNode,
          nodeById,
          methodContextByKey
        );
        const node = addNode('callout', callout.label, lineNumber, ns, parentId, {
          subtitle: callout.subtitle,
          detail: `${eventType}|${fields.join('|')}`,
          metrics: {
            calloutType: eventType,
            calloutStatus: 'request',
            ...calloutRequestMetrics(callout, eventType, lineNumber),
            attribution: bridge.length > 0 ? 'Apex caller stack' : 'Code unit context',
            attributionConfidence: bridge.length > 0 ? 'low' : 'unknown'
          },
          callerChain: uniqueStrings([...caller.chain, ...bridge])
        });
        calloutStack.push({ id: node.id, requestType: eventType });
        break;
      }
      case 'CALLOUT_RESPONSE':
      case 'NAMED_CREDENTIAL_RESPONSE': {
        const response = parseCalloutResponse(eventType, fields);
        const stackIndex = findLastIndex(calloutStack, () => true);
        const stackItem = stackIndex >= 0 ? calloutStack.splice(stackIndex, 1)[0] : undefined;
        const node = stackItem ? nodeById.get(stackItem.id) : undefined;
        if (node?.kind === 'callout') {
          mergeCalloutResponseNode(node, response, stackItem?.requestType ?? eventType, eventType, fields, lineNumber);
          if (eventType === 'NAMED_CREDENTIAL_RESPONSE' && stackItem?.requestType === 'CALLOUT_REQUEST') {
            calloutStack.push(stackItem);
          } else {
            closeNode(node, ns, lineNumber);
            extendMethodAncestors(node, ns, lineNumber, nodeById);
          }
          break;
        }

        const caller = ensureCallerPath(methodStack, codeUnitStack);
        const parentId = currentCodeUnitId(codeUnitStack);
        const fallback = addNode('callout', response.label, lineNumber, ns, parentId, {
          subtitle: response.subtitle,
          detail: `${eventType}|${fields.join('|')}`,
          metrics: {
            calloutType: eventType,
            calloutStatus: 'response',
            ...calloutResponseMetrics(response, eventType, lineNumber)
          },
          callerChain: caller.chain
        });
        closeNode(fallback, ns, lineNumber);
        break;
      }
      case 'DML_BEGIN': {
        const dml = parseDml(fields);
        dmlCount += 1;
        dmlByObject.set(dml.objectName, (dmlByObject.get(dml.objectName) ?? 0) + 1);
        const caller = ensureCallerPath(methodStack, codeUnitStack);
        const profile = findDmlProfile(dmlProfiles, dml.sourceLine, dml.operation, dml.objectName);
        const debugContext = latestDebugContextByParent.get(caller.parentId);
        const contextChain = buildDmlContextChain(caller.chain, profile, debugContext, lineNumber, ns);
        const debugTrail = collectRecentDebugTrail(
          recentDebugMessagesByParent.get(caller.parentId) ?? [],
          contextChain.ownerSignature,
          lineNumber
        );
        const debugSignature =
          contextChain.debugSignature ??
          inferDebugAttributionSignature(recentDebugMessagesByParent.get(caller.parentId) ?? [], contextChain.ownerSignature, lineNumber);
        const label = `${dml.operation} ${dml.objectName}`;
        const sourceAttributionPath = buildSourceAttributionPath({
          parent: nodeById.get(caller.parentId),
          callerBridge: contextChain.bridge,
          ownerSignature: contextChain.ownerSignature,
          debugSignature,
          eventLabel: label
        });
        const sourceBridge = sourceContextBridgeFromAttributionPath(
          sourceAttributionPath,
          nodeById.get(caller.parentId),
          label
        );
        const graphBridge = sourceBridge.length > 0 ? sourceBridge : contextChain.bridge;
        const parentId = ensureMethodContextPath(
          caller.parentId,
          graphBridge,
          lineNumber,
          ns,
          contextChain.graphSource ??
          (graphBridge.length > 0 && contextChain.source !== 'Apex caller stack'
            ? `${contextChain.source} source context`
            : contextChain.source),
          addNode,
          nodeById,
          methodContextByKey
        );
        const node = addNode('dml', label, lineNumber, ns, parentId, {
          subtitle: `${dml.rows} ${dml.rows === 1 ? 'row' : 'rows'}`,
          detail: fields.join('|'),
          metrics: {
            operation: dml.operation,
            objectName: dml.objectName,
            rows: dml.rows,
            attribution: contextChain.source,
            attributionConfidence: contextChain.confidence,
            ...(contextChain.ownerSignature ? { ownerSignature: contextChain.ownerSignature } : {}),
            ...(debugSignature ? { debugSignature } : {}),
            ...(sourceAttributionPath.length > 0
              ? {
                  sourceAttributionPath: sourceAttributionPath.join('|'),
                  sourceAttributionConfidence: 'runtime + debug/profile evidence'
                }
              : {}),
            ...(dml.sourceLine === undefined ? {} : { sourceLine: dml.sourceLine })
          },
          ...(debugTrail.length > 0 ? { debugMessages: debugTrail } : {}),
          callerChain: uniqueStrings([...contextChain.callerChain, ...graphBridge])
        });
        dmlStack.push(node.id);
        break;
      }
      case 'DML_END': {
        const dmlId = dmlStack.pop();
        if (dmlId) {
          const dmlNode = nodeById.get(dmlId);
          closeNode(dmlNode, ns, lineNumber);
          extendMethodAncestors(dmlNode, ns, lineNumber, nodeById);
        }
        break;
      }
      case 'SOQL_EXECUTE_BEGIN': {
        const soql = parseSoql(fields);
        soqlCount += 1;
        soqlByObject.set(soql.objectName, (soqlByObject.get(soql.objectName) ?? 0) + 1);
        const caller = ensureCallerPath(methodStack, codeUnitStack);
        const profile = findSoqlProfile(soqlProfiles, soql.sourceLine, soql.objectName, soql.query);
        const contextChain = buildSoqlContextChain(caller.chain, profile);
        const debugTrail = collectRecentDebugTrail(
          recentDebugMessagesByParent.get(caller.parentId) ?? [],
          contextChain.ownerSignature,
          lineNumber
        );
        const debugSignature = inferDebugAttributionSignature(
          recentDebugMessagesByParent.get(caller.parentId) ?? [],
          contextChain.ownerSignature,
          lineNumber
        );
        const label = `Query ${soql.objectName}`;
        const sourceAttributionPath = buildSourceAttributionPath({
          parent: nodeById.get(caller.parentId),
          callerBridge: contextChain.bridge,
          ownerSignature: contextChain.ownerSignature,
          debugSignature,
          eventLabel: label
        });
        const sourceBridge = sourceContextBridgeFromAttributionPath(
          sourceAttributionPath,
          nodeById.get(caller.parentId),
          label
        );
        const graphBridge = sourceBridge.length > 0 ? sourceBridge : contextChain.bridge;
        const parentId = ensureMethodContextPath(
          caller.parentId,
          graphBridge,
          lineNumber,
          ns,
          contextChain.graphSource ??
          (graphBridge.length > 0 && contextChain.source !== 'Apex caller stack'
            ? `${contextChain.source} source context`
            : contextChain.source),
          addNode,
          nodeById,
          methodContextByKey
        );
        const soqlKey = soqlRepeatKey(parentId, uniqueStrings([...contextChain.callerChain, ...graphBridge]), soql.query);
        const repeatedNode = nodeById.get(soqlRepeatByKey.get(soqlKey) ?? '');
        if (repeatedNode?.kind === 'soql') {
          repeatedNode.loopMultiplier = (repeatedNode.loopMultiplier ?? 1) + 1;
          repeatedNode.metrics.loopMultiplier = repeatedNode.loopMultiplier;
          repeatedNode.metrics.executionCount = repeatedNode.loopMultiplier;
          if (profile) {
            repeatedNode.metrics.profileExecutionCount = Math.max(
              Number(repeatedNode.metrics.profileExecutionCount ?? 0),
              profile.executionCount
            );
            repeatedNode.metrics.profileDurationMs = Math.max(
              Number(repeatedNode.metrics.profileDurationMs ?? 0),
              profile.durationMs
            );
          }
          repeatedNode.lineEnd = Math.max(repeatedNode.lineEnd, lineNumber);
          pendingSoql = { id: repeatedNode.id, queryObject: soql.objectName, key: soqlKey, startNs: ns };
          break;
        }
        const node = addNode('soql', label, lineNumber, ns, parentId, {
          subtitle: `${soql.fieldCount} selected ${soql.fieldCount === 1 ? 'field' : 'fields'}`,
          detail: soql.query,
          metrics: {
            objectName: soql.objectName,
            fieldCount: soql.fieldCount,
            aggregations: soql.aggregations,
            executionCount: 1,
            attribution: contextChain.source,
            attributionConfidence: contextChain.confidence,
            ...(debugSignature ? { debugSignature } : {}),
            ...(sourceAttributionPath.length > 0
              ? {
                  sourceAttributionPath: sourceAttributionPath.join('|'),
                  sourceAttributionConfidence: 'runtime + debug/profile evidence'
                }
              : {}),
            ...(soql.sourceLine === undefined ? {} : { sourceLine: soql.sourceLine }),
            ...(profile
              ? {
                  ownerSignature: profile.signature,
                  profileExecutionCount: profile.executionCount,
                  profileDurationMs: profile.durationMs
                }
              : {})
          },
          ...(debugTrail.length > 0 ? { debugMessages: debugTrail } : {}),
          callerChain: uniqueStrings([...contextChain.callerChain, ...graphBridge])
        });
        soqlRepeatByKey.set(soqlKey, node.id);
        pendingSoql = { id: node.id, queryObject: soql.objectName, key: soqlKey, startNs: ns };
        break;
      }
      case 'SOQL_EXECUTE_EXPLAIN': {
        if (pendingSoql) {
          const node = nodeById.get(pendingSoql.id);
          if (node) {
            node.metrics.plan = compactPlan(fields.join('|'));
            node.lineEnd = lineNumber;
          }
        }
        break;
      }
      case 'SOQL_EXECUTE_END': {
        if (pendingSoql) {
          const node = nodeById.get(pendingSoql.id);
          if (node) {
            const rows = readNumericField(fields, 'Rows') ?? 0;
            node.metrics.rows = Number(node.metrics.rows ?? 0) + rows;
            node.metrics.totalDurationMs = Number(node.metrics.totalDurationMs ?? 0) + durationMs(pendingSoql.startNs, ns);
            closeNode(node, ns, lineNumber);
            extendMethodAncestors(node, ns, lineNumber, nodeById);
          }
          pendingSoql = undefined;
        }
        break;
      }
      case 'FLOW_CREATE_INTERVIEW_BEGIN': {
        activeFlowCreateGroupId = flowCreateGroupSequence + 1;
        flowCreateGroupSequence = activeFlowCreateGroupId;
        pendingFlowCreates.push({
          parentId: currentCodeUnitId(codeUnitStack),
          groupId: activeFlowCreateGroupId,
          lineNumber,
          ns,
          raw: fields.join('|'),
          orgId: fields[0],
          flowDefinitionId: fields[1],
          flowVersionId: fields[2]
        });
        break;
      }
      case 'FLOW_CREATE_INTERVIEW_END': {
        const interviewId = fields[0] ?? `flow-${lineNumber}`;
        const flowName = fields[1] ?? 'Flow interview';
        const create = pendingFlowCreates.shift();
        const parentId = create?.parentId ?? currentCodeUnitId(codeUnitStack);
        const groupKey = flowInterviewGroupKey(parentId, create?.groupId ?? activeFlowCreateGroupId, flowName);
        const existing = nodeById.get(flowInterviewGroupByKey.get(groupKey) ?? '');
        if (existing?.kind === 'flow') {
          const interviewCount = Number(existing.metrics.interviewCount ?? existing.loopMultiplier ?? 1) + 1;
          existing.loopMultiplier = interviewCount;
          existing.metrics.interviewCount = interviewCount;
          existing.metrics.interviewIds = appendDelimitedMetric(existing.metrics.interviewIds, interviewId);
          existing.detail = [existing.detail, `FLOW_CREATE_INTERVIEW_END|${fields.join('|')}`].filter(Boolean).join('\n');
          existing.lineEnd = Math.max(existing.lineEnd, lineNumber);
          existing.endNs = Math.max(existing.endNs ?? existing.startNs, ns);
          existing.durationMs = durationMs(existing.startNs, existing.endNs);
          flowByInterview.set(interviewId, existing.id);
          break;
        }
        const node = addNode('flow', flowName, create?.lineNumber ?? lineNumber, create?.ns ?? ns, parentId, {
          subtitle: 'Flow interview',
          detail: [
            create ? `FLOW_CREATE_INTERVIEW_BEGIN|${create.raw}` : '',
            `FLOW_CREATE_INTERVIEW_END|${fields.join('|')}`
          ].filter(Boolean).join('\n'),
          metrics: {
            interviewId,
            interviewCount: 1,
            interviewIds: interviewId,
            flowApiName: flowName,
            ...(create?.flowDefinitionId ? { flowDefinitionId: create.flowDefinitionId } : {}),
            ...(create?.flowVersionId ? { flowVersionId: create.flowVersionId } : {}),
            ...(create?.orgId ? { orgId: create.orgId } : {})
          }
        });
        node.lineEnd = Math.max(node.lineEnd, lineNumber);
        flowInterviewGroupByKey.set(groupKey, node.id);
        flowByInterview.set(interviewId, node.id);
        break;
      }
      case 'FLOW_START_INTERVIEW_BEGIN': {
        const interviewId = fields[0] ?? '';
        const flowName = fields[1] ?? '';
        const node = nodeById.get(flowByInterview.get(interviewId) ?? '');
        if (node && flowName) {
          node.metrics.flowApiName = flowName;
          node.lineEnd = Math.max(node.lineEnd, lineNumber);
        }
        break;
      }
      case 'FLOW_START_INTERVIEW_END': {
        const interviewId = fields[0] ?? '';
        const flowName = fields[1] ?? '';
        const node = nodeById.get(flowByInterview.get(interviewId) ?? '');
        if (node) {
          if (flowName) {
            node.metrics.flowApiName = flowName;
          }
          node.lineEnd = Math.max(node.lineEnd, lineNumber);
        }
        break;
      }
      case 'FLOW_ELEMENT_BEGIN': {
        const interviewId = fields[0] ?? '';
        const elementType = fields[1] ?? 'FlowElement';
        const apiName = fields[2] ?? 'Flow element';
        const parentId = flowByInterview.get(interviewId) ?? currentCodeUnitId(codeUnitStack);
        const previousElement = nodeById.get(lastFlowElementByInterview.get(interviewId) ?? '');
        const isEmailAction = isFlowEmailAction(elementType, apiName);
        const previousSibling = findRecentMatchingFlowElement(parentId, interviewId, elementType, apiName, nodeById);
        if (
          previousSibling && !isEmailAction
        ) {
          previousSibling.loopMultiplier = (previousSibling.loopMultiplier ?? 1) + 1;
          previousSibling.metrics.loopMultiplier = previousSibling.loopMultiplier;
          previousSibling.lineEnd = Math.max(previousSibling.lineEnd, lineNumber);
          linkDecisionToNextElement(previousElement, previousSibling, lineNumber);
          lastFlowElementByInterview.set(interviewId, previousSibling.id);
          flowElementByKey.set(flowElementKey(interviewId, elementType, apiName), previousSibling.id);
          break;
        }
        const node = addNode(isEmailAction ? 'email' : 'flowElement', isEmailAction ? 'Flow Email Action' : flowElementLabel(elementType, apiName), lineNumber, ns, parentId, {
          subtitle: isEmailAction ? apiName : flowElementSubtitle(elementType),
          detail: fields.join('|'),
          metrics: isEmailAction
            ? { interviewId, elementType, apiName, emailType: 'Flow Email Action', emailStatus: 'requested' }
            : { interviewId, elementType, apiName }
        });
        if (elementType === 'FlowDecision') {
          ensureFlowDecisionTrace(node, interviewId, apiName, lineNumber);
        } else {
          linkDecisionToNextElement(previousElement, node, lineNumber);
        }
        lastFlowElementByParent.set(parentId, node.id);
        lastFlowElementByInterview.set(interviewId, node.id);
        flowElementByKey.set(flowElementKey(interviewId, elementType, apiName), node.id);
        if (isEmailAction) {
          latestEmailNodeId = node.id;
        }
        break;
      }
      case 'FLOW_ELEMENT_DEFERRED': {
        const elementType = fields[0] ?? '';
        const apiName = fields[1] ?? '';
        const node = findLatestFlowElementNode(elementType, apiName, nodeById, lineNumber);
        if (node?.kind === 'flowElement' || node?.kind === 'email') {
          node.metrics.deferredByFlowRuntime = true;
          node.lineEnd = Math.max(node.lineEnd, lineNumber);
        }
        break;
      }
      case 'FLOW_RULE_DETAIL': {
        const interviewId = fields[0] ?? '';
        const outcomeApiName = fields[1] ?? '';
        const result = parseLogBoolean(fields[2]);
        const connectorMatched = parseLogBoolean(fields[3]);
        const node = nodeById.get(activeBulkDecisionByInterview.get(interviewId) ?? '') ?? findLatestFlowDecisionNode(interviewId, nodeById, lineNumber);
        if (node && outcomeApiName && result !== undefined) {
          appendFlowDecisionOutcome(node, outcomeApiName, result, connectorMatched, lineNumber);
        }
        break;
      }
      case 'FLOW_VALUE_ASSIGNMENT': {
        const interviewId = fields[0] ?? '';
        const variableName = fields[1] ?? '';
        const value = parseLogBoolean(fields[2]);
        const node = findLatestFlowDecisionNode(interviewId, nodeById, lineNumber);
        if (node && variableName && value !== undefined && node.flowDecision?.outcomes.some((outcome) => outcome.outcomeApiName === variableName)) {
          markFlowDecisionValueAssignment(node, variableName, value, lineNumber);
        }
        break;
      }
      case 'FLOW_ACTIONCALL_DETAIL': {
        const interviewId = fields[0] ?? '';
        const apiName = fields[1] ?? fields[0] ?? '';
        const node = nodeById.get(flowElementByKey.get(flowElementKey(interviewId, 'FlowActionCall', apiName)) ?? '');
        const actionFailure = parseFlowActionCallFailure(fields);
        if (node && actionFailure) {
          const exception = buildLogException(
            'FLOW_ACTIONCALL_DETAIL',
            inferExceptionType(actionFailure.message, 'Flow Action Error'),
            actionFailure.message,
            fields.join('|')
          );
          addExceptionNode(exception, lineNumber, ns, node.id, [apiName], {
            flowActionApiName: apiName,
            flowActionLabel: fields[2] ?? 'Flow action'
          });
        }
        if (node && isFlowSendEmailActionDetail(fields)) {
          markFlowActionAsEmail(node, String(node.metrics.emailStatus ?? 'requested'));
          node.metrics.emailStatus = node.metrics.emailStatus === 'sent' ? 'sent' : 'requested';
          node.metrics.emailAction = fields[2] ?? 'Send Email';
          if (fields[3]) {
            node.metrics.emailActionName = fields[3];
          }
          latestEmailNodeId = node.id;
        }
        if (node?.kind === 'email') {
          node.metrics.flowActionDetail = fields.join('|');
          node.lineEnd = Math.max(node.lineEnd, lineNumber);
        }
        break;
      }
      case 'FLOW_ELEMENT_ERROR': {
        const message = cleanLogMessage(fields[0] ?? 'Flow element error');
        const elementType = fields[1] ?? 'FlowElement';
        const apiName = fields[2] ?? 'Flow element';
        const nodeId = [...flowElementByKey.entries()].find(([key]) => key.endsWith(`|${elementType}|${apiName}`))?.[1];
        const parentId = nodeId ?? currentAnalysisNodeId(flowByInterview, codeUnitStack);
        const exception = buildLogException(
          eventType,
          inferExceptionType(message, 'Flow Element Error'),
          message,
          fields.join('|')
        );
        addExceptionNode(exception, lineNumber, ns, parentId, [apiName], {
          flowElementType: elementType,
          flowElementApiName: apiName
        });
        break;
      }
      case 'FLOW_START_INTERVIEWS_ERROR': {
        const message = cleanLogMessage(fields[0] ?? 'Flow interview error');
        const interviewId = fields[1] ?? '';
        const flowName = fields[2] ?? '';
        const parentId = flowByInterview.get(interviewId) ?? currentAnalysisNodeId(flowByInterview, codeUnitStack);
        const exception = buildLogException(
          eventType,
          inferExceptionType(message, 'Flow Interview Error'),
          message,
          fields.join('|')
        );
        addExceptionNode(exception, lineNumber, ns, parentId, flowName ? [flowName] : [], {
          ...(interviewId ? { interviewId } : {}),
          ...(flowName ? { flowApiName: flowName } : {})
        });
        break;
      }
      case 'WF_FLOW_ACTION_ERROR': {
        const message = cleanLogMessage(fields.slice(2).join('|') || fields.join('|') || 'Workflow flow action error');
        const exception = buildLogException(
          eventType,
          inferExceptionType(message, 'Workflow Flow Action Error'),
          message,
          fields.join('|')
        );
        const node = addExceptionNode(exception, lineNumber, ns, currentCodeUnitId(codeUnitStack), [], {
          ...(fields[0] ? { workflowActionId: fields[0] } : {}),
          ...(fields[1] ? { flowDefinitionId: fields[1] } : {})
        });
        latestWorkflowFlowErrorId = node?.id;
        break;
      }
      case 'WF_FLOW_ACTION_ERROR_DETAIL': {
        const node = latestWorkflowFlowErrorId ? nodeById.get(latestWorkflowFlowErrorId) : undefined;
        if (node?.kind === 'exception') {
          const detail = cleanLogMessage(fields.join('|'));
          node.exception = node.exception
            ? { ...node.exception, message: `${node.exception.message} ${detail}`.trim(), raw: `${node.exception.raw}\n${fields.join('|')}` }
            : node.exception;
          node.subtitle = compactExceptionMessage(node.exception?.message ?? detail);
          node.detail = `${node.detail ?? ''}\n${fields.join('|')}`.trim();
          node.lineEnd = Math.max(node.lineEnd, lineNumber);
        }
        break;
      }
      case 'FLOW_BULK_ELEMENT_BEGIN': {
        const elementType = fields[0] ?? '';
        const apiName = fields[1] ?? '';
        const node = findLatestFlowElementNode(elementType, apiName, nodeById, lineNumber);
        if (node) {
          if (elementType === 'FlowDecision') {
            const interviewId = String(node.metrics.interviewId ?? '');
            if (interviewId) {
              activeBulkDecisionByInterview.set(interviewId, node.id);
            }
          }
          const operation = flowRecordMutationOperation(elementType);
          if (operation) {
            pendingFlowRecordMutation = {
              nodeId: node.id,
              interviewId: String(node.metrics.interviewId ?? '') || undefined,
              parentId: node.parentId,
              operation,
              startNs: ns
            };
          }
        }
        break;
      }
      case 'FLOW_BULK_ELEMENT_END': {
        const elementType = fields[0] ?? '';
        const apiName = fields[1] ?? '';
        const node = findLatestFlowElementNode(elementType, apiName, nodeById, lineNumber);
        if (node) {
          node.metrics.bulkResult = `${fields[2] ?? 0}/${fields[3] ?? 0}`;
          closeNode(node, ns, lineNumber);
          if (elementType === 'FlowDecision') {
            const interviewId = String(node.metrics.interviewId ?? '');
            if (interviewId) {
              activeBulkDecisionByInterview.delete(interviewId);
            }
          }
        }
        break;
      }
      case 'FLOW_ELEMENT_END': {
        const interviewId = fields[0] ?? '';
        const elementType = fields[1] ?? '';
        const apiName = fields[2] ?? '';
        const node = nodeById.get(flowElementByKey.get(flowElementKey(interviewId, elementType, apiName)) ?? '');
        closeNode(node, ns, lineNumber);
        break;
      }
      case 'FLOW_INTERVIEW_FINISHED': {
        const interviewId = fields[0] ?? '';
        const flowName = fields[1] ?? '';
        const node = nodeById.get(flowByInterview.get(interviewId) ?? '');
        if (node && flowName) {
          node.metrics.flowApiName = flowName;
        }
        closeNode(node, ns, lineNumber);
        if (pendingFlowRecordMutation?.interviewId === interviewId) {
          pendingFlowRecordMutation = undefined;
        }
        break;
      }
      case 'FLOW_INTERVIEW_FINISHED_LIMIT_USAGE':
      case 'FLOW_START_INTERVIEW_LIMIT_USAGE':
      case 'FLOW_ELEMENT_LIMIT_USAGE':
      case 'FLOW_BULK_ELEMENT_LIMIT_USAGE': {
        updateFlowLimitMetrics(eventType, line, fields, currentAnalysisNodeId(flowByInterview, codeUnitStack), nodeById, lineNumber);
        break;
      }
      case 'LIMIT_USAGE': {
        const parsedLimit = parseLimitUsage(line, fields);
        updateLimitState(line, fields, currentLimits, currentLimitCeilings, currentAnalysisNodeId(flowByInterview, codeUnitStack), nodeById, lineNumber);
        attachAsyncLimitUsage(parsedLimit, asyncApexStack.at(-1), nodeById, lineNumber);
        break;
      }
      case 'VALIDATION_RULE': {
        latestValidationRule = {
          ruleId: fields[0],
          name: fields[1] ?? 'Validation rule',
          parentId: currentCodeUnitId(codeUnitStack),
          lineNumber
        };
        break;
      }
      case 'VALIDATION_PASS': {
        latestValidationRule = undefined;
        break;
      }
      case 'VALIDATION_FAIL': {
        const validation = latestValidationRule;
        const ruleName = validation?.name ?? 'Validation rule';
        const message = `${ruleName} failed during record validation.`;
        const exception = buildLogException(
          eventType,
          'Validation Rule Failed',
          message,
          line || fields.join('|')
        );
        addExceptionNode(exception, lineNumber, ns, validation?.parentId ?? currentCodeUnitId(codeUnitStack), ruleName ? [ruleName] : [], {
          ...(validation?.ruleId ? { validationRuleId: validation.ruleId } : {}),
          validationRuleName: ruleName,
          ...(validation?.lineNumber ? { validationRuleLine: validation.lineNumber } : {})
        });
        latestValidationRule = undefined;
        break;
      }
      case 'EXCEPTION_THROWN':
      case 'FATAL_ERROR': {
        const exceptionStack = collectExceptionStack(rawLines, index);
        const exception = parseException(fields, eventType, line, exceptionStack);
        const stackKey = exceptionStackFingerprint(exception);
        const existingException = stackKey ? nodeById.get(exceptionNodeByStackKey.get(stackKey) ?? '') : undefined;
        if (existingException?.kind === 'exception') {
          mergeRepeatedExceptionNode(existingException, exception, lineNumber, ns);
          if (pendingSoqlBelongsToException(pendingSoql, exception.apexLine, nodeById)) {
            pendingSoql = undefined;
          }
          break;
        }

        const caller = ensureCallerPath(methodStack, codeUnitStack);
        const stackBridge = selectBusinessMethodBridge([...exceptionStack].reverse());
        const activeBridge = selectBusinessMethodBridge(caller.chain);
        const exceptionBridge = stackBridge.length > 0 ? uniqueBusinessSignatures([...activeBridge, ...stackBridge]) : activeBridge;
        const baseParentId =
          stackBridge.length > 0 && activeBridge.length === 0
            ? findExceptionStackParentId(exceptionStack, lineNumber, ns, caller.parentId, nodeById)
            : caller.parentId;
        const parentId = ensureMethodContextPath(
          baseParentId,
          exceptionBridge,
          lineNumber,
          ns,
          stackBridge.length > 0 && activeBridge.length === 0 ? 'Exception stack' : 'Apex caller stack',
          addNode,
          nodeById,
          methodContextByKey
        );
        if (attachPendingSoqlToExceptionOwner(pendingSoql, exception.apexLine, parentId, exceptionBridge, nodeById)) {
          pendingSoql = undefined;
        }
        const node = addExceptionNode(exception, lineNumber, ns, parentId, [...caller.chain, ...exceptionBridge]);
        if (node && stackKey) {
          exceptionNodeByStackKey.set(stackKey, node.id);
        }
        break;
      }
      case 'USER_DEBUG': {
        const caller = ensureCallerPath(methodStack, codeUnitStack);
        const debugMessage = attachDebugMessage(nodeById.get(caller.parentId), fields, lineNumber, line);
        if (debugMessage) {
          trackRecentDebugMessage(recentDebugMessagesByParent, caller.parentId, debugMessage);
        }
        const debugContext = parseDebugContext(fields, lineNumber, ns, caller.parentId);
        if (debugContext) {
          latestDebugContextByParent.set(caller.parentId, debugContext);
        }
        break;
      }
      default:
        break;
    }
  }

  closeOpenNodes(nodes, lastNs, rawLines.length);
  inferGenericDmlObjects(nodes, nodeById);
  applyTransactionEntrySummary(root, nodes);
  root.endNs = lastNs || root.startNs;
  root.lineEnd = rawLines.length;
  root.durationMs = durationMs(root.startNs, root.endNs);
  addRelativeHotspotWarnings(nodes, root.durationMs, currentLimitCeilings);

  let finalHotspots: Hotspot[] = [];
  if (methodCounts.size > 0) {
    finalHotspots = topHotspots(methodCounts);
  } else {
    const labelCounts = new Map<string, number>();
    for (const node of nodes) {
      if (node.kind === 'trigger' || node.kind === 'flowRuntime' || node.kind === 'flow' || node.kind === 'dml' || node.kind === 'apex') {
        const key = `${node.kind.toUpperCase()}: ${node.label}`;
        labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
      }
    }
    finalHotspots = [...labelCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }

  const summary: LogSummary = {
    lineCount: rawLines.length,
    eventCounts: Object.fromEntries(eventCounts),
    durationMs: firstNs === undefined ? 0 : durationMs(firstNs, lastNs),
    dmlCount,
    soqlCount,
    codeUnitCount: nodes.filter((node) => ['apex', 'trigger', 'flowRuntime', 'validation', 'workflow', 'async', 'codeUnit'].includes(node.kind)).length,
    triggerCount: nodes.filter((node) => node.kind === 'trigger').length,
    flowCount: nodes
      .filter((node) => node.kind === 'flow' && node.metrics.flowApiName)
      .reduce((total, node) => total + Math.max(1, Number(node.metrics.interviewCount ?? 1) || 1), 0),
    exceptionCount: nodes.filter((node) => node.kind === 'exception').length,
    collapsedNoiseCount,
    noiseGroups: topGroups(eventCounts, NOISY_EVENTS),
    dmlByObject: mapToGroups(dmlByObject),
    soqlByObject: mapToGroups(soqlByObject),
    hotspots: finalHotspots
  };

  return { nodes, summary };
}

function applyTransactionEntrySummary(root: StoryNode, nodes: StoryNode[]): void {
  const entry = nodes.find(
    (node) => node.parentId === root.id && node.kind === 'async' && node.metrics.asyncRole === 'transaction'
  );
  if (!entry) {
    return;
  }
  const asyncType = String(entry.metrics.asyncType ?? 'Async Apex');
  root.label = `${asyncType} Transaction`;
  root.subtitle = 'Started as async Apex';
  root.metrics.asyncType = asyncType;
  root.metrics.asyncRole = 'transaction';
  root.metrics.asyncTransactionScope = 'currentApexTransaction';
}

function attachDebugMessage(node: StoryNode | undefined, fields: string[], lineNumber: number, rawLine: string): DebugMessage | undefined {
  if (!node) {
    return undefined;
  }

  const source = fields[0];
  const level = fields[1] || 'DEBUG';
  const message = fields.slice(2).join('|') || fields.at(-1) || rawLine;
  const debugMessage = {
    line: lineNumber,
    level,
    message,
    source
  };
  node.debugMessages = [
    ...(node.debugMessages ?? []),
    debugMessage
  ];
  node.metrics.debugMessages = node.debugMessages.length;
  node.lineEnd = Math.max(node.lineEnd, lineNumber);
  return debugMessage;
}

function trackRecentDebugMessage(
  messagesByParent: Map<string, DebugMessage[]>,
  parentId: string,
  message: DebugMessage
): void {
  const messages = messagesByParent.get(parentId) ?? [];
  messages.push(message);
  if (messages.length > 80) {
    messages.splice(0, messages.length - 80);
  }
  messagesByParent.set(parentId, messages);
}

function collectRecentDebugTrail(
  messages: DebugMessage[],
  ownerSignature: string | undefined,
  lineNumber: number
): DebugMessage[] {
  const ownerClass = ownerSignature?.split('.')[0];
  if (!ownerClass) {
    return [];
  }

  return messages
    .filter((message) => message.line < lineNumber && message.message.includes(ownerClass))
    .slice(-8);
}

function inferDebugAttributionSignature(
  messages: DebugMessage[],
  ownerSignature: string | undefined,
  lineNumber: number
): string | undefined {
  const ownerClass = ownerSignature?.split('.')[0];
  if (!ownerClass) {
    return undefined;
  }

  return messages
    .filter((message) => message.line < lineNumber && message.message.includes(ownerClass))
    .map((message) => message.message.match(/\b([A-Z][A-Za-z0-9_]*\.[a-z][A-Za-z0-9_]*)\b/)?.[1])
    .filter((signature): signature is string => Boolean(signature))
    .map(normalizeBusinessSignature)
    .filter((signature) => isBusinessBridgeMethod(signature) && signature !== ownerSignature)
    [0];
}

function parseDebugContext(fields: string[], lineNumber: number, ns: number, parentId: string): DebugContext | undefined {
  const message = fields.slice(2).join('|');
  const signature = message.match(/\b([A-Z][A-Za-z0-9_]*\.[a-z][A-Za-z0-9_]*)\b/)?.[1];
  if (!signature) {
    return undefined;
  }
  const normalized = normalizeBusinessSignature(signature);
  if (!isBusinessBridgeMethod(normalized)) {
    return undefined;
  }
  return { signature: normalized, line: lineNumber, parentId, ns };
}

function buildDmlContextChain(
  callerChain: string[],
  profile: DmlProfile | undefined,
  debugContext: DebugContext | undefined,
  lineNumber: number,
  ns: number
): AttributionContext {
  const debugIsRecent =
    debugContext !== undefined &&
    lineNumber >= debugContext.line &&
    lineNumber - debugContext.line <= 5000 &&
    ns >= debugContext.ns &&
    ns - debugContext.ns <= 1_000_000_000;

  if (profile) {
    const bridge = buildProfileBackedBridge(callerChain, profile.signature);
    const debugSignature = debugIsRecent && isDebugSignatureRelevant(debugContext.signature, callerChain, profile.signature)
      ? debugContext.signature
      : undefined;
    return {
      bridge,
      callerChain: uniqueBusinessSignatures([...callerChain, ...bridge]),
      source: 'DML profiling',
      graphSource: bridge.length > 0 ? 'Apex caller stack' : 'DML profiling source context',
      confidence: 'high',
      ownerSignature: profile.signature,
      ...(debugSignature ? { debugSignature } : {})
    };
  }

  if (debugIsRecent) {
    return {
      bridge: [],
      callerChain: uniqueStrings(callerChain),
      source: 'USER_DEBUG context',
      confidence: 'medium',
      ownerSignature: debugContext.signature,
      debugSignature: debugContext.signature
    };
  }

  const bridge = selectBusinessMethodBridge(callerChain);
  return {
    bridge,
    callerChain: uniqueStrings([...callerChain, ...bridge]),
    source: bridge.length > 0 ? 'Apex caller stack' : 'No Apex method evidence',
    confidence: bridge.length > 0 ? 'low' : 'unknown'
  };
}

function buildSoqlContextChain(
  callerChain: string[],
  profile: SoqlProfile | undefined
): AttributionContext {
  if (profile) {
    const bridge = buildProfileBackedBridge(callerChain, profile.signature);
    return {
      bridge,
      callerChain: uniqueBusinessSignatures([...callerChain, ...bridge]),
      source: 'SOQL profiling',
      graphSource: bridge.length > 0 ? 'Apex caller stack' : 'SOQL profiling source context',
      confidence: 'high',
      ownerSignature: profile.signature
    };
  }

  const bridge = selectBusinessMethodBridge(callerChain);
  return {
    bridge,
    callerChain: uniqueStrings([...callerChain, ...bridge]),
    source: bridge.length > 0 ? 'Apex caller stack' : 'Code unit context',
    confidence: bridge.length > 0 ? 'low' : 'unknown'
  };
}

function buildEmailContextChain(
  callerChain: string[],
  sourceContext: SourceContext | undefined,
  sourceLine: number | undefined
): AttributionContext {
  if (sourceContext) {
    const sourceLocation = formatApexSourceLocationSignature(
      sourceContext.className,
      sourceLine ?? sourceContext.sourceLine
    );
    return {
      bridge: [sourceLocation],
      callerChain: uniqueStrings([...callerChain, sourceLocation]),
      source: 'Apex source line context',
      confidence: 'source line only',
      ownerSignature: formatApexSourceLocation(sourceContext.className, sourceLine ?? sourceContext.sourceLine)
    };
  }

  const bridge = selectBusinessMethodBridge(callerChain);
  return {
    bridge,
    callerChain: uniqueStrings([...callerChain, ...bridge]),
    source: bridge.length > 0 ? 'Apex caller stack' : 'Code unit context',
    confidence: bridge.length > 0 ? 'low' : 'unknown'
  };
}

function selectBusinessMethodBridge(chain: string[], limit = 16): string[] {
  return uniqueBusinessSignatures(chain.filter(isBusinessBridgeMethod)).slice(-limit);
}

function buildProfileBackedBridge(callerChain: string[], ownerSignature: string | undefined, limit = 16): string[] {
  const bridge = selectBusinessMethodBridge(callerChain, limit);
  if (!ownerSignature || !isBusinessBridgeMethod(ownerSignature)) {
    return bridge;
  }
  if (bridge.some((signature) => sameBusinessSignature(signature, ownerSignature))) {
    return bridge;
  }
  return uniqueBusinessSignatures([...bridge, ownerSignature]).slice(-limit);
}

function isDebugSignatureRelevant(debugSignature: string, callerChain: string[], ownerSignature: string | undefined): boolean {
  return (
    (ownerSignature !== undefined && sameBusinessSignature(debugSignature, ownerSignature)) ||
    callerChain.some((signature) => sameBusinessSignature(signature, debugSignature))
  );
}

function sameBusinessSignature(left: string, right: string): boolean {
  return normalizeBusinessSignature(left) === normalizeBusinessSignature(right);
}

function ensureMethodContextPath(
  baseParentId: string,
  chain: string[],
  lineNumber: number,
  ns: number,
  source: string,
  addNode: AddNode,
  nodeById: Map<string, StoryNode>,
  methodContextByKey: Map<string, string>
): string {
  let parentId = baseParentId;
  const sourceContextOnly = source !== 'Apex caller stack' && source !== 'Exception stack';

  chain.forEach((signature) => {
    const keys = methodContextKeys(parentId, signature);
    let node = keys.map((key) => nodeById.get(methodContextByKey.get(key) ?? '')).find(Boolean);
    if (!node) {
      node = addNode('method', compactSignature(signature), lineNumber, ns, parentId, {
        subtitle: classFromSignature(signature),
        detail: signature,
        metrics: {
          signature,
          evidence: source,
          sourceContextOnly,
          ...(/\.line\d+$/.test(signature) ? { sourceLineContext: true } : {})
        }
      });
      const nodeId = node.id;
      keys.forEach((key) => methodContextByKey.set(key, nodeId));
    } else if (!sourceContextOnly && node.metrics.sourceContextOnly) {
      node.metrics.sourceContextOnly = false;
      node.metrics.evidence = source;
    } else {
      const existingSignature = String(node.metrics.signature ?? node.detail ?? '');
      if (!existingSignature.includes('(') && signature.includes('(')) {
        node.label = compactSignature(signature);
        node.detail = signature;
        node.metrics.signature = signature;
      }
      const nodeId = node.id;
      keys.forEach((key) => methodContextByKey.set(key, nodeId));
    }

    node.lineEnd = Math.max(node.lineEnd, lineNumber);
    node.endNs = Math.max(node.endNs ?? node.startNs, ns);
    node.durationMs = durationMs(node.startNs, node.endNs);
    parentId = node.id;
  });

  return parentId;
}

function methodContextKeys(parentId: string, signature: string): string[] {
  const keys = [`${parentId}|${signature}`];
  const normalized = normalizeBusinessSignature(signature);
  if (normalized && normalized !== signature && isBusinessBridgeMethod(normalized)) {
    keys.push(`${parentId}|${normalized}`);
  }
  return uniqueStrings(keys);
}

function bridgeNestedCodeUnitParent(
  runtimeParentId: string,
  codeUnitParentId: string,
  activeDmlNode: StoryNode | undefined,
  methodStack: StackFrame[],
  lineNumber: number,
  ns: number,
  addNode: AddNode,
  nodeById: Map<string, StoryNode>,
  methodContextByKey: Map<string, string>
): string {
  if (activeDmlNode || runtimeParentId !== codeUnitParentId) {
    return runtimeParentId;
  }

  const parent = nodeById.get(codeUnitParentId);
  if (!parent || parent.kind === 'root') {
    return runtimeParentId;
  }

  const bridge = selectBusinessMethodBridge(methodStack.map((frame) => frame.signature), 4);
  if (bridge.length === 0) {
    return runtimeParentId;
  }

  return ensureMethodContextPath(
    runtimeParentId,
    bridge,
    lineNumber,
    ns,
    'Apex caller stack',
    addNode,
    nodeById,
    methodContextByKey
  );
}

function findRecentMatchingFlowElement(
  parentId: string,
  interviewId: string,
  elementType: string,
  apiName: string,
  nodeById: Map<string, StoryNode>
): StoryNode | undefined {
  const parent = nodeById.get(parentId);
  const recentChildren = parent?.childIds.slice(-8).reverse() ?? [];
  return recentChildren
    .map((childId) => nodeById.get(childId))
    .find(
      (node) =>
        node?.kind === 'flowElement' &&
        node.metrics.interviewId === interviewId &&
        node.metrics.elementType === elementType &&
        node.metrics.apiName === apiName
    );
}

function buildDmlProfileIndex(rawLines: string[]): Map<string, DmlProfile[]> {
  const index = new Map<string, DmlProfile[]>();
  let inDmlProfileSection = false;

  rawLines.forEach((line) => {
    const logMatch = LOG_LINE_PATTERN.exec(line);
    if (logMatch?.[3] === 'CUMULATIVE_PROFILING') {
      inDmlProfileSection = (logMatch[4] ?? '').startsWith('DML operations');
      return;
    }
    if (!inDmlProfileSection) {
      return;
    }
    if (!line.trim()) {
      inDmlProfileSection = false;
      return;
    }

    const profile = parseDmlProfileLine(line);
    if (profile) {
      addDmlProfile(index, profile);
    }
  });

  return index;
}

function buildSourceAttributionPath({
  parent,
  callerBridge,
  ownerSignature,
  debugSignature,
  eventLabel
}: {
  parent: StoryNode | undefined;
  callerBridge?: string[];
  ownerSignature: string | undefined;
  debugSignature: string | undefined;
  eventLabel: string;
}): string[] {
  if (!ownerSignature && !debugSignature) {
    return [];
  }

  const path: string[] = [];
  const parentLabel = parent?.label;
  if (parentLabel && parent?.kind !== 'root') {
    path.push(parentLabel);
  }

  callerBridge?.forEach((signature) => {
    path.push(normalizeBusinessSignature(signature));
  });
  if (debugSignature) {
    path.push(debugSignature);
  }
  if (ownerSignature) {
    path.push(ownerSignature);
  }
  path.push(eventLabel);
  return uniqueStrings(path);
}

function sourceContextBridgeFromAttributionPath(
  path: string[],
  parent: StoryNode | undefined,
  eventLabel: string
): string[] {
  return uniqueStrings(
    path
      .filter((item) => item !== parent?.label && item !== eventLabel)
      .map(normalizeBusinessSignature)
      .filter(isBusinessBridgeMethod)
  );
}

function parseDmlProfileLine(line: string): DmlProfile | undefined {
  const match = line.match(/^(?:Class|Trigger)\.([A-Za-z0-9_]+)\.([A-Za-z0-9_<>]+): line (\d+), column \d+:\s*(.+): executed\b/i);
  if (!match) {
    return undefined;
  }

  const [, className, methodName, sourceLine, operationText] = match;
  const dml = parseProfileDmlOperation(operationText);
  if (!dml) {
    return undefined;
  }

  return {
    sourceLine: Number(sourceLine),
    operation: dml.operation,
    objectName: dml.objectName,
    signature: `${className}.${methodName}`
  };
}

function parseProfileDmlOperation(text: string): { operation: string; objectName: string } | undefined {
  const direct = text.match(/^(Insert|Update|Upsert|Delete|Undelete|Merge):\s*(.+)$/i);
  if (direct) {
    return {
      operation: titleCaseDmlOperation(direct[1]),
      objectName: extractProfileDmlObject(direct[2])
    };
  }

  const databaseCall = text.match(/\bDatabase\.(insert|update|upsert|delete|undelete|merge)\((.+)\)/i);
  if (databaseCall) {
    return {
      operation: titleCaseDmlOperation(databaseCall[1]),
      objectName: extractProfileDmlObject(databaseCall[2])
    };
  }

  return undefined;
}

function extractProfileDmlObject(text: string): string {
  const listType = text.match(/\b(?:List|Set)<\s*([A-Za-z0-9_]+)\s*>/i)?.[1];
  if (listType) {
    return listType;
  }
  return text
    .split(',')
    .at(0)!
    .replace(/\b(?:List|Set)<\s*/i, '')
    .replace(/>\s*$/i, '')
    .trim();
}

function addDmlProfile(index: Map<string, DmlProfile[]>, profile: DmlProfile): void {
  const add = (key: string) => {
    index.set(key, [...(index.get(key) ?? []), profile]);
  };
  add(dmlProfileKey(profile.sourceLine, profile.operation, profile.objectName));
  if (isGenericObjectName(profile.objectName)) {
    add(dmlProfileKey(profile.sourceLine, profile.operation, 'SObject'));
  }
}

function findDmlProfile(
  index: Map<string, DmlProfile[]>,
  sourceLine: number | undefined,
  operation: string,
  objectName: string
): DmlProfile | undefined {
  if (sourceLine === undefined) {
    return undefined;
  }
  return (
    index.get(dmlProfileKey(sourceLine, operation, objectName))?.[0] ??
    index.get(dmlProfileKey(sourceLine, operation, 'SObject'))?.[0]
  );
}

function dmlProfileKey(sourceLine: number, operation: string, objectName: string): string {
  return `${sourceLine}|${titleCaseDmlOperation(operation)}|${normalizeSalesforceObjectName(objectName)}`;
}

function buildSoqlProfileIndex(rawLines: string[]): Map<string, SoqlProfile[]> {
  const index = new Map<string, SoqlProfile[]>();
  let inSoqlProfileSection = false;
  let current = '';

  const flush = () => {
    if (!current.trim()) {
      current = '';
      return;
    }
    const profile = parseSoqlProfileEntry(current);
    if (profile) {
      addSoqlProfile(index, profile);
    }
    current = '';
  };

  rawLines.forEach((line) => {
    const logMatch = LOG_LINE_PATTERN.exec(line);
    if (logMatch?.[3] === 'CUMULATIVE_PROFILING') {
      flush();
      inSoqlProfileSection = (logMatch[4] ?? '').startsWith('SOQL operations');
      return;
    }
    if (logMatch?.[3] === 'CUMULATIVE_PROFILING_END') {
      flush();
      inSoqlProfileSection = false;
      return;
    }
    if (!inSoqlProfileSection) {
      return;
    }
    if (/^(?:Class|Trigger)\./.test(line) && current) {
      flush();
    }
    current += `${current ? '\n' : ''}${line}`;
    if (/: executed \d+ times? in \d+ ms\s*$/i.test(line)) {
      flush();
    }
  });
  flush();

  return index;
}

function parseSoqlProfileEntry(entry: string): SoqlProfile | undefined {
  const compact = compactQuery(entry);
  const match = compact.match(/^(?:Class|Trigger)\.([A-Za-z0-9_]+)\.([A-Za-z0-9_<>]+): line (\d+), column \d+:\s*(.+): executed (\d+) times? in (\d+) ms$/i);
  if (!match) {
    return undefined;
  }

  const [, className, methodName, sourceLine, query, executionCount, duration] = match;
  const objectName = query.match(/\bFROM\s+([A-Za-z0-9_$.]+)\b/i)?.[1] ?? 'Records';
  return {
    sourceLine: Number(sourceLine),
    objectName,
    signature: `${className}.${methodName}`,
    executionCount: Number(executionCount),
    durationMs: Number(duration),
    query: normalizeProfileQuery(query)
  };
}

function addSoqlProfile(index: Map<string, SoqlProfile[]>, profile: SoqlProfile): void {
  const add = (key: string) => {
    index.set(key, [...(index.get(key) ?? []), profile]);
  };
  add(soqlProfileKey(profile.sourceLine, profile.objectName));
  add(soqlProfileKey(profile.sourceLine, 'Records'));
}

function findSoqlProfile(
  index: Map<string, SoqlProfile[]>,
  sourceLine: number | undefined,
  objectName: string,
  query: string
): SoqlProfile | undefined {
  if (sourceLine === undefined) {
    return undefined;
  }
  const candidates = [
    ...(index.get(soqlProfileKey(sourceLine, objectName)) ?? []),
    ...(index.get(soqlProfileKey(sourceLine, 'Records')) ?? [])
  ];
  if (candidates.length <= 1) {
    return candidates[0];
  }
  const normalizedQuery = normalizeQueryForRepeat(query);
  return (
    candidates.find((candidate) => normalizeQueryForRepeat(candidate.query) === normalizedQuery) ??
    candidates[0]
  );
}

function soqlProfileKey(sourceLine: number, objectName: string): string {
  return `${sourceLine}|${normalizeSalesforceObjectName(objectName)}`;
}

function normalizeProfileQuery(query: string): string {
  return query.replace(/^\[\s*/, '').replace(/\s*\]$/, '').trim();
}

function titleCaseDmlOperation(operation: string): string {
  const normalized = operation.trim().toLowerCase();
  return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : 'DML';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueBusinessSignatures(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.filter(Boolean).forEach((value) => {
    const key = normalizeBusinessSignature(value);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(value);
  });
  return out;
}

function collectExceptionStack(rawLines: string[], index: number): string[] {
  const immediate = collectImmediateExceptionStack(rawLines, index);
  if (immediate.length > 0) {
    return immediate;
  }

  for (let offset = 1; offset <= 8; offset += 1) {
    const match = LOG_LINE_PATTERN.exec(rawLines[index + offset] ?? '');
    if (match?.[3] === 'FATAL_ERROR') {
      return collectImmediateExceptionStack(rawLines, index + offset);
    }
  }

  return [];
}

function attachPendingSoqlToExceptionOwner(
  pendingSoql: PendingSoql | undefined,
  apexLine: number | undefined,
  parentId: string,
  exceptionBridge: string[],
  nodeById: Map<string, StoryNode>
): boolean {
  if (!pendingSoql || exceptionBridge.length === 0) {
    return false;
  }
  const node = nodeById.get(pendingSoql.id);
  if (!node || node.kind !== 'soql') {
    return false;
  }
  const sourceLine = Number(node.metrics.sourceLine ?? 0);
  if (apexLine !== undefined && sourceLine > 0 && sourceLine !== apexLine) {
    return false;
  }

  reparentNode(node, parentId, nodeById);
  node.metrics.attribution = 'Exception stack';
  node.metrics.attributionConfidence = 'high';
  node.metrics.ownerSignature = exceptionBridge.at(-1) ?? exceptionBridge[0];
  node.callerChain = uniqueStrings([...(node.callerChain ?? []), ...exceptionBridge]);
  return true;
}

function pendingSoqlBelongsToException(
  pendingSoql: PendingSoql | undefined,
  apexLine: number | undefined,
  nodeById: Map<string, StoryNode>
): boolean {
  if (!pendingSoql) {
    return false;
  }
  const node = nodeById.get(pendingSoql.id);
  if (!node || node.kind !== 'soql') {
    return false;
  }
  const sourceLine = Number(node.metrics.sourceLine ?? 0);
  return apexLine === undefined || sourceLine === 0 || sourceLine === apexLine;
}

function findExceptionStackParentId(
  stack: string[],
  lineNumber: number,
  ns: number,
  fallbackParentId: string,
  nodeById: Map<string, StoryNode>
): string {
  const triggerName = stack
    .map((frame) => frame.match(/^Trigger\.([A-Za-z0-9_]+)(?::|$)/)?.[1])
    .find(Boolean);
  if (!triggerName) {
    return fallbackParentId;
  }

  const matchingTrigger = [...nodeById.values()]
    .filter((node) => {
      if (node.kind !== 'trigger' || String(node.metrics.triggerName ?? '') !== triggerName) {
        return false;
      }
      const nodeEndNs = node.endNs ?? node.startNs;
      return node.lineStart <= lineNumber && node.startNs <= ns && nodeEndNs <= ns;
    })
    .sort((left, right) => {
      const rightEndNs = right.endNs ?? right.startNs;
      const leftEndNs = left.endNs ?? left.startNs;
      return rightEndNs - leftEndNs || right.lineStart - left.lineStart;
    })[0];

  return matchingTrigger?.id ?? fallbackParentId;
}

function exceptionStackFingerprint(exception: ExceptionDetail): string | undefined {
  if (!exception.stack || exception.stack.length === 0) {
    return undefined;
  }
  return [
    exception.exceptionType.trim().toLowerCase(),
    exception.message.trim().toLowerCase(),
    ...exception.stack.map((frame) => frame.trim().toLowerCase())
  ].join('|');
}

function mergeRepeatedExceptionNode(node: StoryNode, exception: ExceptionDetail, lineNumber: number, ns: number): void {
  node.lineEnd = Math.max(node.lineEnd, lineNumber);
  node.endNs = Math.max(node.endNs ?? node.startNs, ns);
  node.durationMs = durationMs(node.startNs, node.endNs);
  node.metrics.repeatedOccurrences = Number(node.metrics.repeatedOccurrences ?? 1) + 1;
  if (exception.raw && !node.detail?.includes(exception.raw)) {
    node.detail = `${node.detail ?? ''}\n${exception.raw}`.trim();
  }
  if (node.exception && exception.raw && !node.exception.raw.includes(exception.raw)) {
    node.exception = {
      ...node.exception,
      raw: `${node.exception.raw}\n${exception.raw}`.trim()
    };
  }
}

function reparentNode(node: StoryNode, parentId: string, nodeById: Map<string, StoryNode>): void {
  if (node.parentId === parentId) {
    return;
  }
  const oldParent = node.parentId ? nodeById.get(node.parentId) : undefined;
  if (oldParent) {
    oldParent.childIds = oldParent.childIds.filter((childId) => childId !== node.id);
  }
  node.parentId = parentId;
  const newParent = nodeById.get(parentId);
  if (newParent && !newParent.childIds.includes(node.id)) {
    newParent.childIds.push(node.id);
    newParent.childIds.sort((a, b) => {
      const left = nodeById.get(a);
      const right = nodeById.get(b);
      return (left?.lineStart ?? 0) - (right?.lineStart ?? 0);
    });
  }
}

function collectImmediateExceptionStack(rawLines: string[], index: number): string[] {
  const stack: string[] = [];
  let sawStackFrame = false;

  for (let offset = 1; offset <= 40; offset += 1) {
    const line = rawLines[index + offset] ?? '';
    if (LOG_LINE_PATTERN.test(line)) {
      break;
    }
    const signature = parseStackFrameSignature(line);
    if (signature) {
      sawStackFrame = true;
      stack.push(signature);
      continue;
    }
    if (sawStackFrame && !line.trim()) {
      break;
    }
  }

  return stack;
}

function parseStackFrameSignature(line: string): string | undefined {
  const classMatch = line.match(/^Class\.([A-Za-z0-9_]+)\.([A-Za-z0-9_<>]+): line \d+, column \d+/);
  if (classMatch) {
    return `${classMatch[1]}.${classMatch[2]}`;
  }
  const triggerMatch = line.match(/^Trigger\.([A-Za-z0-9_]+): line \d+, column \d+/);
  if (triggerMatch) {
    return `Trigger.${triggerMatch[1]}`;
  }
  return undefined;
}

function parseException(fields: string[], eventType: string, rawLine: string, stack: string[] = []): ExceptionDetail {
  const raw = fields.join('|') || rawLine;
  const apexLine = fields.map((field) => field.match(/^\[(\d+)\]$/)?.[1]).find(Boolean);
  const exceptionText = fields.find((field) => /(?:Exception|Error)\b/i.test(field)) ?? raw;
  const [typeCandidate, ...messageParts] = exceptionText.split(':');
  const hasTypedMessage = messageParts.length > 0 && /(?:Exception|Error)\b/i.test(typeCandidate);
  const exceptionType = hasTypedMessage ? typeCandidate.trim() : eventType === 'FATAL_ERROR' ? 'Fatal error' : 'Exception thrown';
  const message = cleanLogMessage(hasTypedMessage ? messageParts.join(':').trim() : exceptionText.trim());

  return {
    eventType,
    exceptionType,
    message: message || raw,
    apexLine: apexLine ? Number(apexLine) : undefined,
    raw,
    stack
  };
}

function buildLogException(
  eventType: string,
  exceptionType: string,
  message: string,
  raw: string,
  stack: string[] = []
): ExceptionDetail {
  return {
    eventType,
    exceptionType,
    message: cleanLogMessage(message) || cleanLogMessage(raw) || eventType,
    raw,
    stack
  };
}

function parseFlowActionCallFailure(fields: string[]): { message: string } | undefined {
  const successIndex = fields.findIndex((field) => /^(?:true|false)$/i.test(field.trim()));
  if (successIndex < 0 || !/^false$/i.test(fields[successIndex]?.trim() ?? '')) {
    return undefined;
  }
  const message = cleanLogMessage(fields.slice(successIndex + 1).filter(Boolean).join('|'));
  return { message: message || `${fields[1] ?? 'Flow action'} reported a failed result.` };
}

function inferExceptionType(message: string, fallback: string): string {
  const systemException = message.match(/\bSystem\.[A-Za-z0-9_]+Exception\b/);
  if (systemException) {
    return systemException[0];
  }
  if (/Too many SOQL queries|Too many query rows|Apex CPU time limit exceeded|LIMIT_EXCEEDED/i.test(message)) {
    return 'System.LimitException';
  }
  const errorCode = message.match(/\b([A-Z][A-Z0-9_]{3,}):/);
  if (errorCode) {
    return errorCode[1];
  }
  if (/Internal Salesforce\.com Error/i.test(message)) {
    return 'Internal Salesforce Error';
  }
  return fallback;
}

function optionalErrorCodeMetric(message: string): Record<string, string> {
  const code = extractSalesforceErrorCode(message);
  return code ? { salesforceErrorCode: code } : {};
}

function extractSalesforceErrorCode(message: string): string | undefined {
  const firstErrorCode = message.match(/\bfirst error:\s*([A-Z][A-Z0-9_]+)\b/i)?.[1];
  if (firstErrorCode) {
    return firstErrorCode;
  }
  const flowCode = message.match(/\b([A-Z][A-Z0-9_]{3,}):\s*(?:System\.|We can't|This error|You|Object|bad value)/)?.[1];
  if (flowCode) {
    return flowCode;
  }
  return undefined;
}

function classifyExceptionCategory(eventType: string, exceptionType: string, message: string): string {
  const errorCode = extractSalesforceErrorCode(message) ?? '';
  if (eventType === 'VALIDATION_FAIL' || /FIELD_CUSTOM_VALIDATION_EXCEPTION/i.test(errorCode)) {
    return 'Validation rule';
  }
  if (/FLOW_|WF_FLOW|CANNOT_EXECUTE_FLOW_TRIGGER/i.test(`${eventType} ${errorCode} ${message}`)) {
    return 'Flow automation';
  }
  if (/LimitException/i.test(exceptionType) || /Too many SOQL queries|Too many query rows|Apex CPU time limit exceeded|LIMIT_EXCEEDED/i.test(message)) {
    return 'Governor limit';
  }
  if (/DmlException/i.test(exceptionType) || /UNABLE_TO_LOCK_ROW|SELF_REFERENCE_FROM_TRIGGER|CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY|INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST/i.test(errorCode)) {
    return 'DML';
  }
  if (/QueryException|SObjectException/i.test(exceptionType)) {
    return 'Data read';
  }
  if (/CalloutException/i.test(exceptionType)) {
    return 'Callout';
  }
  if (/EmailException/i.test(exceptionType)) {
    return 'Email';
  }
  if (/AssertException/i.test(exceptionType)) {
    return 'Apex test assertion';
  }
  if (/NullPointerException/i.test(exceptionType)) {
    return 'Apex null reference';
  }
  if (/AuraHandledException/i.test(exceptionType)) {
    return 'Handled Apex error';
  }
  if (/Internal Salesforce Error|Internal Salesforce\.com Error/i.test(`${exceptionType} ${message}`)) {
    return 'Internal Salesforce error';
  }
  return 'Apex exception';
}

function cleanLogMessage(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#124;/g, '|')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactExceptionMessage(message: string): string {
  return message.length > 150 ? `${message.slice(0, 147)}...` : message;
}

function currentCodeUnitId(stack: CodeUnitInfo[]): string {
  return stack[stack.length - 1]?.id ?? 'root-1';
}

function currentAnalysisNodeId(flowByInterview: Map<string, string>, codeUnitStack: CodeUnitInfo[]): string {
  const latestFlow = [...flowByInterview.values()].at(-1);
  return latestFlow ?? currentCodeUnitId(codeUnitStack);
}

function flowRecordMutationParentId(
  classified: { kind: NodeKind; metrics: Record<string, string> },
  mutation: PendingFlowRecordMutation | undefined,
  defaultParentId: string
): string {
  if (!mutation) {
    return defaultParentId;
  }

  const event = String(classified.metrics.event ?? '');
  const objectName = String(classified.metrics.objectName ?? '');
  const triggerMatchesOperation =
    classified.kind === 'trigger' &&
    ((mutation.operation === 'insert' && /insert/i.test(event)) ||
      (mutation.operation === 'update' && /update/i.test(event)) ||
      (mutation.operation === 'delete' && /delete/i.test(event)));
  const validationMatchesMutation =
    classified.kind === 'validation' && mutation.objectName && sameSalesforceObject(objectName, mutation.objectName);

  return triggerMatchesOperation || validationMatchesMutation ? mutation.nodeId : defaultParentId;
}

function flowRecordMutationOperation(elementType: string): PendingFlowRecordMutation['operation'] | undefined {
  const normalized = elementType.toLowerCase();
  if (normalized === 'flowrecordcreate') {
    return 'insert';
  }
  if (normalized === 'flowrecordupdate') {
    return 'update';
  }
  if (normalized === 'flowrecorddelete') {
    return 'delete';
  }
  return undefined;
}

function ensureFlowDecisionTrace(node: StoryNode, interviewId: string, decisionApiName: string, lineNumber: number): FlowDecisionTrace {
  if (!node.flowDecision) {
    node.flowDecision = {
      decisionApiName,
      interviewId,
      outcomes: [],
      selectedOutcomeCount: 0,
      defaultOutcomeInferred: false,
      confidence: 'low',
      evidenceStartLine: lineNumber,
      evidenceEndLine: lineNumber
    };
  }
  node.flowDecision.evidenceStartLine = Math.min(node.flowDecision.evidenceStartLine, lineNumber);
  node.flowDecision.evidenceEndLine = Math.max(node.flowDecision.evidenceEndLine, lineNumber);
  node.metrics.flowDecision = true;
  return node.flowDecision;
}

function appendFlowDecisionOutcome(
  node: StoryNode,
  outcomeApiName: string,
  result: boolean,
  connectorMatched: boolean | undefined,
  lineNumber: number
): void {
  const trace = ensureFlowDecisionTrace(
    node,
    String(node.metrics.interviewId ?? ''),
    String(node.metrics.apiName ?? node.label),
    lineNumber
  );
  let outcome = trace.outcomes.find((candidate) => candidate.outcomeApiName === outcomeApiName);
  if (!outcome) {
    outcome = {
      outcomeApiName,
      result,
      connectorMatched,
      count: 0,
      selectedCount: 0,
      firstLine: lineNumber,
      lastLine: lineNumber
    };
    trace.outcomes.push(outcome);
  }
  outcome.result = result;
  outcome.connectorMatched = connectorMatched;
  outcome.count += 1;
  outcome.lastLine = lineNumber;
  trace.evidenceEndLine = Math.max(trace.evidenceEndLine, lineNumber);
  node.lineEnd = Math.max(node.lineEnd, lineNumber);

  if (result) {
    outcome.selectedCount += 1;
    trace.selectedOutcomeApiName = outcomeApiName;
    trace.selectedOutcomeCount += 1;
    trace.defaultOutcomeInferred = false;
    trace.confidence = 'high';
    node.metrics.selectedOutcome = outcomeApiName;
  }
}

function markFlowDecisionValueAssignment(node: StoryNode, outcomeApiName: string, value: boolean, lineNumber: number): void {
  const trace = node.flowDecision;
  const outcome = trace?.outcomes.find((candidate) => candidate.outcomeApiName === outcomeApiName);
  if (!trace || !outcome) {
    return;
  }
  outcome.valueAssignment = value;
  outcome.lastLine = Math.max(outcome.lastLine, lineNumber);
  trace.evidenceEndLine = Math.max(trace.evidenceEndLine, lineNumber);
  node.lineEnd = Math.max(node.lineEnd, lineNumber);
}

function linkDecisionToNextElement(previousElement: StoryNode | undefined, nextElement: StoryNode, lineNumber: number): void {
  if (!previousElement?.flowDecision || previousElement.id === nextElement.id) {
    return;
  }
  const trace = previousElement.flowDecision;
  if (trace.nextElementNodeId) {
    return;
  }
  trace.nextElementNodeId = nextElement.id;
  trace.nextElementApiName = String(nextElement.metrics.apiName ?? nextElement.label);
  trace.nextElementType = String(nextElement.metrics.elementType ?? nextElement.subtitle ?? nextElement.kind);
  trace.evidenceEndLine = Math.max(trace.evidenceEndLine, lineNumber);
  if (!trace.selectedOutcomeApiName && trace.outcomes.length > 0 && trace.outcomes.every((outcome) => !outcome.result)) {
    trace.defaultOutcomeInferred = true;
    trace.confidence = 'medium';
    previousElement.metrics.selectedOutcome = 'Default outcome';
  }
}

function findLatestFlowDecisionNode(interviewId: string, nodeById: Map<string, StoryNode>, lineNumber: number): StoryNode | undefined {
  return [...nodeById.values()]
    .filter((node) =>
      node.kind === 'flowElement' &&
      node.metrics.interviewId === interviewId &&
      node.metrics.elementType === 'FlowDecision' &&
      node.lineStart <= lineNumber
    )
    .sort((a, b) => b.lineEnd - a.lineEnd || b.lineStart - a.lineStart)
    [0];
}

function findLatestFlowElementNode(
  elementType: string,
  apiName: string,
  nodeById: Map<string, StoryNode>,
  lineNumber: number
): StoryNode | undefined {
  return [...nodeById.values()]
    .filter((node) =>
      (node.kind === 'flowElement' || node.kind === 'email') &&
      node.metrics.elementType === elementType &&
      node.metrics.apiName === apiName &&
      node.lineStart <= lineNumber
    )
    .sort((a, b) => b.lineStart - a.lineStart || b.lineEnd - a.lineEnd)
    [0];
}

function parseLogBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

function flowElementLabel(elementType: string, apiName: string): string {
  const readableName = apiName.replace(/_+/g, ' ').trim() || 'Flow record action';
  const operation = flowRecordMutationOperation(elementType);
  if (operation === 'insert') {
    return `Create ${readableName.replace(/^create\s+/i, '')}`;
  }
  if (operation === 'update') {
    return `Update ${readableName.replace(/^update\s+/i, '')}`;
  }
  if (operation === 'delete') {
    return `Delete ${readableName.replace(/^delete\s+/i, '')}`;
  }
  return apiName;
}

function flowElementSubtitle(elementType: string): string {
  const operation = flowRecordMutationOperation(elementType);
  if (operation === 'insert') {
    return 'Flow record create';
  }
  if (operation === 'update') {
    return 'Flow record update';
  }
  if (operation === 'delete') {
    return 'Flow record delete';
  }
  return elementType;
}

function sameSalesforceObject(left: string, right: string): boolean {
  return normalizeSalesforceObjectName(left) === normalizeSalesforceObjectName(right);
}

function normalizeSalesforceObjectName(value: string): string {
  return value.replace(/__c$/i, '').replace(/_/g, '').toLowerCase();
}

function looksLikeSalesforceId(value: string): boolean {
  return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(value);
}

function closeOpenNodes(nodes: StoryNode[], endNs: number, lineEnd: number): void {
  nodes.forEach((node) => {
    if (node.endNs === undefined) {
      closeNode(node, endNs || node.startNs, lineEnd);
    }
  });
}

function closeNode(node: StoryNode | undefined, endNs: number, lineEnd: number): void {
  if (!node) {
    return;
  }
  node.endNs = Math.max(endNs, node.startNs);
  node.lineEnd = Math.max(node.lineEnd, lineEnd);
  node.durationMs = durationMs(node.startNs, node.endNs);
  addPerformanceWarnings(node);
}

function extendMethodAncestors(
  node: StoryNode | undefined,
  endNs: number,
  lineEnd: number,
  nodeById: Map<string, StoryNode>
): void {
  let cursor = node?.parentId ? nodeById.get(node.parentId) : undefined;
  while (cursor?.kind === 'method') {
    cursor.endNs = Math.max(cursor.endNs ?? cursor.startNs, endNs);
    cursor.lineEnd = Math.max(cursor.lineEnd, lineEnd);
    cursor.durationMs = durationMs(cursor.startNs, cursor.endNs);
    addPerformanceWarnings(cursor);
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }
}

function inferGenericDmlObjects(nodes: StoryNode[], nodeById: Map<string, StoryNode>): void {
  nodes.forEach((node) => {
    if (node.kind !== 'dml' || !isGenericObjectName(node.metrics.objectName)) {
      return;
    }
    const inferredObject = inferObjectFromAutomation(node, nodeById);
    if (!inferredObject) {
      return;
    }
    const operation = String(node.metrics.operation ?? 'DML');
    node.metrics.rawObjectName = String(node.metrics.objectName ?? 'SObject');
    node.metrics.objectName = inferredObject;
    node.metrics.objectNameInferred = true;
    node.metrics.objectNameInference = 'Nested automation object';
    node.label = `${operation} ${inferredObject}`;
    if (typeof node.metrics.sourceAttributionPath === 'string') {
      const sourcePath = node.metrics.sourceAttributionPath
        .split('|')
        .filter(Boolean);
      if (sourcePath.length > 0) {
        sourcePath[sourcePath.length - 1] = node.label;
        node.metrics.sourceAttributionPath = uniqueStrings(sourcePath).join('|');
      }
    }
    node.detail = node.detail ? `${node.detail}|InferredType:${inferredObject}` : `InferredType:${inferredObject}`;
  });
}

function inferObjectFromAutomation(node: StoryNode, nodeById: Map<string, StoryNode>): string | undefined {
  const objectCounts = new Map<string, number>();
  const visit = (nodeId: string) => {
    const current = nodeById.get(nodeId);
    if (!current || (current.kind === 'dml' && current.id !== node.id)) {
      return;
    }
    const objectName = automationObjectName(current);
    if (objectName && !isGenericObjectName(objectName)) {
      objectCounts.set(objectName, (objectCounts.get(objectName) ?? 0) + 1);
    }
    current.childIds.forEach(visit);
  };

  node.childIds.forEach(visit);
  return [...objectCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

function automationObjectName(node: StoryNode): string | undefined {
  const metricName = node.metrics.objectName;
  if (typeof metricName === 'string' && metricName.trim()) {
    return metricName.trim();
  }
  const validationMatch = node.label.match(/^Validation:\s*(.+)$/i);
  if (validationMatch) {
    return validationMatch[1].trim();
  }
  return undefined;
}

function isGenericObjectName(value: unknown): boolean {
  return typeof value === 'string' && /^(?:sobject|record|object)$/i.test(value.trim());
}

function durationMs(startNs: number, endNs: number): number {
  return Math.max(0, Math.round(((endNs - startNs) / 1_000_000) * 100) / 100);
}

function pickCodeUnitName(fields: string[]): string {
  if (fields.length >= 3) {
    return fields[2];
  }
  return fields[1] ?? fields[0] ?? 'Code unit';
}

function flowInterviewGroupKey(parentId: string, groupId: number, flowName: string): string {
  return `${parentId}|${groupId}|${flowName.trim().toLowerCase()}`;
}

function appendDelimitedMetric(value: unknown, nextValue: string): string {
  const existing = typeof value === 'string' && value.trim() ? value.trim() : '';
  return existing ? `${existing}, ${nextValue}` : nextValue;
}

function shouldCollapseSystemCodeUnit(rawName: string): boolean {
  return rawName.trim().toUpperCase() === 'SLA';
}

function shouldSkipApexActionWrapper(rawName: string, rawLines: string[], index: number): boolean {
  const action = parseApexActionName(rawName);
  if (!action) {
    return false;
  }

  for (let offset = 1; offset <= 3; offset += 1) {
    const nextMatch = LOG_LINE_PATTERN.exec(rawLines[index + offset] ?? '');
    if (!nextMatch) {
      continue;
    }
    if (nextMatch[3] !== 'CODE_UNIT_STARTED') {
      return false;
    }
    const nextFields = nextMatch[4] ? nextMatch[4].split('|') : [];
    const nextName = pickCodeUnitName(nextFields);
    return nextName.startsWith(`${action.className}.${action.methodName}(`);
  }

  return false;
}

function parseApexActionName(rawName: string): { className: string; methodName: string } | null {
  const match = rawName.match(/^apex:\/\/([^/]+)\/ACTION\$([A-Za-z0-9_]+)$/i);
  if (!match) {
    return null;
  }
  return {
    className: match[1],
    methodName: match[2]
  };
}

function classifyAsyncTransactionCodeUnit(rawName: string): AsyncApexDefinition | null {
  const normalized = rawName.trim();
  if (!normalized || /^execute_anonymous_apex$/i.test(normalized)) {
    return null;
  }

  if (/^FutureHandler\b/i.test(normalized)) {
    return {
      asyncType: 'Future Method',
      label: readableAsyncTarget(normalized),
      subtitle: 'Future Method transaction',
      role: 'transaction',
      transactionScope: 'currentApexTransaction',
      verb: 'started'
    };
  }

  if (/Queueable/i.test(normalized)) {
    return {
      asyncType: 'Queueable Apex',
      label: readableAsyncTarget(normalized),
      subtitle: 'Queueable Apex transaction',
      role: 'transaction',
      transactionScope: 'currentApexTransaction',
      verb: 'started'
    };
  }

  if (/Batch/i.test(normalized)) {
    return {
      asyncType: 'Batch Apex',
      label: readableAsyncTarget(normalized),
      subtitle: 'Batch Apex transaction',
      role: 'transaction',
      transactionScope: 'currentApexTransaction',
      verb: 'started'
    };
  }

  if (/(?:Schedulable|Scheduled|Scheduler|Cron)/i.test(normalized)) {
    return {
      asyncType: 'Scheduled Apex',
      label: readableAsyncTarget(normalized),
      subtitle: 'Scheduled Apex transaction',
      role: 'transaction',
      transactionScope: 'currentApexTransaction',
      verb: 'started'
    };
  }

  return null;
}

function readableAsyncTarget(rawName: string): string {
  return rawName
    .replace(/^[a-zA-Z0-9]{15,18}\|/, '')
    .replace(/^FutureHandler\s*-\s*/i, 'FutureHandler: ')
    .trim() || 'Async Apex';
}

function classifyCodeUnit(rawName: string, isTransactionEntry = false): {
  kind: NodeKind;
  label: string;
  subtitle?: string;
  metrics: Record<string, string>;
} {
  const triggerMatch = rawName.match(/^(.+?) on (.+?) trigger event (.+)$/i);
  if (triggerMatch) {
    return {
      kind: 'trigger',
      label: `${triggerMatch[1]} ${triggerMatch[3]}`,
      subtitle: triggerMatch[2],
      metrics: {
        triggerName: triggerMatch[1],
        objectName: triggerMatch[2],
        event: triggerMatch[3]
      }
    };
  }

  const asyncTransaction = isTransactionEntry ? classifyAsyncTransactionCodeUnit(rawName) : null;
  if (asyncTransaction) {
    return {
      kind: 'async',
      label: asyncTransaction.label,
      subtitle: asyncTransaction.subtitle,
      metrics: {
        asyncType: asyncTransaction.asyncType,
        asyncRole: asyncTransaction.role,
        asyncTransactionScope: asyncTransaction.transactionScope,
        requestVerb: asyncTransaction.verb,
        transactionEntry: 'true',
        sourceName: rawName
      }
    };
  }

  if (rawName.startsWith('Flow:')) {
    const flowScope = rawName.replace(/^Flow:/, '').trim();
    const hasReadableScope = flowScope && !looksLikeSalesforceId(flowScope);
    const objectName = hasReadableScope ? flowScope : 'Record';
    return {
      kind: 'flowRuntime',
      label: hasReadableScope ? `${objectName} Flow Runtime` : 'Flow Runtime',
      subtitle: 'Record-triggered Flow runtime wrapper',
      metrics: {
        objectName,
        runtimeNode: 'true',
        ...(hasReadableScope ? {} : { flowRuntimeId: flowScope })
      }
    };
  }

  if (rawName.startsWith('Validation:')) {
    const [, objectName = 'Record'] = rawName.split(':');
    return {
      kind: 'validation',
      label: `Validation: ${objectName}`,
      subtitle: 'Validation rules',
      metrics: { objectName }
    };
  }

  if (rawName.startsWith('Workflow:') || rawName.startsWith('WF_')) {
    return {
      kind: 'workflow',
      label: rawName,
      subtitle: 'Workflow automation',
      metrics: {}
    };
  }

  if (rawName.startsWith('apex://')) {
    return {
      kind: 'apex',
      label: rawName.replace(/^apex:\/\/([^/]+)\/ACTION\$(.+)$/i, '$1.$2 action'),
      subtitle: 'Apex action',
      metrics: {}
    };
  }

  if (rawName.includes('.') || rawName.includes('(')) {
    return {
      kind: 'apex',
      label: rawName,
      subtitle: 'Apex code unit',
      metrics: {}
    };
  }

  return {
    kind: 'codeUnit',
    label: rawName || 'Code unit',
    subtitle: 'Code unit',
    metrics: {}
  };
}

function systemMethodSignature(fields: string[]): string {
  return fields.at(-1)?.trim() || fields.join('|').trim() || 'System method';
}

function classifySystemEmailSend(signature: string): EmailSendDefinition | null {
  if (!/^Messaging\.(?:sendEmail|sendEmailMessage)\b/i.test(signature)) {
    return null;
  }
  return {
    emailType: 'Apex Messaging',
    label: 'Apex Email Send',
    subtitle: emailApiName(signature),
    status: 'invoked'
  };
}

function emailApiName(signature: string): string {
  return signature.match(/^Messaging\.([A-Za-z0-9_]+)/)?.[0] ?? 'Messaging email API';
}

function classifySystemAsyncApexRequest(signature: string): AsyncApexDefinition | null {
  if (/^System\.enqueueJob\b/i.test(signature)) {
    return {
      asyncType: 'Queueable Apex',
      label: 'Queueable Apex Job Queued',
      subtitle: 'Runs in a separate Apex transaction',
      role: 'request',
      transactionScope: 'separateApexTransaction',
      verb: 'queued'
    };
  }

  if (/^System\.Future\b/i.test(signature) && /enqueue|invoke|call/i.test(signature)) {
    return {
      asyncType: 'Future Method',
      label: 'Future Method Queued',
      subtitle: 'Runs in a separate Apex transaction',
      role: 'request',
      transactionScope: 'separateApexTransaction',
      verb: 'queued'
    };
  }

  if (/^Database\.executeBatch\b/i.test(signature)) {
    return {
      asyncType: 'Batch Apex',
      label: 'Batch Apex Started',
      subtitle: 'Runs as one or more Async Apex transactions',
      role: 'request',
      transactionScope: 'separateApexTransaction',
      verb: 'started'
    };
  }

  if (/^System\.scheduleBatch\b/i.test(signature)) {
    return {
      asyncType: 'Batch Apex',
      label: 'Batch Apex Scheduled',
      subtitle: 'Runs later as Batch Apex',
      role: 'request',
      transactionScope: 'separateApexTransaction',
      verb: 'scheduled'
    };
  }

  if (/^System\.schedule\b|^System\.scheduleBatch\b/i.test(signature)) {
    return {
      asyncType: 'Scheduled Apex',
      label: 'Scheduled Apex Scheduled',
      subtitle: 'Runs later in a separate Apex transaction',
      role: 'request',
      transactionScope: 'separateApexTransaction',
      verb: 'scheduled'
    };
  }

  return null;
}

function parseWorkflowEmailSent(fields: string[]): { reference?: string; recipients?: string; ccEmails?: string } {
  return {
    reference: readLabeledText(fields, 'Reference'),
    recipients: readLabeledText(fields, 'Recipients'),
    ccEmails: readLabeledText(fields, 'CcEmails')
  };
}

function parseCalloutRequest(eventType: string, fields: string[]): CalloutInfo {
  const text = fields.join('|');
  const values = parseCalloutKeyValues(text);
  const endpoint = extractEndpoint(text);
  const namedCredential = values.get('Named Credential Name') ?? extractNamedCredential(text);
  const endpointHost = endpoint ? endpointDisplayHost(endpoint) : namedCredential;
  const method = values.get('Method')?.toUpperCase() ?? extractHttpMethod(text) ?? 'HTTP';
  const label = endpointHost ? `Callout to ${endpointHost}` : eventType === 'NAMED_CREDENTIAL_REQUEST' ? 'Named Credential Callout' : 'HTTP Callout';
  return {
    label,
    subtitle: `${method} request`,
    rawText: text,
    sourceLine: parseSourceLine(fields[0]),
    endpoint,
    endpointRedacted: endpoint ? redactSensitiveEndpoint(endpoint) : undefined,
    endpointHost,
    method,
    namedCredential,
    namedCredentialId: values.get('Named Credential Id'),
    namedCredentialName: values.get('Named Credential Name'),
    externalCredentialType: values.get('External Credential Type'),
    authorizationSummary: sanitizeAuthorizationSummary(values.get('HTTP Header Authorization')),
    contentType: values.get('Content-Type'),
    requestSizeBytes: readCalloutNumber(values.get('Request Size bytes')),
    retryOn401: values.get('Retry on 401')
  };
}

function parseCalloutResponse(eventType: string, fields: string[]): CalloutInfo {
  const text = fields.join('|');
  const values = parseCalloutKeyValues(text);
  const endpoint = extractEndpoint(text);
  const namedCredential = values.get('Named Credential Name') ?? extractNamedCredential(text);
  const endpointHost = endpoint ? endpointDisplayHost(endpoint) : namedCredential;
  const statusCode = values.get('StatusCode') ?? values.get('Status Code') ?? extractStatusCode(text);
  const status = values.get('Status') ?? extractStatusText(text) ?? (statusCode ? `HTTP ${statusCode}` : undefined);
  const label = endpointHost ? `Callout to ${endpointHost}` : eventType === 'NAMED_CREDENTIAL_RESPONSE' ? 'Named Credential Callout' : 'HTTP Callout';
  return {
    label,
    subtitle: status ?? 'response',
    rawText: text,
    sourceLine: parseSourceLine(fields[0]),
    endpoint,
    endpointRedacted: endpoint ? redactSensitiveEndpoint(endpoint) : undefined,
    endpointHost,
    status,
    statusCode,
    namedCredential,
    namedCredentialId: values.get('Named Credential Id'),
    namedCredentialName: values.get('Named Credential Name'),
    contentType: values.get('Content-Type'),
    responseSizeBytes: readCalloutNumber(values.get('Response Size bytes')),
    overallCalloutTimeMs: readCalloutNumber(values.get('Overall Callout Time ms')),
    connectTimeMs: readCalloutNumber(values.get('Connect Time ms'))
  };
}

function mergeCalloutRequestNode(node: StoryNode, callout: CalloutInfo, eventType: string, fields: string[], lineNumber: number): void {
  node.label = callout.label || node.label;
  node.subtitle = callout.subtitle || node.subtitle;
  node.detail = `${node.detail ?? ''}\n${eventType}|${fields.join('|')}`.trim();
  Object.assign(node.metrics, calloutRequestMetrics(callout, eventType, lineNumber));
}

function mergeCalloutResponseNode(
  node: StoryNode,
  response: CalloutInfo,
  requestType: string,
  eventType: string,
  fields: string[],
  lineNumber: number
): void {
  node.subtitle = response.subtitle || node.subtitle;
  node.detail = `${node.detail ?? ''}\n${eventType}|${fields.join('|')}`.trim();
  node.metrics.calloutType = requestType;
  node.metrics.calloutStatus = 'response';
  Object.assign(node.metrics, calloutResponseMetrics(response, eventType, lineNumber));
  node.lineEnd = Math.max(node.lineEnd, lineNumber);
}

function calloutRequestMetrics(callout: CalloutInfo, eventType: string, lineNumber: number): Record<string, string | number | boolean> {
  const isNamedCredential = eventType === 'NAMED_CREDENTIAL_REQUEST';
  return compactMetricRecord({
    ...(isNamedCredential
      ? {
          namedCredentialRequestEventType: eventType,
          namedCredentialRequestLine: lineNumber,
          namedCredentialRequestSourceLine: callout.sourceLine,
          namedCredentialRequestSummary: callout.rawText
        }
      : {
          requestEventType: eventType,
          requestLine: lineNumber,
          requestSourceLine: callout.sourceLine,
          requestSummary: callout.rawText
        }),
    endpoint: callout.endpoint,
    endpointRedacted: callout.endpointRedacted,
    endpointHost: callout.endpointHost,
    method: callout.method,
    namedCredential: callout.namedCredential,
    namedCredentialId: callout.namedCredentialId,
    namedCredentialName: callout.namedCredentialName,
    externalCredentialType: callout.externalCredentialType,
    authorizationSummary: callout.authorizationSummary,
    requestContentType: callout.contentType,
    requestSizeBytes: callout.requestSizeBytes,
    retryOn401: callout.retryOn401
  });
}

function calloutResponseMetrics(response: CalloutInfo, eventType: string, lineNumber: number): Record<string, string | number | boolean> {
  const isNamedCredential = eventType === 'NAMED_CREDENTIAL_RESPONSE';
  return compactMetricRecord({
    ...(isNamedCredential
      ? {
          namedCredentialResponseEventType: eventType,
          namedCredentialResponseLine: lineNumber,
          namedCredentialResponseSourceLine: response.sourceLine,
          namedCredentialResponseSummary: response.rawText
        }
      : {
          responseEventType: eventType,
          responseLine: lineNumber,
          responseSourceLine: response.sourceLine,
          responseSummary: response.rawText
        }),
    endpoint: response.endpoint,
    endpointRedacted: response.endpointRedacted,
    endpointHost: response.endpointHost,
    status: response.status,
    statusCode: response.statusCode,
    namedCredential: response.namedCredential,
    namedCredentialId: response.namedCredentialId,
    namedCredentialName: response.namedCredentialName,
    responseContentType: response.contentType,
    responseSizeBytes: response.responseSizeBytes,
    overallCalloutTimeMs: response.overallCalloutTimeMs,
    connectTimeMs: response.connectTimeMs
  });
}

function compactMetricRecord(values: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== '')) as Record<string, string | number | boolean>;
}

function parseCalloutKeyValues(text: string): Map<string, string> {
  const bracketStart = text.lastIndexOf('[');
  const bracketText = (bracketStart >= 0 ? text.slice(bracketStart + 1) : text).replace(/\]$/, '');
  const values = new Map<string, string>();
  bracketText
    .split(/,\s+(?=[A-Za-z][A-Za-z0-9\s-]*(?:=|:))/)
    .map((part) => part.replace(/\]$/, '').trim())
    .forEach((part) => {
      const match = part.match(/^([^=]+)=([\s\S]*)$/);
      if (!match) {
        return;
      }
      values.set(match[1].trim(), match[2].trim());
    });
  return values;
}

function readCalloutNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(number) ? number : undefined;
}

function sanitizeAuthorizationSummary(value: string | undefined): string | undefined {
  return value
    ?.replace(/Credential:\s*([^,\]]+)/i, (_match, credential: string) =>
      /^Not set\b/i.test(credential.trim()) ? `Credential: ${credential.trim()}` : 'Credential: redacted'
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 redacted');
}

function extractEndpoint(text: string): string | undefined {
  const labeled = text.match(/\b(?:Endpoint|endpoint|URL|Url|url)\s*[:=]\s*([^,\]\s|]+)/)?.[1];
  const url = labeled ?? text.match(/\bhttps?:\/\/[^\s,\]|]+/i)?.[0] ?? text.match(/\bcallout:[^\s,\]|]+/i)?.[0];
  return url?.replace(/[)\]}.,;]+$/, '');
}

function extractNamedCredential(text: string): string | undefined {
  const match = text.match(/\bcallout:([^/\s,\]|]+)/i) ?? text.match(/\bNamed\s*Credential\s*[:=]\s*([^,\]\s|]+)/i);
  return match?.[1]?.replace(/[)\]}.,;]+$/, '');
}

function endpointDisplayHost(endpoint: string): string {
  if (/^callout:/i.test(endpoint)) {
    return endpoint.replace(/^callout:/i, '').split(/[/?#]/)[0] || 'Named Credential';
  }
  try {
    return new URL(endpoint).host || endpoint;
  } catch {
    return endpoint.length > 72 ? `${endpoint.slice(0, 69)}...` : endpoint;
  }
}

function redactSensitiveEndpoint(endpoint: string): string {
  if (!/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  try {
    const url = new URL(endpoint);
    const sensitiveKeyPattern = /(?:^|[_-])(key|token|secret|password|passwd|pwd|client_secret|access_token|refresh_token|authorization|api_key|apikey)(?:$|[_-])/i;
    url.searchParams.forEach((_, key) => {
      if (sensitiveKeyPattern.test(key)) {
        url.searchParams.set(key, 'redacted');
      }
    });
    return url.toString();
  } catch {
    return endpoint;
  }
}

function extractHttpMethod(text: string): string | undefined {
  return (
    text.match(/\b(?:Method|method)\s*[:=]\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/)?.[1] ??
    text.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(?:https?:\/\/|callout:)/i)?.[1]
  )?.toUpperCase();
}

function extractStatusCode(text: string): string | undefined {
  return (
    text.match(/\b(?:StatusCode|statusCode|Status|status)\s*[:=]\s*(\d{3})\b/)?.[1] ??
    text.match(/\bHTTP\/\d(?:\.\d)?\s+(\d{3})\b/i)?.[1] ??
    text.match(/\b(\d{3})\s+(?:OK|Created|Accepted|No Content|Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Too Many Requests|Internal Server Error)\b/i)?.[1]
  );
}

function extractStatusText(text: string): string | undefined {
  const labeled = text.match(/\b(?:Status|status|Reason|reason)\s*[:=]\s*([^,\]\|]+)/)?.[1]?.trim();
  if (labeled) {
    return labeled.length > 64 ? `${labeled.slice(0, 61)}...` : labeled;
  }
  const code = extractStatusCode(text);
  return code ? `HTTP ${code}` : undefined;
}

function readLabeledText(fields: string[], label: string): string | undefined {
  const prefix = `${label}:`;
  const value = fields.find((field) => field.trim().startsWith(prefix))?.trim().slice(prefix.length).trim();
  return value || undefined;
}

function readLabeledTextLoose(fields: string[], label: string): string | undefined {
  const prefix = `${label.toLowerCase()}:`;
  const field = fields.find((candidate) => candidate.trim().toLowerCase().startsWith(prefix));
  const value = field?.trim().slice(prefix.length).trim();
  return value || undefined;
}

function readEmbeddedEmailQueueValue(text: string, label: string): string | undefined {
  const labels = [
    'subject',
    'bccSender',
    'saveAsActivity',
    'useSignature',
    'toAddresses',
    'ccAddresses',
    'bccAddresses',
    'targetObjectId',
    'whatId',
    'templateId',
    'htmlBody',
    'plainTextBody'
  ];
  const nextLabelPattern = labels.filter((item) => item !== label).join('|');
  const pattern = new RegExp(`(?:^|[|,]\\s*)${label}:\\s*(.*?)(?=,\\s*(?:${nextLabelPattern}):|$)`, 'i');
  const value = text.match(pattern)?.[1]?.trim();
  return value || undefined;
}

function countEmailAddresses(text: string): number {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)?.length ?? 0;
}

function isFlowEmailAction(elementType: string, apiName: string): boolean {
  if (!/^FlowActionCall$/i.test(elementType)) {
    return false;
  }
  const normalized = apiName.replace(/[_-]+/g, ' ').toLowerCase();
  return /\bemail\b/.test(normalized) && /\b(send|sent|alert|notification|notify)\b/.test(normalized);
}

function isFlowSendEmailActionDetail(fields: string[]): boolean {
  const actionLabel = fields[2]?.trim() ?? '';
  const actionName = fields[3]?.trim() ?? '';
  return /^send email$/i.test(actionLabel) || /^email(?:Simple|Alert)?(?:@|$)/i.test(actionName);
}

function findRecentFlowActionCallNode(nodeById: Map<string, StoryNode>, lineNumber: number): StoryNode | undefined {
  return [...nodeById.values()]
    .filter((node) => {
      const elementType = String(node.metrics.elementType ?? '');
      return (
        /^FlowActionCall$/i.test(elementType) &&
        (node.kind === 'flowElement' || node.kind === 'email') &&
        lineNumber >= node.lineStart &&
        lineNumber - node.lineEnd <= 30
      );
    })
    .sort((a, b) => b.lineEnd - a.lineEnd || b.lineStart - a.lineStart)[0];
}

function markFlowActionAsEmail(node: StoryNode, status: string): void {
  const apiName = String(node.metrics.apiName ?? node.subtitle ?? node.label);
  node.kind = 'email';
  node.label = 'Flow Email Action';
  node.subtitle = apiName;
  node.metrics.emailType = 'Flow Email Action';
  node.metrics.emailStatus = status;
  node.metrics.elementType = 'FlowActionCall';
  node.metrics.apiName = apiName;
}

function readSourceLine(fields: string[]): number | undefined {
  const match = fields[0]?.match(/\[(\d+)\]/);
  return match ? Number(match[1]) : undefined;
}

function normalizeSignature(fields: string[], eventType: string): string {
  const nonEmpty = fields.filter(Boolean);
  if (eventType === 'CONSTRUCTOR_ENTRY') {
    const className = nonEmpty.at(-1) ?? 'Constructor';
    const init = nonEmpty.find((value) => value.includes('<init>')) ?? '<init>()';
    return `${className}.${init.replace(/\|/g, '')}`;
  }
  return nonEmpty.at(-1) ?? 'Unknown method';
}

function isMeaningfulMethod(signature: string): boolean {
  if (!signature || signature === 'Unknown method') {
    return false;
  }
  const excludedPrefixes = [
    'System.',
    'Schema.',
    'Database.QueryLocatorIterator',
    'fflib_SObjectDescribe.',
    'fflib_QueryFactory.getField',
    'fflib_QueryFactory.selectField',
    'fflib_QueryFactory.selectFields',
    'fflib_QueryFactory.setSortSelectFields'
  ];
  if (excludedPrefixes.some((prefix) => signature.startsWith(prefix))) {
    return false;
  }
  return !/\.(getSObjectType|getSObjectType2|getDescribe|getField|hasNext|next)\(/.test(signature);
}

function normalizeBusinessSignature(signature: string): string {
  return signature
    .replace(/^Class\./, '')
    .replace(/^Trigger\./, '')
    .replace(/:.*$/, '')
    .replace(/\((.*)\)$/, '')
    .trim();
}

function isBusinessBridgeMethod(signature: string): boolean {
  const normalized = normalizeBusinessSignature(signature);
  if (!normalized || !/^[A-Z][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_<>]*$/.test(normalized)) {
    return false;
  }
  const [className, methodName = ''] = normalized.split('.');
  const excludedClassPatterns = [
    /^System$/i,
    /^Schema$/i,
    /^Database$/i,
    /^String$/i,
    /^List$/i,
    /^Map$/i,
    /^Set$/i,
    /^Id$/i,
    /^SObject$/i,
    /^SObjectDomain$/i,
    /^fflib_/i
  ];
  if (excludedClassPatterns.some((pattern) => pattern.test(className))) {
    return false;
  }
  if (/^(get|set|is|has|equals|hashCode|toString|valueOf|size|iterator|add|put|remove|contains)/.test(methodName)) {
    return false;
  }
  return true;
}

function trackSystemSourceContext(
  contexts: SourceContext[],
  signature: string,
  sourceLine: number | undefined,
  parentId: string,
  logLine: number,
  ns: number
): void {
  if (sourceLine === undefined) {
    return;
  }
  const className = inferApexClassFromSystemSignature(signature);
  if (!className) {
    return;
  }

  contexts.push({
    className,
    sourceLine,
    logLine,
    ns,
    parentId,
    evidence: signature
  });

  if (contexts.length > 240) {
    contexts.splice(0, contexts.length - 240);
  }
}

function findEmailSourceContext(
  contexts: SourceContext[],
  parentId: string,
  sourceLine: number | undefined,
  ns: number,
  logLine: number
): SourceContext | undefined {
  if (sourceLine === undefined) {
    return undefined;
  }

  return contexts
    .filter((context) => {
      const sameParent = context.parentId === parentId;
      const nearbyLog = logLine >= context.logLine && logLine - context.logLine <= 900;
      const nearbyTime = ns >= context.ns && ns - context.ns <= 2_500_000_000;
      const nearbySourceLine = context.sourceLine <= sourceLine && sourceLine - context.sourceLine <= 320;
      return sameParent && nearbyLog && nearbyTime && nearbySourceLine;
    })
    .sort((a, b) => {
      const lineDelta = (sourceLine - a.sourceLine) - (sourceLine - b.sourceLine);
      return lineDelta || b.logLine - a.logLine;
    })[0];
}

function inferApexClassFromSystemSignature(signature: string): string | undefined {
  const standardOwners = new Set([
    'ApexPages',
    'ConnectApi',
    'Database',
    'EventBus',
    'JSON',
    'List',
    'Map',
    'Messaging',
    'Schema',
    'Set',
    'SObject',
    'String',
    'System',
    'Test',
    'UserInfo'
  ]);
  const nestedTypeMatches = [...signature.matchAll(/\b([A-Z][A-Za-z0-9_]*)(?:\.[A-Z][A-Za-z0-9_]+)+\b/g)];
  const match = nestedTypeMatches.find((candidate) => !standardOwners.has(candidate[1]));
  return match?.[1];
}

function formatApexSourceLocation(className: string, sourceLine: number): string {
  return `${className} line ${sourceLine}`;
}

function formatApexSourceLocationSignature(className: string, sourceLine: number): string {
  return `${className}.line${sourceLine}`;
}

function ensureCallerPath(methodStack: StackFrame[], codeUnitStack: CodeUnitInfo[]): { parentId: string; chain: string[] } {
  const parentId = currentCodeUnitId(codeUnitStack);
  const currentCodeUnit = codeUnitStack[codeUnitStack.length - 1];
  const codeUnitStartLine = currentCodeUnit?.startLine ?? 1;
  const meaningful = methodStack
    .filter((frame) => frame.line >= codeUnitStartLine && isMeaningfulMethod(frame.signature))
    .slice(-16);
  return { parentId, chain: meaningful.map((frame) => frame.signature) };
}

function compactSignature(signature: string): string {
  return signature
    .replace(/\.line(\d+)$/, ' line $1')
    .replace(/\((.*)\)$/, (match) => (match.length > 42 ? '(...)' : match));
}

function classFromSignature(signature: string): string {
  return signature.split('.')[0] ?? 'Apex';
}

function parseDml(fields: string[]): { operation: string; objectName: string; rows: number; sourceLine?: number } {
  return {
    sourceLine: parseSourceLine(fields[0]),
    operation: readStringField(fields, 'Op') ?? 'DML',
    objectName: readStringField(fields, 'Type') ?? 'SObject',
    rows: readNumericField(fields, 'Rows') ?? 0
  };
}

function parseSourceLine(value: string | undefined): number | undefined {
  const match = value?.match(/^\[(\d+)\]$/);
  return match ? Number(match[1]) : undefined;
}

function parseSoql(fields: string[]): {
  query: string;
  objectName: string;
  fieldCount: number;
  aggregations: number;
  sourceLine?: number;
} {
  const query = fields.slice(2).join('|') || fields.at(-1) || 'SELECT ...';
  const objectName = query.match(/\bFROM\s+([A-Za-z0-9_$.]+)\b/i)?.[1] ?? 'Records';
  const fieldList = query.match(/SELECT\s+([\s\S]+?)\s+FROM\s+/i)?.[1] ?? '';
  const fieldCount = fieldList ? fieldList.split(',').length : 0;
  return {
    sourceLine: parseSourceLine(fields[0]),
    query: compactQuery(query),
    objectName,
    fieldCount,
    aggregations: readNumericField(fields, 'Aggregations') ?? 0
  };
}

function compactQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

function soqlRepeatKey(parentId: string, callerChain: string[], query: string): string {
  return `${parentId}|${callerChain.join('>')}|${normalizeQueryForRepeat(query)}`;
}

function normalizeQueryForRepeat(query: string): string {
  return compactQuery(query)
    .replace(/\btmpVar\d+\b/g, 'tmpVar')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function compactPlan(plan: string): string {
  return plan.replace(/\s+/g, ' ').trim();
}

function readStringField(fields: string[], key: string): string | undefined {
  const prefix = `${key}:`;
  return fields.find((field) => field.startsWith(prefix))?.slice(prefix.length);
}

function readNumericField(fields: string[], key: string): number | undefined {
  const value = readStringField(fields, key);
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function updateLimitState(
  line: string,
  fields: string[],
  currentLimits: LimitSnapshot,
  currentLimitCeilings: LimitSnapshot,
  targetId: string,
  nodeById: Map<string, StoryNode>,
  lineNumber: number
): void {
  const parsed = parseLimitUsage(line, fields);
  if (!parsed) {
    return;
  }
  const { metricKey, used, max } = parsed;
  currentLimits[metricKey] = used;
  currentLimitCeilings[metricKey] = max;
  const node = nodeById.get(targetId);
  if (node) {
    node.lineEnd = Math.max(node.lineEnd, lineNumber);
  }
}

function attachAsyncLimitUsage(
  parsed: { metricKey: string; used: number; max: number } | null,
  stackItem: AsyncApexStackItem | undefined,
  nodeById: Map<string, StoryNode>,
  lineNumber: number
): void {
  if (!parsed || !stackItem) {
    return;
  }
  const node = nodeById.get(stackItem.id);
  if (!node || node.kind !== 'async') {
    return;
  }
  const relevantMetrics = new Set(['queuedJobs', 'futureCalls', 'maxAsync']);
  if (!relevantMetrics.has(parsed.metricKey)) {
    return;
  }
  node.metrics[parsed.metricKey] = parsed.used;
  node.metrics[`${parsed.metricKey}Limit`] = parsed.max;
  node.lineEnd = Math.max(node.lineEnd, lineNumber);
}

function updateFlowLimitMetrics(
  eventType: string,
  line: string,
  fields: string[],
  targetId: string,
  nodeById: Map<string, StoryNode>,
  lineNumber: number
): void {
  const parsed = parseLimitUsage(line, fields);
  const node = nodeById.get(targetId);
  if (!parsed || !node) {
    return;
  }
  const { metricKey, used, max } = parsed;
  const entryKey = `entry_${metricKey}`;
  if (eventType === 'FLOW_START_INTERVIEW_LIMIT_USAGE' || node.metrics[entryKey] === undefined) {
    node.metrics[entryKey] = used;
  }
  const entry = Number(node.metrics[entryKey] ?? used);
  const delta = Math.max(0, used - entry);
  node.metrics[metricKey] = eventType === 'FLOW_START_INTERVIEW_LIMIT_USAGE' ? 0 : delta;
  node.metrics[`${metricKey}Limit`] = max;
  node.metrics[`${metricKey}Snapshot`] = used;
  node.metrics.limitScope = 'Flow delta';
  node.lineEnd = Math.max(node.lineEnd, lineNumber);
}

function parseLimitUsage(line: string, fields: string[]): { metricKey: string; used: number; max: number } | null {
  if (fields.length >= 4) {
    const label = fields[1]?.trim();
    const metricKey = LIMIT_LABELS[label];
    const used = Number(fields[2]);
    const max = Number(fields[3]);
    if (metricKey && Number.isFinite(used) && Number.isFinite(max)) {
      return { metricKey, used, max };
    }
  }

  const text = fields.join('|') || line;
  const match = text.match(/([^|:]+):\s*([\d,]+)\s+out of\s+([\d,]+)/);
  if (!match) {
    return null;
  }
  const [, label, used, max] = match;
  const metricKey = LIMIT_LABELS[label.trim()];
  if (!metricKey) {
    return null;
  }
  return {
    metricKey,
    used: Number(used.replace(/,/g, '')),
    max: Number(max.replace(/,/g, ''))
  };
}

function findLastIndex<T>(values: T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) {
      return index;
    }
  }
  return -1;
}

function attachLimitDeltas(
  node: StoryNode | undefined,
  entryLimits: LimitSnapshot,
  currentLimits: LimitSnapshot,
  currentLimitCeilings: LimitSnapshot
): void {
  if (!node) {
    return;
  }
  Object.entries(currentLimits).forEach(([key, current]) => {
    const delta = current - (entryLimits[key] ?? 0);
    if (delta <= 0) {
      return;
    }
    node.metrics[key] = delta;
    if (currentLimitCeilings[key] !== undefined) {
      node.metrics[`${key}Limit`] = currentLimitCeilings[key];
    }
  });
  addPerformanceWarnings(node);
}

function addPerformanceWarnings(node: StoryNode): void {
  node.warnings = [...new Set(node.warnings ?? [])];
}

function addRelativeHotspotWarnings(nodes: StoryNode[], totalDurationMs: number, limitCeilings: LimitSnapshot): void {
  nodes.forEach((node) => {
    const warnings = new Set(node.warnings ?? []);
    addLimitShareWarning(warnings, node, 'soqlQueries', 'SOQL queries', limitCeilings);
    addLimitShareWarning(warnings, node, 'dmlStatements', 'DML statements', limitCeilings);
    addLimitShareWarning(warnings, node, 'cpuMs', 'CPU', limitCeilings, formatWarningMs);

    const duration = node.durationMs ?? 0;
    if (totalDurationMs > 0 && duration >= 500 && duration / totalDurationMs >= 0.25 && node.kind !== 'root') {
      warnings.add(`${formatWarningMs(duration)} duration, ${Math.round((duration / totalDurationMs) * 100)}% of transaction time`);
    }

    node.warnings = [...warnings];
  });
}

function addLimitShareWarning(
  warnings: Set<string>,
  node: StoryNode,
  metricKey: string,
  label: string,
  limitCeilings: LimitSnapshot,
  formatter: (value: number) => string = String
): void {
  const used = Number(node.metrics[metricKey] ?? 0);
  const limit = Number(node.metrics[`${metricKey}Limit`] ?? limitCeilings[metricKey] ?? 0);
  if (used <= 0 || limit <= 0) {
    return;
  }
  const share = used / limit;
  if (share >= 0.25) {
    warnings.add(`${formatter(used)} ${label}, ${Math.round(share * 100)}% of governor limit`);
  } else if (share >= 0.1) {
    warnings.add(`${formatter(used)} ${label}, ${Math.round(share * 100)}% of governor limit`);
  }
}

function formatWarningMs(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

function flowElementKey(interviewId: string, elementType: string, apiName: string): string {
  return `${interviewId}|${elementType}|${apiName}`;
}

function topGroups(eventCounts: Map<string, number>, allowList: Set<string>): NoiseGroup[] {
  return [...eventCounts.entries()]
    .filter(([eventType]) => allowList.has(eventType))
    .map(([eventType, count]) => ({ eventType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function mapToGroups(map: Map<string, number>): NoiseGroup[] {
  return [...map.entries()]
    .map(([eventType, count]) => ({ eventType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function topHotspots(methodCounts: Map<string, number>): Hotspot[] {
  return [...methodCounts.entries()]
    .map(([label, count]) => ({ label: compactSignature(label), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

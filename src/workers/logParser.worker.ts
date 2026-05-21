/// <reference lib="webworker" />

import { parseSalesforceLog } from '../lib/salesforceLogParser';
import type { WorkerParseRequest, WorkerParseResponse } from '../lib/types';

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerParseRequest>) => {
  if (event.data.type !== 'parse') {
    return;
  }

  try {
    const result = parseSalesforceLog(event.data.text);
    const response: WorkerParseResponse = { type: 'success', result };
    ctx.postMessage(response);
  } catch (error) {
    const response: WorkerParseResponse = {
      type: 'failure',
      message: error instanceof Error ? error.message : 'Unable to parse log'
    };
    ctx.postMessage(response);
  }
};

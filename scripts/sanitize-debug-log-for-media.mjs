import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/sanitize-debug-log-for-media.mjs <input.log> <output.log>');
  process.exit(1);
}

const SALESFORCE_TYPES = new Set([
  'Account',
  'AggregateResult',
  'Boolean',
  'Case',
  'Contact',
  'Date',
  'DateTime',
  'Decimal',
  'Double',
  'Exception',
  'Id',
  'Integer',
  'List',
  'Long',
  'Map',
  'Messaging',
  'Object',
  'Opportunity',
  'Schema',
  'Set',
  'SObject',
  'String',
  'System',
  'Task',
  'User',
  'Void'
]);

const namespaceMap = new Map();
const customObjectMap = new Map();
const fieldMap = new Map();
const classMap = new Map();
const flowMap = new Map();
const idMap = new Map();
const methodMap = new Map();
const memberMap = new Map();
const appTokenMap = new Map();

const nextName = (map, prefix, suffix = '') => {
  const index = String(map.size + 1).padStart(3, '0');
  return `${prefix}${index}${suffix}`;
};

function mapToken(map, token, prefix, suffix = '') {
  if (!map.has(token)) {
    map.set(token, nextName(map, prefix, suffix));
  }
  return map.get(token);
}

function maskId(token) {
  if (!idMap.has(token)) {
    const prefix = token.slice(0, 3);
    const index = String(idMap.size + 1).padStart(12, '0');
    idMap.set(token, `${prefix}${index}`);
  }
  return idMap.get(token);
}

function maskClass(token) {
  if (SALESFORCE_TYPES.has(token) || token.startsWith('System') || token.startsWith('Schema')) {
    return token;
  }
  return mapToken(classMap, token, 'ApexClass');
}

function maskMethod(token) {
  const safe = new Set(['add', 'clone', 'contains', 'containsKey', 'debug', 'execute', 'finish', 'get', 'isEmpty', 'keySet', 'put', 'remove', 'size', 'start', 'toString', 'values']);
  if (safe.has(token)) {
    return token;
  }
  return mapToken(methodMap, token, 'method');
}

function maskCustomName(token) {
  if (token.includes('__')) {
    const suffix = token.endsWith('__r')
      ? '__r'
      : token.endsWith('__e')
        ? '__e'
        : token.endsWith('__Share')
          ? '__Share'
          : token.endsWith('__mdt')
            ? '__mdt'
            : token.endsWith('__x')
              ? '__x'
              : '__c';
    const prefix = suffix === '__e' ? 'PlatformEvent' : suffix === '__Share' ? 'CustomObject' : 'CustomObject';
    return mapToken(customObjectMap, token, prefix, suffix);
  }
  return token;
}

function maskFlowLike(token) {
  if (/^(Flow|Process|Record|AutoLaunched|Screen|Decision|Assignment|Update|Create|Get|Loop|Subflow|Email|Route|Wait|Action)$/i.test(token)) {
    return token;
  }
  return mapToken(flowMap, token, 'FlowItem');
}

let text = await readFile(inputPath, 'utf8');

text = text
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'user@example.test')
  .replace(/\b[A-Za-z0-9._%+-]+\.com(?:\.[A-Za-z0-9.-]+)?\b/gi, 'example.test')
  .replace(/\b[a-z0-9][a-z0-9-]*\.my\.salesforce\.com\b/gi, 'example.my.salesforce.com')
  .replace(/\b[a-z0-9][a-z0-9-]*--[a-z0-9-]+\.sandbox\.my\.salesforce\.com\b/gi, 'example--sandbox.sandbox.my.salesforce.com')
  .replace(/\b[0-9A-Za-z]{15,18}\b/g, (match) => maskId(match));

// Mask namespaced custom metadata/object/field tokens before class masking.
text = text.replace(/\b([A-Za-z][A-Za-z0-9]*)__([A-Za-z][A-Za-z0-9]*__(?:c|r|e|Share|mdt|x))\b/g, (_match, namespace, name) => {
  const maskedNamespace = mapToken(namespaceMap, namespace, 'ns');
  return `${maskedNamespace}__${maskCustomName(name)}`;
});
text = text.replace(/\b[A-Za-z][A-Za-z0-9_]*__(?:c|r|e|Share|mdt|x)\b/g, (match) => maskCustomName(match));
text = text.replace(/\b[A-Za-z][A-Za-z0-9_]*__x\b/g, (match) => mapToken(customObjectMap, match, 'ExternalObject', '__x'));

// Mask Apex class names and methods in common log shapes.
text = text.replace(/\bClass\.([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)\b/g, (_match, cls, method) => `Class.${maskClass(cls)}.${maskMethod(method)}`);
text = text.replace(/\b([A-Za-z][A-Za-z0-9_]*(?:Controller|Service|Trigger|Handler|Helper|Selector|Domain|Repository|Factory|Manager|Batch|Queueable|Schedulable|Future|Util|Utility|Rule|Rules|Validator|Validation|Processor|Dispatcher|Provider|Client|Integration|Action|ControllerExtension)[A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)\b/g, (_match, cls, method) => `${maskClass(cls)}.${maskMethod(method)}`);
text = text.replace(/\b([A-Z][A-Za-z0-9_]*(?:Controller|Service|Trigger|Handler|Helper|Selector|Domain|Repository|Factory|Manager|Batch|Queueable|Schedulable|Future|Util|Utility|Rule|Rules|Validator|Validation|Processor|Dispatcher|Provider|Client|Integration|Action|ControllerExtension)[A-Za-z0-9_]*)\b/g, (_match, cls) => maskClass(cls));
text = text.replace(/ACTION\$([A-Za-z][A-Za-z0-9_]*)/g, (_match, method) => `ACTION$${maskMethod(method)}`);

// Mask Flow names and element API names while preserving event names.
text = text.replace(/(\|FLOW_[A-Z_]+\|[^|\n\r]*\|)([^|\n\r]+)/g, (_match, prefix, value) => {
  const masked = value
    .split(/([:/.()[\]\s,-]+)/)
    .map((part) => (/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(part) ? maskFlowLike(part) : part))
    .join('');
  return `${prefix}${masked}`;
});

// Mask obvious quoted identifiers in SOQL aliases and dynamic debug values.
text = text.replace(/\b[A-Z][A-Za-z0-9_]{4,}(?:_[A-Za-z0-9]+){1,}\b/g, (match) => {
  if (
    match.includes('__') ||
    /^[A-Z0-9_]+$/.test(match) ||
    match.startsWith('FLOW_') ||
    match.startsWith('CODE_') ||
    match.startsWith('SOQL_') ||
    match.startsWith('DML_') ||
    match.startsWith('USER_') ||
    match.startsWith('SYSTEM_') ||
    match.startsWith('METHOD_') ||
    match.startsWith('CUMULATIVE_')
  ) {
    return match;
  }
  return maskFlowLike(match);
});

// Final public-media scrub for org/product/domain language that can appear in USER_DEBUG,
// static field names, trigger object labels, and raw evidence snippets.
text = text
  .replace(/\bHUB_[A-Za-z0-9_]+\b/g, (match) => mapToken(appTokenMap, match, 'BusinessToken'))
  .replace(/\bHub_[A-Za-z0-9_]+\b/g, (match) => mapToken(appTokenMap, match, 'BusinessToken'))
  .replace(/__sfdc_[A-Za-z0-9_]+/g, (match) => `__sfdc_${mapToken(memberMap, match, 'member')}`)
  .replace(/_static_[A-Za-z0-9_]+/g, (match) => `_static_${mapToken(memberMap, match, 'ConfigToken')}`)
  .replace(/\bDexcom\b/gi, 'Product')
  .replace(/\bEversana\b/gi, 'ExampleCo')
  .replace(/Pharmacy/gi, 'ServiceLocation')
  .replace(/Referral/gi, 'WorkItem')
  .replace(/\bPatient\b/gi, 'Contact')
  .replace(/PSS/gi, 'SupportTeam')
  .replace(/\bBRE\b/g, 'RuleEngine')
  .replace(/\bCOVINIXGO\b/g, 'PROGRAM')
  .replace(/\bDEX\b/g, 'PROGRAM')
  .replace(/\bGALD\b/g, 'PROGRAM')
  .replace(/\bHCP\b/g, 'Role')
  .replace(/\bsaveRecords\b/gi, 'processRecords')
  .replace(/Product Assistance/gi, 'Program Update')
  .replace(/EligibilityStatus/gi, 'StatusRecord')
  .replace(/\bApheresis\b/g, 'ServiceLine');

await writeFile(outputPath, text, 'utf8');

console.log(`Wrote sanitized debug log: ${outputPath}`);
console.log(`Source: ${basename(inputPath)}`);
console.log(`Masked IDs: ${idMap.size}`);
console.log(`Masked Apex classes: ${classMap.size}`);
console.log(`Masked custom object/field tokens: ${customObjectMap.size}`);
console.log(`Masked Flow-ish names: ${flowMap.size}`);
console.log(`Masked public-media tokens: ${appTokenMap.size + memberMap.size}`);

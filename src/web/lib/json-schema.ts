/**
 * Minimal reader for the JSON Schema that the MCP SDK derives from each tool's
 * zod input schema. Only what the Tools browser renders is modelled.
 */
export interface JsonSchemaNode {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  default?: unknown;
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}

export interface SchemaField {
  name: string;
  required: boolean;
  type: string;
  description?: string;
  /** Allowed values, from `enum` on the field or on any branch of a union. */
  options: string[];
  /** Human-readable range/length/pattern hints. */
  constraints: string[];
  schema: JsonSchemaNode;
}

function branches(node: JsonSchemaNode): JsonSchemaNode[] | undefined {
  return node.anyOf ?? node.oneOf ?? node.allOf;
}

/** "string", "string[]", "string | string[]", "enum" — a short type label. */
export function describeType(node: JsonSchemaNode | undefined): string {
  if (!node) return "any";
  const union = branches(node);
  if (union?.length) {
    const parts = [...new Set(union.map(describeType))];
    return parts.join(" | ");
  }
  if (node.enum?.length) return "enum";
  if (node.const !== undefined) return typeof node.const;
  if (Array.isArray(node.type)) return node.type.join(" | ");
  if (node.type === "array") return `${describeType(node.items)}[]`;
  return node.type ?? "any";
}

/** Zod puts `.describe()` on the branch, so a union's text may live one level down. */
function resolveDescription(node: JsonSchemaNode): string | undefined {
  if (node.description) return node.description;
  for (const branch of branches(node) ?? []) {
    const found = resolveDescription(branch);
    if (found) return found;
  }
  return node.items ? resolveDescription(node.items) : undefined;
}

function collectOptions(node: JsonSchemaNode): string[] {
  if (node.enum?.length) return node.enum.map((value) => String(value));
  const union = branches(node);
  if (!union) return [];
  return union.flatMap(collectOptions);
}

function collectConstraints(node: JsonSchemaNode, prefix = ""): string[] {
  const out: string[] = [];
  const label = (text: string) => `${prefix}${text}`;

  // Zod's `.int()` emits the JS safe-integer ceiling; that is noise, not a limit.
  const maximum = node.maximum !== undefined && node.maximum < Number.MAX_SAFE_INTEGER ? node.maximum : undefined;
  if (node.minimum !== undefined && maximum !== undefined) {
    out.push(label(`${node.minimum}–${maximum}`));
  } else if (node.minimum !== undefined) out.push(label(`≥ ${node.minimum}`));
  else if (maximum !== undefined) out.push(label(`≤ ${maximum}`));
  if (node.exclusiveMinimum !== undefined) out.push(label(`> ${node.exclusiveMinimum}`));
  if (node.exclusiveMaximum !== undefined) out.push(label(`< ${node.exclusiveMaximum}`));

  if (node.minLength !== undefined && node.maxLength !== undefined) {
    out.push(label(`length ${node.minLength}–${node.maxLength}`));
  } else if (node.maxLength !== undefined) out.push(label(`max length ${node.maxLength}`));
  else if (node.minLength) out.push(label(`min length ${node.minLength}`));

  if (node.minItems !== undefined && node.maxItems !== undefined) {
    out.push(label(`${node.minItems}–${node.maxItems} items`));
  } else if (node.maxItems !== undefined) out.push(label(`max ${node.maxItems} items`));
  else if (node.minItems) out.push(label(`min ${node.minItems} items`));
  if (node.pattern) out.push(label(`pattern ${node.pattern}`));
  if (node.format) out.push(label(node.format));
  if (node.default !== undefined) out.push(`default ${JSON.stringify(node.default)}`);

  if (node.type === "array" && node.items) out.push(...collectConstraints(node.items, "item "));
  for (const branch of branches(node) ?? []) out.push(...collectConstraints(branch, prefix));

  return [...new Set(out)];
}

/** Flattens a tool's input schema into one row per top-level parameter. */
export function schemaFields(schema: JsonSchemaNode | undefined): SchemaField[] {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);

  return Object.entries(properties).map(([name, node]) => ({
    name,
    required: required.has(name),
    type: describeType(node),
    description: resolveDescription(node),
    options: collectOptions(node),
    constraints: collectConstraints(node),
    schema: node,
  }));
}

/**
 * A minimal, dependency-free view over what `fast-xml-parser` returns.
 *
 * With `parseTagValue: false` every leaf is a string, an element is an object
 * keyed by child name, and a repeated child is an array. That is enough to walk
 * a document without pulling in a DOM, and keeping the helpers here means the
 * parser and the profiles agree on one traversal semantic.
 */

export type XmlScalar = string;
export type XmlObject = { [key: string]: XmlValue };
export type XmlValue = XmlScalar | XmlObject | XmlValue[];

/** A path of element names from some starting node, e.g. `['TTChung','SHDon']`. */
export type XmlPath = readonly string[];
/** Ordered candidate paths; the first one that yields a value wins. */
export type XmlCandidates = readonly XmlPath[];

function isObject(value: XmlValue): value is XmlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** All direct children called `name`, flattening repeated elements. */
export function childrenOf(value: XmlValue | undefined, name: string): XmlValue[] {
  if (value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => childrenOf(entry, name));
  }

  if (!isObject(value)) {
    return [];
  }

  const child = value[name];

  if (child === undefined) {
    return [];
  }

  return Array.isArray(child) ? child : [child];
}

/** Every node reachable by following `path` from `root`. */
export function resolveAll(root: XmlValue, path: XmlPath): XmlValue[] {
  return path.reduce<XmlValue[]>(
    (nodes, name) => nodes.flatMap((node) => childrenOf(node, name)),
    [root],
  );
}

/**
 * First non-empty text at any of the candidate paths.
 *
 * Candidates exist because providers disagree on names for the same concept
 * (`TgTTTBSo` vs `TongTien`); the order in the profile expresses preference.
 */
export function firstText(root: XmlValue, candidates: XmlCandidates): string | null {
  for (const path of candidates) {
    for (const node of resolveAll(root, path)) {
      if (typeof node === 'string') {
        const trimmed = node.trim();

        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
  }

  return null;
}

/** Number of elements called `name` anywhere in the tree. */
export function countElements(root: XmlValue, name: string): number {
  if (Array.isArray(root)) {
    return root.reduce((total, entry) => total + countElements(entry, name), 0);
  }

  if (!isObject(root)) {
    return 0;
  }

  let total = 0;

  for (const [key, child] of Object.entries(root)) {
    if (key === name) {
      total += Array.isArray(child) ? child.length : 1;
    }

    total += countElements(child, name);
  }

  return total;
}

export interface TreeMetrics {
  nodes: number;
  maxDepth: number;
}

/**
 * Node count and depth, used to bound work before any deep traversal.
 *
 * Iterative on purpose: a recursive walk over a deeply nested document would
 * overflow the stack, which is itself a denial-of-service vector.
 */
export function measureTree(root: XmlValue): TreeMetrics {
  let nodes = 0;
  let maxDepth = 0;
  const stack: Array<{ value: XmlValue; depth: number }> = [{ value: root, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();

    if (current === undefined) {
      break;
    }

    const { value, depth } = current;

    if (Array.isArray(value)) {
      nodes += value.length;
      maxDepth = Math.max(maxDepth, depth);

      for (const entry of value) {
        stack.push({ value: entry, depth });
      }

      continue;
    }

    if (isObject(value)) {
      nodes += 1;
      maxDepth = Math.max(maxDepth, depth);

      for (const child of Object.values(value)) {
        stack.push({ value: child, depth: depth + 1 });
      }

      continue;
    }

    nodes += 1;
  }

  return { nodes, maxDepth };
}

/** Top-level element name of a parsed document, or null. */
export function rootElementName(root: XmlValue): string | null {
  if (!isObject(root)) {
    return null;
  }

  const keys = Object.keys(root).filter((key) => !key.startsWith('?'));

  return keys.length === 1 ? (keys[0] ?? null) : null;
}

// Offline, flow-insensitive prototype. No facts from this module authorize a
// runtime optimization: unknown calls and escaping lazy values remain barriers.
export function children(node) {
  return Object.entries(node).filter(([key]) => !key.startsWith('$'))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter(value => value && typeof value === 'object' && '$type' in value);
}

function names(node) {
  return [node.$type === 'NameExpression' ? node.name : undefined,
    ...children(node).flatMap(names)].filter(Boolean);
}

export function analyzeFunction(fn) {
  const facts = new Map();
  const fact = name => {
    if (!facts.has(name)) facts.set(name, { name, writes: 0, loopWrite: false,
      freshArray: false, aliases: new Set([name]), dependencies: new Set(), reasons: new Set() });
    return facts.get(name);
  };
  for (const name of fn.parameters) fact(name).writes++;
  const nodes = [];
  function visit(node, loop = false) {
    nodes.push([node, loop]);
    if (node.$type === 'FunctionStatement') return;
    for (const child of children(node)) visit(child, loop || node.$type === 'ForStatement');
  }
  for (const statement of fn.statements) visit(statement);
  for (const [node, loop] of nodes) {
    if (node.$type === 'ForStatement' && node.condition?.operator === 'in') {
      for (const name of names(node.condition.left)) {
        const item = fact(name); item.writes++; item.loopWrite = true;
        for (const dependency of names(node.condition.right)) item.dependencies.add(dependency);
      }
    }
    if (node.$type === 'AssignmentStatement' || node.$type === 'UnpackStatement') {
      for (const name of node.names ?? [node.name]) {
        const item = fact(name);
        item.writes++; item.loopWrite ||= loop;
        item.freshArray ||= node.$type === 'AssignmentStatement' && node.value.$type === 'ArrayExpression';
      }
    }
  }
  const mark = (references, reason) => {
    for (const name of references) if (facts.has(name)) fact(name).reasons.add(reason);
  };
  for (const [node] of nodes) {
    if (node.$type === 'AssignmentStatement' || node.$type === 'UnpackStatement') {
      const references = names(node.value);
      for (const name of node.names ?? [node.name]) {
        for (const reference of references) fact(name).dependencies.add(reference);
        if (node.$type === 'AssignmentStatement' && node.operator === '=') {
          let value = node.value;
          while (value.$type === 'ParenthesizedExpression') value = value.value;
          if (value.$type === 'NameExpression') {
            fact(name).aliases.add(value.name);
            if (facts.has(value.name)) fact(value.name).aliases.add(name);
            else fact(name).reasons.add('nonlocal alias');
          }
        } else mark([name, ...references], 'compound or unpack assignment');
      }
    }
    if (node.$type === 'ArrayAssignmentStatement') {
      mark([node.name], 'content write'); mark(names(node.value), 'stored through address');
    }
    if (node.$type === 'PushStatement') {
      mark(names(node.receiver), 'container mutation'); mark(names(node.value), 'stored in container');
    }
    if (node.$type === 'IndexAssignmentStatement' || node.$type === 'AddStatement') mark(names(node), 'stored in container');
    if (node.$type === 'ApplicationExpression') mark(names(node), 'unknown application');
    if (node.$type === 'ArrayExpression' || node.$type === 'RecordExpression') mark(names(node), 'stored in container');
    if (['ReturnStatement', 'YieldStatement', 'ExpressionStatement'].includes(node.$type)) mark(names(node), 'result escape');
    if (node.$type === 'FunctionStatement') mark(names(node), 'closure capture');
  }
  // Alias relations are symmetric; reachability through iteration or a lazy value is
  // directional. Iterate to a fixed point so later aliases cannot hide writes.
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of facts.values()) {
      for (const alias of item.aliases) {
        const other = facts.get(alias);
        if (!other) continue;
        for (const name of other.aliases) if (!item.aliases.has(name)) { item.aliases.add(name); changed = true; }
        for (const reason of other.reasons) if (!item.reasons.has(reason)) { item.reasons.add(reason); changed = true; }
      }
      if (item.reasons.size) for (const dependency of item.dependencies) {
        const other = facts.get(dependency);
        if (other && !other.reasons.has('reachable from affected value')) {
          other.reasons.add('reachable from affected value'); changed = true;
        }
      }
    }
  }
  return [...facts.values()].map(item => ({ name: item.name, writes: item.writes,
    loopWrite: item.loopWrite, freshArray: item.freshArray,
    aliases: [...item.aliases].sort(), reasons: [...item.reasons].sort(),
    candidate: item.freshArray && item.writes === 1 && !item.loopWrite && item.reasons.size === 0,
  }));
}

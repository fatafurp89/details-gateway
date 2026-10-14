import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog, buildTree, branchKeys, unreviewedNodes, checkProxyKey, defaultKind } from '../src/lib/perms.js';

const catalog = {
  system: 'hr',
  nodes: [
    { key: 'hr.employees', label_ar: 'ملفات الموظفين', kind: 'module', sort: 10 },
    { key: 'hr.employees.list', label_ar: 'قائمة الموظفين', sort: 1 },
    { key: 'hr.employees.list.edit', label_ar: 'تعديل', description_ar: 'تعديل بيانات الموظف' },
    { key: 'hr.payroll', label_ar: 'الرواتب', kind: 'module', sort: 20 },
    { key: 'hr.payroll.approve', label_ar: 'اعتماد الصرف', parent_key: 'hr.payroll', kind: 'action' },
  ],
};

test('catalog: valid payload is normalized, root synthesized, parents first, kinds derived from depth', () => {
  const { value, error } = validateCatalog(catalog);
  assert.equal(error, undefined);
  assert.equal(value.system, 'hr');
  assert.equal(value.nodes[0].key, 'hr');
  assert.equal(value.nodes[0].kind, 'system');
  assert.equal(value.nodes[0].parent_key, null);
  const byKey = Object.fromEntries(value.nodes.map((n) => [n.key, n]));
  assert.equal(byKey['hr.employees.list'].kind, 'screen');
  assert.equal(byKey['hr.employees.list'].parent_key, 'hr.employees');
  assert.equal(byKey['hr.employees.list.edit'].kind, 'action');
  assert.equal(byKey['hr.employees.list.edit'].description_ar, 'تعديل بيانات الموظف');
  assert.equal(byKey['hr.payroll.approve'].sort, 100);
  // every parent appears before its child
  const seen = new Set();
  for (const n of value.nodes) { if (n.parent_key) assert.ok(seen.has(n.parent_key), n.key); seen.add(n.key); }
  assert.equal(defaultKind(7), 'action');
});

test('catalog: root label from payload wins, system key is lower-cased', () => {
  const { value } = validateCatalog({ system: 'HR', nodes: [{ key: 'hr', label_ar: 'الموارد البشرية', kind: 'system' }] });
  assert.equal(value.nodes.length, 1);
  assert.equal(value.nodes[0].label_ar, 'الموارد البشرية');
});

test('catalog: rejects bad shapes', () => {
  const bad = (body) => assert.ok(validateCatalog(body).error, JSON.stringify(body));
  bad(null);
  bad({ system: 'x', nodes: [] });
  bad({ system: 'hr' });
  bad({ system: 'hr', nodes: [{ key: 'HR Employees', label_ar: 'x' }] });
  bad({ system: 'hr', nodes: [{ key: 'wms.cases', label_ar: 'x' }] });          // other system
  bad({ system: 'hr', nodes: [{ key: 'hr.a', label_ar: '' }] });                  // no label
  bad({ system: 'hr', nodes: [{ key: 'hr.a', label_ar: 'أ' }, { key: 'hr.a', label_ar: 'ب' }] }); // duplicate
  bad({ system: 'hr', nodes: [{ key: 'hr.a', label_ar: 'أ', kind: 'tab' }] });   // bad kind
  bad({ system: 'hr', nodes: [{ key: 'hr.a.b', label_ar: 'أ', parent_key: 'hr.c' }] }); // parent not a prefix
  bad({ system: 'hr', nodes: [{ key: 'hr.a.b', label_ar: 'أ', parent_key: 'hr.a' }] }); // parent missing from catalog
  bad({ system: 'hr', nodes: [{ key: 'hr', label_ar: 'x', kind: 'module' }] });  // root must be system
  bad({ system: 'hr', nodes: Array.from({ length: 5001 }, (_, i) => ({ key: `hr.n${i}`, label_ar: 'x' })) });
});

const rows = [
  { key: 'hr', system_key: 'hr', parent_key: null, label_ar: 'HR', kind: 'system', sort: 30, present: true, grantees: 2 },
  { key: 'hr.payroll', system_key: 'hr', parent_key: 'hr', kind: 'module', sort: 20, present: true, grantees: 0 },
  { key: 'hr.employees', system_key: 'hr', parent_key: 'hr', kind: 'module', sort: 10, present: true, grantees: 1 },
  { key: 'hr.employees.list', system_key: 'hr', parent_key: 'hr.employees', kind: 'screen', sort: 1, present: true, grantees: 1 },
  { key: 'hr.employees.list.edit', system_key: 'hr', parent_key: 'hr.employees.list', kind: 'action', sort: 100, present: false, grantees: 0 },
  { key: 'hr.orphan.x', system_key: 'hr', parent_key: 'hr.orphan', kind: 'screen', sort: 5, present: true, grantees: 0 },
  { key: 'wms', system_key: 'wms', parent_key: null, kind: 'system', sort: 10, present: true, grantees: 0 },
];

test('tree: roots sorted, children nested and sorted, orphans attach to their system root', () => {
  const tree = buildTree(rows);
  assert.deepEqual(tree.map((n) => n.key), ['wms', 'hr']);
  const hr = tree[1];
  assert.deepEqual(hr.children.map((n) => n.key), ['hr.orphan.x', 'hr.employees', 'hr.payroll']);
  assert.deepEqual(hr.children[1].children[0].children.map((n) => n.key), ['hr.employees.list.edit']);
  assert.equal(rows[0].children, undefined, 'input rows are not mutated');
});

test('branch keys: whole subtree, present nodes only by default', () => {
  assert.deepEqual(branchKeys(rows, 'hr.employees'), ['hr.employees', 'hr.employees.list']);
  assert.deepEqual(branchKeys(rows, 'hr.employees', { presentOnly: false }), ['hr.employees', 'hr.employees.list', 'hr.employees.list.edit']);
  assert.deepEqual(branchKeys(rows, 'hr.payroll'), ['hr.payroll']);
  assert.deepEqual(branchKeys(rows, 'nope'), []);
});

test('unreviewed: present nodes with no grantees', () => {
  assert.deepEqual(unreviewedNodes(rows).map((n) => n.key), ['hr.payroll', 'hr.orphan.x', 'wms']);
});

test('proxy key: unconfigured env rejects everything, else constant-time match', () => {
  const k = 'k'.repeat(48);
  assert.equal(checkProxyKey(k, ''), 'unconfigured');
  assert.equal(checkProxyKey(k, undefined), 'unconfigured');
  assert.equal(checkProxyKey(k, 'short'), 'unconfigured');
  assert.equal(checkProxyKey(k, k), 'ok');
  assert.equal(checkProxyKey(k + 'x', k), 'denied');
  assert.equal(checkProxyKey(undefined, k), 'denied');
  assert.equal(checkProxyKey(['a'], k), 'denied');
});

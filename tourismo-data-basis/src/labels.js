export const ROLES = [
  { value: 'member', label: 'Member', hint: 'Creates changes, works on tasks' },
  { value: 'manager', label: 'Manager', hint: 'Plus: edits hotels and the matrix, reassigns and cancels tasks' },
  { value: 'admin', label: 'Admin', hint: 'Plus: manages team accounts and systems' },
];
export const roleLabel = (r) => ROLES.find((x) => x.value === r)?.label ?? r;

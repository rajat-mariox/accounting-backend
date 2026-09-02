// Single source of truth for the permission system.
// A user's `permissions` document maps module -> array of granted actions,
// e.g. { invoices: ['view', 'create', 'edit'], payments: ['view', 'create'] }.
// Administrators always have every permission regardless of what is stored.

const MODULES = {
  dashboard: ['view'],
  clients: ['view', 'create', 'edit', 'delete'],
  suppliers: ['view', 'create', 'edit', 'delete'],
  inventory: ['view', 'create', 'edit', 'delete'],
  invoices: ['view', 'create', 'edit', 'delete'],
  payments: ['view', 'create', 'delete'],
  reports: ['view'],
  users: ['view', 'create', 'edit', 'delete'],
  settings: ['view', 'edit'],
  auditLogs: ['view'],
};

function fullPermissions() {
  const out = {};
  for (const [module, actions] of Object.entries(MODULES)) {
    out[module] = [...actions];
  }
  return out;
}

function viewOnlyPermissions() {
  const out = {};
  for (const module of Object.keys(MODULES)) {
    out[module] = ['view'];
  }
  return out;
}

const ROLE_PRESETS = {
  Administrator: fullPermissions(),
  Manager: viewOnlyPermissions(),
  Accountant: {
    dashboard: ['view'],
    clients: ['view', 'create'],
    invoices: ['view', 'create', 'edit'],
    payments: ['view', 'create'],
    reports: ['view'],
  },
  // Portal login for a client: sees only their own invoices and payments
  // (controllers scope the queries by req.user.client).
  Client: {
    invoices: ['view'],
    payments: ['view'],
  },
};

// Keep only known modules/actions from arbitrary client input.
function sanitizePermissions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const [module, actions] of Object.entries(input)) {
    if (!MODULES[module] || !Array.isArray(actions)) continue;
    const valid = actions.filter((action) => MODULES[module].includes(action));
    if (valid.length > 0) out[module] = [...new Set(valid)];
  }
  return out;
}

// The permissions that actually apply to a user:
// admins get everything; otherwise stored permissions, falling back to the
// role preset for users created before the permission system existed.
function effectivePermissions(user) {
  if (!user) return {};
  if (user.role === 'Administrator') return fullPermissions();
  const stored = user.permissions;
  if (stored && typeof stored === 'object' && Object.keys(stored).length > 0) {
    return sanitizePermissions(stored);
  }
  return ROLE_PRESETS[user.role] ? { ...ROLE_PRESETS[user.role] } : {};
}

function hasPermission(user, module, action) {
  if (!user) return false;
  if (user.role === 'Administrator') return true;
  const granted = effectivePermissions(user)[module];
  return Array.isArray(granted) && granted.includes(action);
}

module.exports = {
  MODULES,
  ROLE_PRESETS,
  sanitizePermissions,
  effectivePermissions,
  hasPermission,
};

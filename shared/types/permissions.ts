export const PERMISSIONS = {
  // Tenant
  TENANT_MANAGE: "tenant:manage",
  TENANT_VIEW: "tenant:view",

  // User
  USER_MANAGE: "user:manage",
  USER_VIEW: "user:view",

  // Role
  ROLE_MANAGE: "role:manage",
  ROLE_VIEW: "role:view",

  // Machine
  MACHINE_READ: "machine:read",
  MACHINE_WRITE: "machine:write",

  // Product
  PRODUCT_READ: "product:read",
  PRODUCT_WRITE: "product:write",

  // Slot
  SLOT_MANAGE: "slot:manage",

  // Sale
  SALE_READ: "sale:read",
  SALE_REFUND: "sale:refund",

  // Alert
  ALERT_READ: "alert:read",
  ALERT_RESOLVE: "alert:resolve",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

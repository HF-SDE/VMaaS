export const PERMISSIONS = {
  TENANT_MANAGE: "tenant:manage",
  TENANT_VIEW: "tenant:view",
  USER_MANAGE: "user:manage",
  USER_VIEW: "user:view",
  MACHINE_READ: "machine:read",
  MACHINE_WRITE: "machine:write",
  PRODUCT_READ: "product:read",
  PRODUCT_WRITE: "product:write",
  SLOT_MANAGE: "slot:manage",
  SALE_READ: "sale:read",
  SALE_REFUND: "sale:refund",
  ALERT_READ: "alert:read",
  ALERT_RESOLVE: "alert:resolve",
} as const

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

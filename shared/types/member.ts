export interface GetMembersParams {
  page?: number; // 0-based
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
}

/**
 * A member row is a `UserRole` joined to its user, so none of these three is a
 * column on `user_roles` itself: `name` and `email` sort through the `user`
 * relation and `role` sorts by the role's name rather than by the `roleId`
 * uuid — see `getMembersPageService`.
 */
export const MEMBER_SORT_FIELDS = ["name", "email", "role", "createdAt"] as const;
export type MemberSortField = (typeof MEMBER_SORT_FIELDS)[number];

export interface GetPaginatedResult<T> {
  data: T[];
  page: number; // 0-based
  pageSize: number;
  pageCount: number;
  totalCount: number;
}

import { StockRow } from "../types/stock-row";

function getStockRowsSize(stockRows: StockRow[]) {
  if (stockRows.length === 0) {
    return {
      width: 0,
      height: 0,
    };
  }

  // Find the outermost coordinates used by all rows
  const minX = Math.min(...stockRows.map((row) => Math.min(row.x_start, row.x_end)));

  const maxX = Math.max(...stockRows.map((row) => Math.max(row.x_start, row.x_end)));

  const minY = Math.min(...stockRows.map((row) => Math.min(row.y_start, row.y_end)));

  const maxY = Math.max(...stockRows.map((row) => Math.max(row.y_start, row.y_end)));

  // +1 because both the start and end slots are included
  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function getBounds(stockRows: StockRow[]) {
  if (stockRows.length === 0) return null;

  // Get the smallest rectangle that contains all stock rows
  const minX = Math.min(...stockRows.flatMap((r) => [r.x_start, r.x_end]));

  const maxX = Math.max(...stockRows.flatMap((r) => [r.x_start, r.x_end]));

  const minY = Math.min(...stockRows.flatMap((r) => [r.y_start, r.y_end]));

  const maxY = Math.max(...stockRows.flatMap((r) => [r.y_start, r.y_end]));

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function normalize(row: StockRow) {
  // Makes the rest of the code work no matter which direction start/end are saved
  return {
    minX: Math.min(row.x_start, row.x_end),
    maxX: Math.max(row.x_start, row.x_end),
    minY: Math.min(row.y_start, row.y_end),
    maxY: Math.max(row.y_start, row.y_end),
  };
}

export function contains(row: StockRow, x: number, y: number): boolean {
  const { minX, maxX, minY, maxY } = normalize(row);

  // Check if the slot is inside the row's rectangle
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

export function intersects(a: StockRow, b: StockRow): boolean {
  const A = normalize(a);
  const B = normalize(b);

  // Two rectangles overlap if their ranges overlap on both axes
  return A.minX <= B.maxX && A.maxX >= B.minX && A.minY <= B.maxY && A.maxY >= B.minY;
}

/**
 * ML Kit reports text as blocks and lines with bounding boxes, not as the rows
 * a human sees. On a receipt the product names sit in a left column and the
 * prices in a right one, far enough apart that they land in separate blocks —
 * so `result.text` can read "AirPods Pro" and "$249.00" as unrelated lines.
 *
 * This rebuilds the visual rows from the boxes: lines whose vertical centres
 * line up belong to the same row, ordered left to right. Everything downstream
 * can then parse plain "description ... price" rows.
 */

export type OcrLine = {
  text: string;
  /** Bounding box, in image pixels. */
  top: number;
  height: number;
  left: number;
};

/** Two lines share a row when their centres are closer than this much of a line height. */
const ROW_TOLERANCE = 0.6;

export function reconstructRows(lines: OcrLine[]): string[] {
  const usable = lines.filter((line) => line.text.trim().length > 0);
  if (usable.length === 0) return [];

  const centred = usable
    .map((line) => ({ ...line, centre: line.top + line.height / 2 }))
    .sort((a, b) => a.centre - b.centre);

  const rows: (typeof centred)[] = [];

  for (const line of centred) {
    const current = rows[rows.length - 1];
    if (current) {
      // Compare against the row's tallest line so a small price doesn't drift
      // away from a taller product name on the same row.
      const reference = Math.max(...current.map((entry) => entry.height));
      const rowCentre = current.reduce((sum, entry) => sum + entry.centre, 0) / current.length;
      if (Math.abs(line.centre - rowCentre) <= reference * ROW_TOLERANCE) {
        current.push(line);
        continue;
      }
    }
    rows.push([line]);
  }

  return rows.map((row) =>
    row
      .sort((a, b) => a.left - b.left)
      .map((entry) => entry.text.trim())
      .join('   '),
  );
}

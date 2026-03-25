/**
 * Parses a JSON string with an actionable error message on failure.
 *
 * @param text  The string to parse.
 * @param label A human-readable label describing the source of the JSON
 *              (e.g., "dashboard JSON from S3 asset"). Included in the
 *              error message to help operators diagnose deploy failures.
 */
export function safeJsonParse(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const preview = text.length > 100 ? text.slice(0, 100) + '...' : text;
    throw new Error(
      `Failed to parse ${label}: ${err instanceof SyntaxError ? err.message : err}. ` +
      `Input starts with: ${preview}`,
    );
  }
}

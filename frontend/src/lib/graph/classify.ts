/**
 * File categories are derived from the path, so they need no schema change and work the same
 * for demo data and real analysis. The order is the shader's pattern index: don't reorder.
 */
export const FILE_CATEGORIES = ["source", "test", "config", "docs", "style", "data"] as const;

export type FileCategory = (typeof FILE_CATEGORIES)[number];

const TEST_PATTERNS = [
  /(^|\/)(__tests__|tests?|specs?|e2e)\//,
  /\.(test|spec)\.[^./]+$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(py|go)$/,
];
const DOCS_PATTERNS = [
  /\.(md|mdx|rst|adoc|txt)$/,
  /(^|\/)docs?\//,
  /(^|\/)(LICENSE|CHANGELOG)[^/]*$/,
];
const STYLE_PATTERN = /\.(css|scss|sass|less|styl)$/;
const CONFIG_PATTERNS = [
  /(^|\/)(package(-lock)?\.json|tsconfig[^/]*\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock)$/,
  /(^|\/)(Dockerfile[^/]*|Makefile|\.gitignore|\.editorconfig|\.env[^/]*)$/,
  /(^|\/)\.[^/]*rc(\.[^/]+)?$/,
  /\.config\.[^./]+$/,
  /\.(toml|ya?ml|ini|cfg)$/,
];
const DATA_PATTERN = /\.(json|csv|tsv|sql|xml|graphql|gql|proto|parquet)$/;

export function classifyFile(path: string): FileCategory {
  if (TEST_PATTERNS.some((pattern) => pattern.test(path))) return "test";
  if (DOCS_PATTERNS.some((pattern) => pattern.test(path))) return "docs";
  if (STYLE_PATTERN.test(path)) return "style";
  if (CONFIG_PATTERNS.some((pattern) => pattern.test(path))) return "config";
  if (DATA_PATTERN.test(path)) return "data";
  return "source";
}

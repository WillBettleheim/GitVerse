import merge from "lodash/merge";
import { join } from "path";
import { scoped } from "@acme/tools/sub";

export function helper(a = true, b = false): boolean {
  if (a && b) {
    return true;
  }
  for (const part of [join("a", "b")]) {
    if (part || merge) return false;
  }
  return scoped ?? false;
}

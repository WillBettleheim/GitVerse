import { helper } from "@/utils/helper";
import { log } from "./utils";

/* A component and a store. */
export function App() {
  log("render");
  return <div>{helper() ? "yes" : "no"}</div>;
}

export class Store {
  items: string[] = [];
  add(item: string) {
    if (item) this.items.push(item);
  }
}

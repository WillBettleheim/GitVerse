import { App } from "./app";
import type { Config } from "./types";
import "./styles.css";
import fs from "node:fs";
import React from "react";
import missing from "./missing";

export * from "./utils";

// Loaded on demand.
export const lazy = () => import("./lazy");

export default function main(config: Config) {
  return [App, fs, React, missing, config];
}

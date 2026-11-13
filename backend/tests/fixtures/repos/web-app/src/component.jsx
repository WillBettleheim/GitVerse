import { App } from "./app";

export default function Wrapper({ show }) {
  return show ? <App /> : null;
}

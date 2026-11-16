import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col bg-void">
      <header className="flex h-14 items-center border-b border-line px-4">
        <Logo />
      </header>
      <main className="grid flex-1 place-items-center px-6 text-center">
        <div className="max-w-md">
          <p className="font-mono text-xs tracking-wide text-cyan">404</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            This page isn’t on the map.
          </h1>
          <p className="mt-3 text-muted">
            Check the address, or start from a repository on the home page.
          </p>
          <div className="mt-6 flex justify-center gap-4 text-sm">
            <Link
              href="/"
              className="rounded-md bg-text px-4 py-2 font-medium text-void hover:bg-cyan"
            >
              Go home
            </Link>
            <Link href="/explore/demo" className="px-4 py-2 text-muted hover:text-text">
              Open the demo city
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

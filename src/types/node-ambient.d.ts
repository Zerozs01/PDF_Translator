declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding?: string): string;
  export function statSync(path: string): { size: number; isFile(): boolean };
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
}

declare namespace NodeJS {
  type Timeout = any;
}

declare var process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};

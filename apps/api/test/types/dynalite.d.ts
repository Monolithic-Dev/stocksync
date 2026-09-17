declare module "dynalite" {
  interface DynaliteServer {
    listen(port: number, callback: (err?: Error) => void): void;
    close(callback: () => void): void;
  }

  interface DynaliteOptions {
    createTableMs?: number;
    path?: string;
  }

  function dynalite(options?: DynaliteOptions): DynaliteServer;
  export default dynalite;
}

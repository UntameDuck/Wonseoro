/** Fastify content-type parser 로 등록한다. parseAs: 'buffer' 여야 한다. */
export declare function strictJsonParser(req: unknown, body: Buffer, done: (err: Error | null, value?: unknown) => void): void;

import type { IncomingMessage } from "node:http";

export async function readRawBody(req: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk) => {
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bufferChunk.length;
      if (total > maxBodyBytes) {
        reject(new Error(`request body exceeded maxBodyBytes=${maxBodyBytes}`));
        req.destroy();
        return;
      }
      chunks.push(bufferChunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      reject(error);
    });
    req.on("aborted", () => {
      reject(new Error("request aborted"));
    });
  });
}

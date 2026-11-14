import { ManagedIdentityCredential } from "@azure/identity";
import { BlobServiceClient, type BlockBlobClient } from "@azure/storage-blob";
import type { ConditionalAccountBlob } from "../../shared/token-accounts.js";
import { TokenAccountStoreError } from "../../shared/token-accounts.js";

async function streamToString(stream: NodeJS.ReadableStream | undefined): Promise<string> {
  if (!stream) throw new TokenAccountStoreError("Stored account data is unavailable.", 503);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isBlobFailure(error: unknown, status: number): boolean {
  return typeof error === "object" && error !== null && "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === status;
}

export function getTokenBlobName(env: NodeJS.ProcessEnv = process.env): string {
  return env["AZURE_TOKEN_BLOB"] || "accounts.json";
}

export class AzureConditionalAccountBlob implements ConditionalAccountBlob {
  constructor(private readonly blob: BlockBlobClient) {}

  static fromEnvironment(): AzureConditionalAccountBlob {
    const account = process.env["STFC_TOKEN_STORAGE_ACCOUNT"] ?? "";
    const container = process.env["STFC_TOKEN_STORAGE_CONTAINER"] ?? "";
    if (!/^[a-z0-9]{3,24}$/.test(account) || !/^[a-z0-9-]{3,63}$/.test(container)) {
      throw new Error("Token storage configuration is invalid.");
    }
    const service = new BlobServiceClient(
      `https://${account}.blob.core.windows.net`,
      new ManagedIdentityCredential(),
    );
    return new AzureConditionalAccountBlob(
      service.getContainerClient(container).getBlockBlobClient(getTokenBlobName()),
    );
  }

  async read() {
    try {
      const response = await this.blob.download();
      if (!response.etag) throw new TokenAccountStoreError("Stored account data is unavailable.", 503);
      return { content: await streamToString(response.readableStreamBody), etag: response.etag };
    } catch (error) {
      if (error instanceof TokenAccountStoreError) throw error;
      if (isBlobFailure(error, 404)) {
        throw new TokenAccountStoreError("The token store has not been initialized.", 503);
      }
      throw new TokenAccountStoreError("The token store could not be read.", 503);
    }
  }

  async writeIfMatch(content: string, etag: string): Promise<void> {
    if (!etag) throw new TokenAccountStoreError("Stored account data is unavailable.", 503);
    try {
      await this.blob.uploadData(Buffer.from(content, "utf8"), {
        conditions: { ifMatch: etag },
        blobHTTPHeaders: { blobContentType: "application/json; charset=utf-8" },
      });
    } catch (error) {
      if (isBlobFailure(error, 412)) {
        throw new TokenAccountStoreError("The account list changed; reload it and retry.", 409);
      }
      throw new TokenAccountStoreError("The token store could not be updated.", 503);
    }
  }
}

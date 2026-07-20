import type { StorageContext, StorageProvider, UploadImageInput, UploadedImage } from "./types";
import { StorageProviderError } from "./types";

const PROVIDER_NAME = "shopify";

const STAGED_UPLOADS_CREATE = `#graphql
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FILE_CREATE = `#graphql
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        ... on MediaImage {
          image {
            url
            width
            height
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const POLL_FILE = `#graphql
  query PollUploadedFile($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        fileStatus
        image {
          url
          width
          height
        }
      }
    }
  }
`;

interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
}

interface StagedUploadsCreateResponse {
  data?: {
    stagedUploadsCreate: {
      stagedTargets: StagedTarget[];
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
}

interface MediaImageNode {
  id: string;
  fileStatus: string;
  image: { url: string; width: number | null; height: number | null } | null;
}

interface FileCreateResponse {
  data?: {
    fileCreate: {
      files: MediaImageNode[];
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
}

interface PollFileResponse {
  data?: {
    node: { fileStatus: string; image: { url: string; width: number | null; height: number | null } | null } | null;
  };
  errors?: Array<{ message: string }>;
}

function assertNoGraphqlErrors(json: { errors?: Array<{ message: string }> }) {
  if (json.errors && json.errors.length > 0) {
    throw new StorageProviderError(json.errors.map((error) => error.message).join(" "), PROVIDER_NAME);
  }
}

// Shopify's CDN serves uploaded files with on-the-fly resizing via a `width` query param —
// no separate thumbnail asset needs to be generated or stored.
function buildThumbnailUrl(url: string, width: number): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("width", String(width));
    return parsed.toString();
  } catch {
    return url;
  }
}

async function createStagedTarget(input: UploadImageInput, context: StorageContext): Promise<StagedTarget> {
  const response = await context.admin.graphql(STAGED_UPLOADS_CREATE, {
    variables: {
      input: [
        {
          filename: input.filename,
          mimeType: input.mimeType,
          httpMethod: "POST",
          resource: "IMAGE",
          fileSize: String(input.buffer.byteLength),
        },
      ],
    },
  });
  const json = (await response.json()) as StagedUploadsCreateResponse;
  assertNoGraphqlErrors(json);

  const result = json.data?.stagedUploadsCreate;
  if (!result || result.userErrors.length > 0) {
    const message = result?.userErrors.map((error) => error.message).join(" ") || "Unable to prepare upload.";
    throw new StorageProviderError(message, PROVIDER_NAME);
  }

  const target = result.stagedTargets[0];
  if (!target) {
    throw new StorageProviderError("Shopify did not return an upload target.", PROVIDER_NAME);
  }

  return target;
}

async function uploadToStagedTarget(target: StagedTarget, input: UploadImageInput) {
  const formData = new FormData();
  for (const parameter of target.parameters) {
    formData.append(parameter.name, parameter.value);
  }
  formData.append("file", new Blob([Uint8Array.from(input.buffer)], { type: input.mimeType }), input.filename);

  const response = await fetch(target.url, { method: "POST", body: formData });
  if (!response.ok) {
    throw new StorageProviderError(`Upload to storage failed with status ${response.status}.`, PROVIDER_NAME);
  }
}

async function createFile(resourceUrl: string, filename: string, context: StorageContext): Promise<MediaImageNode> {
  const response = await context.admin.graphql(FILE_CREATE, {
    variables: {
      files: [
        {
          alt: filename,
          contentType: "IMAGE",
          originalSource: resourceUrl,
        },
      ],
    },
  });
  const json = (await response.json()) as FileCreateResponse;
  assertNoGraphqlErrors(json);

  const result = json.data?.fileCreate;
  if (!result || result.userErrors.length > 0) {
    const message = result?.userErrors.map((error) => error.message).join(" ") || "Unable to save the uploaded file.";
    throw new StorageProviderError(message, PROVIDER_NAME);
  }

  const file = result.files[0];
  if (!file) {
    throw new StorageProviderError("Shopify did not return the created file.", PROVIDER_NAME);
  }

  return file;
}

// fileCreate returns immediately, but Shopify processes the upload (generating the
// permanent CDN url + dimensions) asynchronously — usually within a second or two for a
// standard image. Bounded polling keeps this inside the request instead of adding a
// reconciliation job; if it genuinely never resolves, the caller treats it as a failed
// upload rather than storing a ReviewMedia row with no usable url.
async function pollUntilReady(
  fileId: string,
  context: StorageContext,
  attempts = 10,
  delayMs = 500,
): Promise<{ url: string; width: number | null; height: number | null }> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await context.admin.graphql(POLL_FILE, { variables: { id: fileId } });
    const json = (await response.json()) as PollFileResponse;
    assertNoGraphqlErrors(json);

    const node = json.data?.node;
    if (node?.fileStatus === "READY" && node.image) {
      return node.image;
    }
    if (node?.fileStatus === "FAILED") {
      throw new StorageProviderError("Shopify failed to process the uploaded image.", PROVIDER_NAME);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new StorageProviderError("Timed out waiting for the uploaded image to finish processing.", PROVIDER_NAME);
}

export function createShopifyFilesProvider(): StorageProvider {
  return {
    name: PROVIDER_NAME,
    async uploadImage(input: UploadImageInput, context: StorageContext): Promise<UploadedImage> {
      const target = await createStagedTarget(input, context);
      await uploadToStagedTarget(target, input);
      const file = await createFile(target.resourceUrl, input.filename, context);

      const image = file.fileStatus === "READY" && file.image ? file.image : await pollUntilReady(file.id, context);

      return {
        url: image.url,
        width: image.width,
        height: image.height,
        thumbnailUrl: buildThumbnailUrl(image.url, 400),
      };
    },
  };
}

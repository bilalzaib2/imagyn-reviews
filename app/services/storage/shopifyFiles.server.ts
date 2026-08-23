import type {
  StorageContext,
  StorageProvider,
  UploadImageInput,
  UploadedImage,
  UploadVideoInput,
  UploadedVideo,
} from "./types";
import { StorageProviderError } from "./types";

const PROVIDER_NAME = "shopify";

// "IMAGE" | "VIDEO" — the two resource kinds this provider actually uploads. Named after
// Shopify's own StagedUploadTargetGenerateUploadResource / FileContentType enums (verified
// against the live Admin API schema, not guessed) rather than a broader type, since nothing
// here handles MODEL_3D/EXTERNAL_VIDEO/FILE.
type MediaKind = "IMAGE" | "VIDEO";

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

// Requests both the MediaImage and Video shapes in the same query — a single file is never
// both, so exactly one fragment's fields come back populated per node; the other resolves to
// null and is simply not read (see readMediaFields below). This is what lets uploadImage and
// uploadVideo share one query/mutation pair instead of each needing its own.
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
        ... on Video {
          duration
          preview {
            image {
              url
            }
          }
          sources {
            url
            format
            mimeType
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
      ... on Video {
        fileStatus
        duration
        preview {
          image {
            url
          }
        }
        sources {
          url
          format
          mimeType
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

// The shared shape both fragments above can populate — a node is either an image or a video,
// never both, so exactly one of (image) / (duration, preview, sources) is ever non-null on a
// given response.
interface MediaFileNode {
  id: string;
  fileStatus: string;
  image?: { url: string; width: number | null; height: number | null } | null;
  duration?: number | null;
  preview?: { image: { url: string } | null } | null;
  sources?: Array<{ url: string; format: string; mimeType: string; width: number; height: number }> | null;
}

interface FileCreateResponse {
  data?: {
    fileCreate: {
      files: MediaFileNode[];
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
}

interface PollFileResponse {
  data?: {
    node: MediaFileNode | null;
  };
  errors?: Array<{ message: string }>;
}

function assertNoGraphqlErrors(json: { errors?: Array<{ message: string }> }) {
  if (json.errors && json.errors.length > 0) {
    throw new StorageProviderError(json.errors.map((error) => error.message).join(" "), PROVIDER_NAME);
  }
}

// Shopify's CDN serves uploaded files with on-the-fly resizing via a `width` query param —
// no separate thumbnail asset needs to be generated or stored. Used for both an image's own
// url and a video's poster-frame preview url (Video.preview.image.url is a regular Shopify
// CDN image url, so the same resizing trick applies).
function buildThumbnailUrl(url: string, width: number): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("width", String(width));
    return parsed.toString();
  } catch {
    return url;
  }
}

async function createStagedTarget(
  input: { buffer: Buffer; filename: string; mimeType: string },
  resource: MediaKind,
  context: StorageContext,
): Promise<StagedTarget> {
  const response = await context.admin.graphql(STAGED_UPLOADS_CREATE, {
    variables: {
      input: [
        {
          filename: input.filename,
          mimeType: input.mimeType,
          httpMethod: "POST",
          resource,
          // Required by Shopify whenever resource is VIDEO (and harmless to always send for
          // IMAGE too, which is what the pre-video version of this file already did).
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

async function uploadToStagedTarget(target: StagedTarget, input: { buffer: Buffer; filename: string; mimeType: string }) {
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

async function createFile(
  resourceUrl: string,
  filename: string,
  contentType: MediaKind,
  context: StorageContext,
): Promise<MediaFileNode> {
  const response = await context.admin.graphql(FILE_CREATE, {
    variables: {
      files: [
        {
          alt: filename,
          contentType,
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

// fileCreate returns immediately, but Shopify processes the upload (generating the permanent
// CDN url + dimensions/sources) asynchronously — usually within a second or two for an image,
// longer and more variable for video. Bounded polling keeps this inside the request instead
// of adding a reconciliation job; if it genuinely never resolves, the caller treats it as a
// failed upload rather than storing a ReviewMedia row with no usable url. `fileStatus` lives
// on the shared File interface (confirmed against the live schema), so this same polling loop
// works unchanged for both MediaImage and Video nodes — only what's read out of the result
// once READY differs (see uploadImage/uploadVideo below).
async function pollUntilReady(
  fileId: string,
  context: StorageContext,
  attempts: number,
  delayMs: number,
): Promise<MediaFileNode> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await context.admin.graphql(POLL_FILE, { variables: { id: fileId } });
    const json = (await response.json()) as PollFileResponse;
    assertNoGraphqlErrors(json);

    const node = json.data?.node;
    if (node?.fileStatus === "READY") {
      return node;
    }
    if (node?.fileStatus === "FAILED") {
      throw new StorageProviderError("Shopify failed to process the uploaded file.", PROVIDER_NAME);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new StorageProviderError("Timed out waiting for the uploaded file to finish processing.", PROVIDER_NAME);
}

export function createShopifyFilesProvider(): StorageProvider {
  return {
    name: PROVIDER_NAME,
    async uploadImage(input: UploadImageInput, context: StorageContext): Promise<UploadedImage> {
      const target = await createStagedTarget(input, "IMAGE", context);
      await uploadToStagedTarget(target, input);
      const file = await createFile(target.resourceUrl, input.filename, "IMAGE", context);

      const node = file.fileStatus === "READY" && file.image ? file : await pollUntilReady(file.id, context, 10, 500);
      if (!node.image) {
        throw new StorageProviderError("Shopify did not return image data for the uploaded file.", PROVIDER_NAME);
      }

      return {
        url: node.image.url,
        width: node.image.width,
        height: node.image.height,
        thumbnailUrl: buildThumbnailUrl(node.image.url, 400),
      };
    },

    // Videos take longer to process than images — a taller attempt/delay budget (up to ~30s
    // total vs. images' ~5s) gives Shopify's transcoding pipeline realistic room without
    // blocking the request indefinitely; see pollUntilReady's own comment for what happens if
    // it still never resolves.
    async uploadVideo(input: UploadVideoInput, context: StorageContext): Promise<UploadedVideo> {
      const target = await createStagedTarget(input, "VIDEO", context);
      await uploadToStagedTarget(target, input);
      const file = await createFile(target.resourceUrl, input.filename, "VIDEO", context);

      const node =
        file.fileStatus === "READY" && file.sources && file.sources.length > 0
          ? file
          : await pollUntilReady(file.id, context, 20, 1500);

      const primarySource = node.sources?.[0];
      if (!primarySource) {
        throw new StorageProviderError("Shopify did not return playable video data for the uploaded file.", PROVIDER_NAME);
      }

      return {
        url: primarySource.url,
        width: primarySource.width ?? null,
        height: primarySource.height ?? null,
        thumbnailUrl: node.preview?.image?.url ? buildThumbnailUrl(node.preview.image.url, 400) : null,
        durationMs: node.duration ?? null,
      };
    },
  };
}

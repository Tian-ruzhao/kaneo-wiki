import { client } from "@kaneo/libs";

import { HttpError } from "@/lib/http-error";

async function createPageImageUpload({
  pageId,
  filename,
  contentType,
  size,
}: {
  pageId: string;
  filename: string;
  contentType: string;
  size: number;
}) {
  const response = await client.page[":id"]["image-upload"].$put({
    param: { id: pageId },
    json: {
      filename,
      contentType,
      size,
    },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export async function finalizePageImageUpload({
  pageId,
  key,
  filename,
  contentType,
  size,
}: {
  pageId: string;
  key: string;
  filename: string;
  contentType: string;
  size: number;
}) {
  const response = await client.page[":id"]["image-upload"].finalize.$post({
    param: { id: pageId },
    json: {
      key,
      filename,
      contentType,
      size,
    },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default createPageImageUpload;

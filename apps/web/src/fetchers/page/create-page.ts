import { client } from "@kaneo/libs";

import { HttpError } from "@/lib/http-error";

async function createPage(
  projectId: string,
  data: { parentId?: string | null; title?: string },
) {
  const response = await client.page.$post({
    json: { projectId, ...data },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default createPage;

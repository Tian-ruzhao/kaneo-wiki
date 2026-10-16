import { client } from "@kaneo/libs";

import { HttpError } from "@/lib/http-error";

async function updatePage(
  id: string,
  data: { title?: string; parentId?: string | null; position?: number },
) {
  const response = await client.page[":id"].$put({
    param: { id },
    json: data,
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default updatePage;

import { client } from "@kaneo/libs";

import { HttpError } from "@/lib/http-error";

async function getPages(projectId: string) {
  const response = await client.page.project[":projectId"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default getPages;
